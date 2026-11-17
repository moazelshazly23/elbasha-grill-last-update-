import './setup';
import assert from 'assert';
import express from 'express';
import http from 'http';
import net from 'net';
import { thermalPrintRouter } from '../server/thermalPrintRouter';
import {
  classifyLanError,
  classifyUsbError,
  sanitizeDiagnosticText,
} from '../src/printing/core/PrintErrorHandler';
import { printJobQueue } from '../src/printing/core/PrintJobQueue';
import { printManager } from '../src/printing/core/PrintManager';
import { printLogger } from '../src/printing/core/PrintLogger';
import { posDb } from '../src/services/db';
import { Order } from '../src/types';

async function startMockThermalPrinterServer(): Promise<{
  server: net.Server;
  port: number;
  receivedChunks: Buffer[];
  close: () => Promise<void>;
}> {
  const receivedChunks: Buffer[] = [];
  const server = net.createServer((socket) => {
    socket.on('data', (chunk) => {
      receivedChunks.push(Buffer.from(chunk));
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address() as net.AddressInfo;
  return {
    server,
    port: addr.port,
    receivedChunks,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

async function getUnusedLocalPort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', () => resolve()));
  const { port } = probe.address() as net.AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

async function startExpressPrintServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/api/print', thermalPrintRouter);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as net.AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

async function postJson(baseUrl: string, path: string, body: Record<string, any>) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function runPrintingArchitectureTests() {
  console.log('🧪 Starting Dual Thermal Printing Architecture & Socket Verification Suite...\n');
  let passedCount = 0;
  let totalCount = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    totalCount++;
    try {
      const result = fn();
      if (result instanceof Promise) await result;
      console.log(`  ✅ PASS: ${name}`);
      passedCount++;
    } catch (err: any) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error('    ', err?.stack || err?.message || err);
    }
  }

  const expressHost = await startExpressPrintServer();

  try {
    // 1. Error taxonomy & secret sanitization
    await test('Error taxonomy maps Win32/Socket errors accurately and redacts secrets', () => {
      const sanitized = sanitizeDiagnosticText(
        'Authorization=Bearer secret_jwt_token_123 password=mySecretPassword token:abc999'
      );
      assert.strictEqual(sanitized.includes('secret_jwt_token_123'), false, 'Bearer token must be redacted');
      assert.strictEqual(sanitized.includes('mySecretPassword'), false, 'Password must be redacted');
      assert.strictEqual(sanitized.includes('abc999'), false, 'Token value must be redacted');

      const usbErr = classifyUsbError('Win32=5 ACCESS_DENIED', 'USB_ACCESS_DENIED', 'Rongta RP350');
      assert.strictEqual(usbErr.code, 'USB_ACCESS_DENIED');
      assert.strictEqual(usbErr.target, 'cashier');

      const lanErr = classifyLanError('connect ECONNREFUSED 192.168.1.200:9100', undefined, '192.168.1.200', 9100);
      assert.strictEqual(lanErr.code, 'LAN_CONNECTION_REFUSED');
      assert.strictEqual(lanErr.target, 'kitchen');
      assert.strictEqual(lanErr.isOffline, true);

      const timeoutErr = classifyLanError('TCP connect timeout after 3000ms', undefined, '192.168.1.200', 9100);
      assert.strictEqual(timeoutErr.code, 'LAN_TIMEOUT');
      assert.strictEqual(timeoutErr.isOffline, true);
    });

    // 2. Invalid IPv4 / Port validation returns HTTP 400
    await test('Express /api/print/lan-kot rejects invalid IPv4 and invalid port with HTTP 400', async () => {
      const badIp = await postJson(expressHost.baseUrl, '/api/print/lan-kot', {
        ip: '999.1.1.1',
        port: 9100,
        orderNumber: 'ORD-BAD-IP',
      });
      assert.strictEqual(badIp.status, 400);
      assert.strictEqual(badIp.data.success, false);
      assert.strictEqual(badIp.data.errorCode, 'LAN_INVALID_IP');

      const badPort = await postJson(expressHost.baseUrl, '/api/print/lan-kot', {
        ip: '127.0.0.1',
        port: 70000,
        orderNumber: 'ORD-BAD-PORT',
      });
      assert.strictEqual(badPort.status, 400);
      assert.strictEqual(badPort.data.success, false);
      assert.strictEqual(badPort.data.errorCode, 'LAN_INVALID_PORT');
    });

    // 3. Closed TCP port returns real HTTP 503 LAN_CONNECTION_REFUSED (never fake success)
    await test('Express /api/print/lan-kot returns real HTTP 503 LAN_CONNECTION_REFUSED when port is closed', async () => {
      const closedPort = await getUnusedLocalPort();
      const res = await postJson(expressHost.baseUrl, '/api/print/lan-kot', {
        ip: '127.0.0.1',
        port: closedPort,
        orderNumber: 'ORD-REFUSED',
        rawText: 'TEST KOT',
        kitchenProtocol: 'escpos_text',
        timeoutMs: 800,
      });
      assert.strictEqual(res.status, 503);
      assert.strictEqual(res.data.success, false);
      assert.strictEqual(res.data.errorCode, 'LAN_CONNECTION_REFUSED');
    });

    // 4. Loopback Mock TCP Printer receives real ESC/POS & Plain Line bytes across protocols
    await test('Loopback Mock TCP Printer receives exact ESC/POS & Plain Line payloads over socket', async () => {
      const mockPrinter = await startMockThermalPrinterServer();
      try {
        // 4a. escpos_text protocol
        const textRes = await postJson(expressHost.baseUrl, '/api/print/lan-kot', {
          ip: '127.0.0.1',
          port: mockPrinter.port,
          orderNumber: 'ORD-TCP-TEXT',
          kitchenProtocol: 'escpos_text',
          rawText: 'KOT #101 - KEBAB x2',
          autoCut: true,
          buzzer: true,
          copies: 1,
        });
        assert.strictEqual(textRes.status, 200);
        assert.strictEqual(textRes.data.success, true);

        // 4b. escpos_raster protocol (with sample GS v 0 base64 bytes)
        const fakeRaster = Buffer.from([0x1d, 0x76, 0x30, 0x00, 0x01, 0x00, 0x01, 0x00, 0xff]).toString('base64');
        const rasterRes = await postJson(expressHost.baseUrl, '/api/print/lan-kot', {
          ip: '127.0.0.1',
          port: mockPrinter.port,
          orderNumber: 'ORD-TCP-RASTER',
          kitchenProtocol: 'escpos_raster',
          escposBase64: fakeRaster,
          autoCut: true,
          buzzer: true,
          copies: 1,
        });
        assert.strictEqual(rasterRes.status, 200);
        assert.strictEqual(rasterRes.data.success, true);

        // 4c. plain_line protocol
        const plainRes = await postJson(expressHost.baseUrl, '/api/print/lan-kot', {
          ip: '127.0.0.1',
          port: mockPrinter.port,
          orderNumber: 'ORD-TCP-PLAIN',
          kitchenProtocol: 'plain_line',
          rawText: 'PLAIN LINE KITCHEN ORDER #101',
          copies: 1,
        });
        assert.strictEqual(plainRes.status, 200);
        assert.strictEqual(plainRes.data.success, true);

        // Allow loopback server socket 'data' events to flush cleanly
        await new Promise((r) => setTimeout(r, 40));

        const combined = Buffer.concat(mockPrinter.receivedChunks);
        // Verify ESC @ (0x1B 0x40), ESC B buzzer (0x1B 0x42), GS V auto-cut (0x1D 0x56), and text content
        assert.ok(combined.includes(Buffer.from([0x1b, 0x40])), 'Received TCP buffer must include ESC @ reset');
        assert.ok(combined.includes(Buffer.from([0x1b, 0x42])), 'Received TCP buffer must include ESC B buzzer');
        assert.ok(combined.includes(Buffer.from([0x1d, 0x56])), 'Received TCP buffer must include GS V cut');
        assert.ok(combined.includes(Buffer.from('KOT #101 - KEBAB x2', 'utf8')), 'Buffer must include escpos_text body');
        assert.ok(
          combined.includes(Buffer.from('PLAIN LINE KITCHEN ORDER #101', 'utf8')),
          'Buffer must include plain_line body'
        );
      } finally {
        await mockPrinter.close();
      }
    });

    // 5. /api/print/test-connection probes open vs closed TCP endpoints accurately
    await test('Express /api/print/test-connection detects closed port vs open mock printer latency', async () => {
      const closedPort = await getUnusedLocalPort();
      const closedProbe = await postJson(expressHost.baseUrl, '/api/print/test-connection', {
        target: 'kitchen_lan',
        ip: '127.0.0.1',
        port: closedPort,
        timeoutMs: 800,
      });
      assert.strictEqual(closedProbe.data.reachable, false);
      assert.strictEqual(closedProbe.data.errorCode, 'LAN_CONNECTION_REFUSED');

      const mockPrinter = await startMockThermalPrinterServer();
      try {
        const openProbe = await postJson(expressHost.baseUrl, '/api/print/test-connection', {
          target: 'kitchen_lan',
          ip: '127.0.0.1',
          port: mockPrinter.port,
          timeoutMs: 1200,
        });
        assert.strictEqual(openProbe.status, 200);
        assert.strictEqual(openProbe.data.reachable, true);
        assert.strictEqual(typeof openProbe.data.latencyMs, 'number');
      } finally {
        await mockPrinter.close();
      }
    });

    // 6. /api/print/usb-receipt TSPL guard, Label printer guard, and non-Windows strict error
    await test('Express /api/print/usb-receipt enforces TSPL & label printer blocks and fails honestly on non-Windows host', async () => {
      const tsplPayload = Buffer.from('SIZE 50 mm,30 mm\nGAP 2 mm,0\nPRINT 1').toString('base64');
      const tsplBlocked = await postJson(expressHost.baseUrl, '/api/print/usb-receipt', {
        printerName: 'Rongta RP350',
        escposBase64: tsplPayload,
      });
      assert.strictEqual(tsplBlocked.status, 400);
      assert.strictEqual(tsplBlocked.data.errorCode, 'TSPL_COMMAND_BLOCKED');

      const labelBlocked = await postJson(expressHost.baseUrl, '/api/print/usb-receipt', {
        printerName: 'Xprinter XP-365B Barcode Label',
        escposBase64: Buffer.from([0x1b, 0x40]).toString('base64'),
      });
      assert.strictEqual(labelBlocked.status, 400);
      assert.strictEqual(labelBlocked.data.errorCode, 'USB_LABEL_PRINTER_BLOCKED');

      if (process.platform !== 'win32') {
        const nonWinRes = await postJson(expressHost.baseUrl, '/api/print/usb-receipt', {
          printerName: 'Rongta RP350',
          escposBase64: Buffer.from([0x1b, 0x40]).toString('base64'),
        });
        assert.strictEqual(nonWinRes.status, 503);
        assert.strictEqual(nonWinRes.data.success, false);
        assert.strictEqual(nonWinRes.data.errorCode, 'USB_HOST_NOT_WINDOWS');
      }
    });

    // 7. Safe Reprint Isolation: zero order duplication, zero stock mutation, audit recorded, double-click locked
    await test('PrintManager.reprintOrder never duplicates orders/inventory, records audit log, and blocks rapid double-click', async () => {
      const beforeOrders = posDb.getOrders().length;
      const ingredients = posDb.getIngredients();
      const stockSnapshotBefore = ingredients.map((i) => ({ id: i.id, qty: i.currentStock }));

      const sampleOrder: Order = {
        id: `reprint-safe-${Date.now()}`,
        orderNumber: 'OR9991',
        type: 'takeaway',
        branchId: 'branch-1',
        branchName: 'الفرع الرئيسي',
        cashierId: 'cashier-1',
        cashierName: 'أحمد كاشير',
        items: [
          {
            id: 'it-safe-1',
            productId: 'p-1',
            productNameAr: 'وجبة شيش طاووق',
            unitPrice: 185,
            costPrice: 90,
            quantity: 2,
            selectedModifiers: [],
            itemTotal: 370,
            kitchenStation: 'grill',
            status: 'pending',
          },
        ],
        subtotal: 370,
        discountAmount: 0,
        taxPercent: 0,
        taxAmount: 0,
        serviceChargePercent: 0,
        serviceChargeAmount: 0,
        total: 370,
        payments: [{ method: 'cash', amount: 370 }],
        paidAmount: 370,
        changeAmount: 0,
        status: 'confirmed',
        paymentStatus: 'paid',
        createdAt: new Date().toISOString(),
      };

      posDb.createOrder(sampleOrder);
      const countAfterCreate = posDb.getOrders().length;
      assert.strictEqual(countAfterCreate, beforeOrders + 1);

      const profile = posDb.getProfile();
      const firstReprint = await printManager.reprintOrder(sampleOrder, profile, 'both', {
        userId: 'admin-1',
        userName: 'المدير العام',
      });
      assert.strictEqual(firstReprint.cashierOk, true);
      assert.strictEqual(firstReprint.kitchenOk, true);

      // Immediate rapid second click inside 1200ms lock window must be blocked cleanly
      const doubleClickBlocked = await printManager.reprintOrder(sampleOrder, profile, 'both', {
        userId: 'admin-1',
        userName: 'المدير العام',
      });
      assert.strictEqual(doubleClickBlocked.cashierOk, false);
      assert.strictEqual(doubleClickBlocked.kitchenOk, false);
      assert.ok(doubleClickBlocked.errors.some((e) => e.includes('منع التكرار')));

      // Release lock explicitly for cleanliness
      printJobQueue.releaseManualLock(`reprint:${sampleOrder.id}:both`);

      assert.strictEqual(posDb.getOrders().length, countAfterCreate, 'Reprint must NEVER create a duplicate order');

      const stockSnapshotAfter = posDb.getIngredients().map((i) => ({ id: i.id, qty: i.currentStock }));
      assert.deepStrictEqual(stockSnapshotAfter, stockSnapshotBefore, 'Reprint must NEVER mutate ingredient stock');

      const audits = posDb.getAuditLogs();
      assert.ok(
        audits.some((a) => a.details.includes('OR9991') && a.action.includes('إعادة طباعة')),
        'Reprint must record an audit log entry'
      );

      const printLogs = printLogger.getLogs();
      assert.ok(printLogs.length > 0, 'PrintLogger must persist sanitized print history');
    });
  } finally {
    await expressHost.close();
  }

  console.log(`\n📊 Printing Architecture Test Results: ${passedCount}/${totalCount} Passed`);
  if (passedCount !== totalCount) {
    process.exit(1);
  }
}

runPrintingArchitectureTests();
