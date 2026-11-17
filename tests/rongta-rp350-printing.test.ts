import './setup';
import assert from 'assert';
import {
  PRINTING_PROTOCOL_REGISTRY,
  assertNoTsplCommands,
  assertProtocolAllowedForReceipt,
  buildEscPosReceiptBytes,
  containsTsplCommands,
  isLikelyLabelPrinter,
  isLikelyRongtaThermal,
} from '../src/utils/printingProtocols';
import {
  generateKitchenTicketHTML,
  generateThermalReceiptHTML,
  renderFullReceiptToEscPosGSv0Base64,
  renderLinesToEscPosGSv0Base64,
} from '../src/utils/thermalPrinter';
import { buildEscPosPayload } from '../server/thermalPrintRouter';
import { printJobManager } from '../src/services/printJobManager';
import { posDb } from '../src/services/db';
import { Order } from '../src/types';

async function runRongtaPrintingTests() {
  console.log('🖨️ Starting Rongta RP350 80mm ESC/POS & Protocol Isolation Test Suite...\n');
  let passedCount = 0;
  let totalCount = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    totalCount++;
    try {
      const res = fn();
      if (res instanceof Promise) {
        await res;
      }
      console.log(`  ✅ PASS: ${name}`);
      passedCount++;
    } catch (err: any) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error('    ', err?.stack || err?.message || err);
    }
  }

  const baseProfile = posDb.getProfile();
  const sampleOrder: Order = {
    id: 'ord-print-test-1',
    orderNumber: '#8801',
    type: 'dine_in',
    tableNumber: '7',
    branchId: 'branch-1',
    branchName: 'الفرع الرئيسي',
    cashierId: 'cashier-1',
    cashierName: 'محمود الكاشير',
    customerName: 'كريم علي',
    customerPhone: '01099887766',
    items: [
      {
        id: 'item-1',
        productId: 'p-1',
        productNameAr: 'كيلو مشويات الباشا ميكس',
        unitPrice: 680,
        costPrice: 380,
        quantity: 2,
        selectedModifiers: [
          { groupId: 'g1', groupNameAr: 'التسوية', optionId: 'o1', nameAr: 'تسوية كاملة', priceDelta: 0 },
        ],
        itemTotal: 1360,
        notes: 'بدون بصل',
        kitchenStation: 'grill',
        status: 'pending',
      },
    ],
    subtotal: 1360,
    discountAmount: 60,
    discountType: 'fixed',
    discountValue: 60,
    taxPercent: 0,
    taxAmount: 0,
    serviceChargePercent: 0,
    serviceChargeAmount: 0,
    total: 1300,
    payments: [{ method: 'cash', amount: 1500 }],
    paidAmount: 1500,
    changeAmount: 200,
    status: 'confirmed',
    paymentStatus: 'paid',
    createdAt: new Date().toISOString(),
  };

  // --- Test 1: Protocol Registry & TSPL Isolation ---
  await test('Protocol registry enables escpos_raw & windows_driver and blocks TSPL on Rongta RP350', () => {
    assert.strictEqual(PRINTING_PROTOCOL_REGISTRY.escpos_raw.enabledForRongtaRP350, true);
    assert.strictEqual(PRINTING_PROTOCOL_REGISTRY.windows_driver.enabledForRongtaRP350, true);
    assert.strictEqual(PRINTING_PROTOCOL_REGISTRY.tspl.enabledForRongtaRP350, false);

    assert.doesNotThrow(() => assertProtocolAllowedForReceipt('escpos_raw'));
    assert.doesNotThrow(() => assertProtocolAllowedForReceipt('windows_driver'));
    assert.throws(() => assertProtocolAllowedForReceipt('tspl'));
  });

  // --- Test 2: Strict TSPL Command Rejection ---
  await test('containsTsplCommands & assertNoTsplCommands reject all TSPL label commands cleanly', () => {
    const tsplSamples = [
      'SIZE 80 mm, 60 mm\r\nGAP 2 mm, 0 mm\r\nCLS\r\nPRINT 1,1\r\n',
      'DIRECTION 1\nREFERENCE 0,0\nOFFSET 0 mm\n',
      'SET PEEL OFF\nSET CUTTER 1\nSET TEAR ON\n',
      'SPEED 4\nDENSITY 8\nCLS\n',
    ];

    for (const sample of tsplSamples) {
      assert.strictEqual(containsTsplCommands(sample), true, `Must detect TSPL in: ${sample}`);
      assert.throws(() => assertNoTsplCommands(sample));
      assert.throws(() =>
        buildEscPosReceiptBytes({
          rasterBytes: new TextEncoder().encode(sample),
        })
      );
      assert.throws(() =>
        buildEscPosPayload({
          rasterEscPosBase64: Buffer.from(sample, 'utf8').toString('base64'),
          autoCut: true,
          buzzer: false,
          copies: 1,
        })
      );
    }

    assert.strictEqual(containsTsplCommands('مشويات الباشا ... انت الباشا\n#8801'), false);
  });

  // --- Test 3: Barcode/Label vs Rongta Thermal Printer Classification ---
  await test('Printer classifier blocks barcode/label printers and recognizes Rongta RP350', () => {
    assert.strictEqual(isLikelyLabelPrinter('Xprinter XP-365B Barcode'), true);
    assert.strictEqual(isLikelyLabelPrinter('Zebra ZD220 Label Printer'), true);
    assert.strictEqual(isLikelyLabelPrinter('TSC TTP-244 Pro TSPL'), true);
    assert.strictEqual(isLikelyLabelPrinter('Rongta RP350 (Cashier - USB)'), false);

    assert.strictEqual(isLikelyRongtaThermal('Rongta RP350 (Cashier - USB)'), true);
    assert.strictEqual(isLikelyRongtaThermal('RONGTA RP-350 LAN 80mm'), true);
    assert.strictEqual(isLikelyRongtaThermal('Zebra Label RP350'), false);
  });

  // --- Test 4: ESC/POS Binary Frame Structure (ESC @, ESC B, ESC a, GS v 0, ESC d, GS V, Multi-copy) ---
  await test('buildEscPosReceiptBytes & buildEscPosPayload construct exact ESC/POS byte frames', () => {
    const rasterB64 = renderLinesToEscPosGSv0Base64(
      [{ text: 'مشويات الباشا ... انت الباشا', align: 'center', bold: true, fontSize: 24 }],
      '80mm'
    );
    const rasterBytes = Buffer.from(rasterB64, 'base64');
    // Verify GS v 0 header in raster bitmap (0x1D 0x76 0x30 0x00) and 576 dots width => 72 bytes/row => xL=72, xH=0
    assert.strictEqual(rasterBytes[0], 0x1d);
    assert.strictEqual(rasterBytes[1], 0x76);
    assert.strictEqual(rasterBytes[2], 0x30);
    assert.strictEqual(rasterBytes[3], 0x00);
    assert.strictEqual(rasterBytes[4], 72);
    assert.strictEqual(rasterBytes[5], 0);

    const frame1 = buildEscPosPayload({
      rasterEscPosBase64: rasterB64,
      autoCut: true,
      buzzer: true,
      copies: 1,
      paperFeedLines: 4,
      alignment: 'center',
    });

    assert.strictEqual(frame1[0], 0x1b); // ESC
    assert.strictEqual(frame1[1], 0x40); // @
    assert.strictEqual(frame1[2], 0x1b); // ESC
    assert.strictEqual(frame1[3], 0x42); // B (Buzzer)
    assert.strictEqual(frame1[7], 0x1b); // ESC
    assert.strictEqual(frame1[8], 0x61); // a (Align)
    assert.strictEqual(frame1[9], 0x01); // Center
    // Ends with ESC d 4 + GS V 66 0
    assert.strictEqual(frame1[frame1.length - 7], 0x1b);
    assert.strictEqual(frame1[frame1.length - 6], 0x64);
    assert.strictEqual(frame1[frame1.length - 5], 4);
    assert.strictEqual(frame1[frame1.length - 4], 0x1d);
    assert.strictEqual(frame1[frame1.length - 3], 0x56);
    assert.strictEqual(frame1[frame1.length - 2], 0x42);
    assert.strictEqual(frame1[frame1.length - 1], 0x00);

    // 2 copies must double byte payload length cleanly
    const frame2 = buildEscPosPayload({
      rasterEscPosBase64: rasterB64,
      autoCut: true,
      buzzer: true,
      copies: 2,
      paperFeedLines: 4,
      alignment: 'center',
    });
    assert.strictEqual(frame2.length, frame1.length * 2);
  });

  // --- Test 5: Customer Receipt HTML & Raster vs Strict KOT Rules ---
  await test('Customer receipt includes full branding/QR/totals with 0% VAT while KOT keeps strict minimal content', async () => {
    const customerHtml = generateThermalReceiptHTML(sampleOrder, {
      ...baseProfile,
      slogan: 'مشويات الباشا ... انت الباشا',
      receiptSettings: {
        ...baseProfile.receiptSettings!,
        sloganArabic: 'مشويات الباشا ... انت الباشا',
        qrLabel: 'امسح للتقييم',
      },
    }, 'data:image/png;base64,iVBORw0KGgo=');

    assert.ok(customerHtml.includes('مشويات الباشا ... انت الباشا'));
    assert.ok(customerHtml.includes('#8801'));
    assert.ok(customerHtml.includes('1300.00'));
    assert.ok(customerHtml.includes('امسح للتقييم'));
    assert.strictEqual(containsTsplCommands(customerHtml), false);

    // Headless GS v 0 full receipt base64 check
    const fullRasterB64 = await renderFullReceiptToEscPosGSv0Base64(sampleOrder, baseProfile);
    assert.ok(fullRasterB64.length > 10, 'Full receipt rasterizer must return valid Base64 GS v 0 bitmap');
    const decoded = Buffer.from(fullRasterB64, 'base64');
    assert.strictEqual(decoded[0], 0x1d);
    assert.strictEqual(decoded[1], 0x76);

    // Strict KOT verification
    const kotHtml = generateKitchenTicketHTML(sampleOrder, baseProfile);
    assert.ok(kotHtml.includes('#8801'));
    assert.ok(kotHtml.includes('كيلو مشويات الباشا ميكس'));
    assert.ok(kotHtml.includes('2x'));
    assert.ok(kotHtml.includes('بدون بصل'));
    assert.strictEqual(kotHtml.includes('1300'), false);
    assert.strictEqual(kotHtml.includes('680'), false);
    assert.strictEqual(kotHtml.includes('<img'), false);
  });

  // --- Test 6: PrintJobManager Duplicate-Print Guard, Honest Verification & Log Exports ---
  await test('PrintJobManager prevents duplicate dispatch within window, enforces manual physical verification, and exports logs', () => {
    printJobManager.clearJobs();

    const invoiceId = `inv-dup-${Date.now()}`;
    assert.strictEqual(printJobManager.canDispatchJob(invoiceId, 'cashier', false, 10).allowed, true);

    const job = printJobManager.createJob({
      invoiceId,
      orderNumber: '#9901',
      target: 'cashier',
      printerName: 'Rongta RP350 (Cashier - USB)',
      protocolMode: 'escpos_raw',
      isReprint: false,
    });
    printJobManager.markPrinting(job.jobId);
    printJobManager.markSpoolerAccepted(job.jobId, 4096, 'Rongta RP350 (Cashier - USB)');

    // Accepted by spooler MUST NOT falsely mark physically_verified automatically
    const afterSpooler = printJobManager.getJobs(10).find((j) => j.jobId === job.jobId);
    assert.strictEqual(afterSpooler?.status, 'completed');
    assert.strictEqual(afterSpooler?.spoolerStage, 'accepted_by_spooler');
    assert.strictEqual(afterSpooler?.physicallyVerifiedAt, undefined);

    // Duplicate automatic dispatch within 10s must be blocked; explicit reprint must be allowed
    const dupBlocked = printJobManager.canDispatchJob(invoiceId, 'cashier', false, 10);
    assert.strictEqual(dupBlocked.allowed, false);
    const explicitReprint = printJobManager.canDispatchJob(invoiceId, 'cashier', true, 10);
    assert.strictEqual(explicitReprint.allowed, true);

    // Manual physical confirmation updates stage explicitly
    printJobManager.markPhysicallyVerified(job.jobId);
    const afterManual = printJobManager.getJobs(10).find((j) => j.jobId === job.jobId);
    assert.strictEqual(afterManual?.spoolerStage, 'physically_verified');
    assert.ok(afterManual?.physicallyVerifiedAt);

    // Log exports
    const txtLogs = printJobManager.exportPrintLogsText();
    assert.ok(txtLogs.includes('#9901'));
    assert.ok(txtLogs.includes('Rongta RP350'));

    const jsonLogs = JSON.parse(printJobManager.exportPrintLogsJson());
    assert.ok(Array.isArray(jsonLogs.jobs) && jsonLogs.jobs.length >= 1);
  });

  console.log(`\n========================================`);
  console.log(`Rongta RP350 Printing Tests: ${passedCount}/${totalCount} Passed`);
  console.log(`========================================\n`);

  if (passedCount !== totalCount) {
    process.exit(1);
  }
}

runRongtaPrintingTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
