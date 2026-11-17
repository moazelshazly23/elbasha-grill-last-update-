import express from 'express';
import {
  assertNoTsplCommands,
  buildEscPosReceiptBytes,
  isLikelyLabelPrinter,
} from '../src/utils/printingProtocols';
import {
  sendRawTcpSocket,
  testTcpEndpoint,
  runWindowsSpoolerAction,
  validateLanEndpoint,
} from './nativePrintCore';

export const thermalPrintRouter = express.Router();

export interface DispatchedPrintJob {
  id: string;
  target: 'cashier_usb' | 'kitchen_lan';
  orderNumber: string;
  printerIdentifier: string;
  protocol: string;
  copies: number;
  autoCut: boolean;
  buzzer: boolean;
  bytesSent: number;
  transportMode: 'raw-tcp-9100' | 'winspool-raw';
  status: 'printed' | 'failed';
  createdAt: string;
  errorCode?: string;
  error?: string;
  technicalDetails?: string;
}

const recentPrintJobs: DispatchedPrintJob[] = [];

function recordJob(job: DispatchedPrintJob) {
  recentPrintJobs.unshift(job);
  if (recentPrintJobs.length > 100) {
    recentPrintJobs.length = 100;
  }
}

/**
 * Construct pure ESC/POS command Buffer wrapping a GS v 0 raster bitmap payload.
 * Rejects any TSPL command strings/bytes via assertNoTsplCommands.
 */
export function buildEscPosPayload(options: {
  rasterEscPosBase64?: string;
  autoCut: boolean;
  buzzer: boolean;
  copies: number;
  paperFeedLines?: number;
  alignment?: 'left' | 'center' | 'right';
}): Buffer {
  const bytes = buildEscPosReceiptBytes({
    rasterBase64: options.rasterEscPosBase64,
    alignment: options.alignment || 'center',
    paperFeedLines: options.paperFeedLines ?? 4,
    autoCut: options.autoCut,
    buzzer: options.buzzer,
    copies: options.copies,
  });
  return Buffer.from(bytes);
}

/**
 * Construct plain-text ESC/POS or plain line-feed payload for non-raster kitchen printers.
 */
export function buildKitchenProtocolPayload(options: {
  protocol?: 'escpos_raster' | 'escpos_text' | 'plain_line' | 'windows_driver';
  escposBase64?: string;
  rawText?: string;
  autoCut: boolean;
  buzzer: boolean;
  copies: number;
  paperFeedLines?: number;
}): Buffer {
  const protocol = options.protocol || 'escpos_raster';
  if (options.rawText) {
    assertNoTsplCommands(options.rawText, `Kitchen ${protocol} Text`);
  }
  if (options.escposBase64) {
    assertNoTsplCommands(options.escposBase64, `Kitchen ${protocol} Base64`);
  }

  if (protocol === 'plain_line') {
    const copies = Math.max(1, Math.min(5, Number(options.copies) || 1));
    const text = (options.rawText || '') + '\n'.repeat(Math.max(2, Number(options.paperFeedLines ?? 4)));
    const single = Buffer.from(text, 'utf8');
    return Buffer.concat(Array.from({ length: copies }, () => single));
  }

  if (protocol === 'escpos_text') {
    const copies = Math.max(1, Math.min(5, Number(options.copies) || 1));
    const feed = Math.max(0, Math.min(10, Number(options.paperFeedLines ?? 4)));
    const chunks: Buffer[] = [Buffer.from([0x1b, 0x40])]; // ESC @
    if (options.buzzer) {
      chunks.push(Buffer.from([0x1b, 0x42, 0x03, 0x02, 0x07]));
    }
    chunks.push(Buffer.from((options.rawText || '') + '\n', 'utf8'));
    if (feed > 0) chunks.push(Buffer.from([0x1b, 0x64, feed]));
    if (options.autoCut) chunks.push(Buffer.from([0x1d, 0x56, 0x42, 0x00]));
    const single = Buffer.concat(chunks);
    return Buffer.concat(Array.from({ length: copies }, () => single));
  }

  return buildEscPosPayload({
    rasterEscPosBase64: options.escposBase64,
    autoCut: options.autoCut,
    buzzer: options.buzzer,
    copies: options.copies,
    paperFeedLines: options.paperFeedLines,
  });
}

/**
 * POST /api/print/lan-kot
 * Real TCP/IP Raw Socket dispatch (NO FAKE SUCCESS on socket errors).
 */
thermalPrintRouter.post('/lan-kot', async (req, res) => {
  const {
    ip = '192.168.1.200',
    port = 9100,
    orderNumber = 'ORD-0000',
    copies = 1,
    autoCut = true,
    buzzer = true,
    paperFeedLines = 4,
    escposBase64,
    rawText,
    kitchenProtocol = 'escpos_raster',
    timeoutMs = 3000,
    simulateOffline = false,
  } = req.body || {};

  const targetPort = Number(port) || 9100;
  const targetIp = String(ip || '').trim();

  if (simulateOffline) {
    const errMsg = `طابعة المطبخ (${targetIp}:${targetPort}) في وضع محاكاة عدم الاتصال (Offline).`;
    recordJob({
      id: `job-kot-${Date.now()}`,
      target: 'kitchen_lan',
      orderNumber,
      printerIdentifier: `${targetIp}:${targetPort}`,
      protocol: String(kitchenProtocol),
      copies: Number(copies) || 1,
      autoCut: Boolean(autoCut),
      buzzer: Boolean(buzzer),
      bytesSent: 0,
      transportMode: 'raw-tcp-9100',
      status: 'failed',
      createdAt: new Date().toISOString(),
      errorCode: 'LAN_OFFLINE_CONFIGURED',
      error: errMsg,
    });
    return res.status(503).json({
      success: false,
      errorCode: 'LAN_OFFLINE_CONFIGURED',
      error: errMsg,
    });
  }

  const endpointCheck = validateLanEndpoint(targetIp, targetPort);
  if (!endpointCheck.valid) {
    recordJob({
      id: `job-kot-${Date.now()}`,
      target: 'kitchen_lan',
      orderNumber,
      printerIdentifier: `${targetIp}:${targetPort}`,
      protocol: String(kitchenProtocol),
      copies: Number(copies) || 1,
      autoCut: Boolean(autoCut),
      buzzer: Boolean(buzzer),
      bytesSent: 0,
      transportMode: 'raw-tcp-9100',
      status: 'failed',
      createdAt: new Date().toISOString(),
      errorCode: endpointCheck.errorCode,
      error: endpointCheck.error,
    });
    return res.status(400).json({
      success: false,
      errorCode: endpointCheck.errorCode,
      error: endpointCheck.error,
    });
  }

  let payload: Buffer;
  try {
    payload = buildKitchenProtocolPayload({
      protocol: kitchenProtocol,
      escposBase64,
      rawText,
      autoCut: Boolean(autoCut),
      buzzer: Boolean(buzzer),
      copies: Number(copies) || 1,
      paperFeedLines: Number(paperFeedLines ?? 4),
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      errorCode: 'TSPL_COMMAND_BLOCKED',
      error: err?.message || 'تم رفض بيانات الطباعة لاحتوائها على أوامر غير صالحة.',
    });
  }

  const tcpResult = await sendRawTcpSocket(endpointCheck.ip, endpointCheck.port, payload, {
    connectTimeoutMs: Number(timeoutMs) || 3000,
    writeTimeoutMs: Math.max(4000, (Number(timeoutMs) || 3000) + 1500),
    retries: 1,
  });

  if (!tcpResult.ok) {
    const job: DispatchedPrintJob = {
      id: `job-kot-${Date.now()}`,
      target: 'kitchen_lan',
      orderNumber,
      printerIdentifier: `${endpointCheck.ip}:${endpointCheck.port}`,
      protocol: String(kitchenProtocol),
      copies: Number(copies) || 1,
      autoCut: Boolean(autoCut),
      buzzer: Boolean(buzzer),
      bytesSent: 0,
      transportMode: 'raw-tcp-9100',
      status: 'failed',
      createdAt: new Date().toISOString(),
      errorCode: tcpResult.errorCode || 'LAN_WRITE_ERROR',
      error: tcpResult.error || `تعذر الإرسال إلى ${endpointCheck.ip}:${endpointCheck.port}`,
      technicalDetails: tcpResult.technicalDetails,
    };
    recordJob(job);
    return res.status(503).json({
      success: false,
      errorCode: job.errorCode,
      error: job.error,
      technicalDetails: job.technicalDetails,
      job,
    });
  }

  const job: DispatchedPrintJob = {
    id: `job-kot-${Date.now()}`,
    target: 'kitchen_lan',
    orderNumber,
    printerIdentifier: `${endpointCheck.ip}:${endpointCheck.port}`,
    protocol: String(kitchenProtocol),
    copies: Number(copies) || 1,
    autoCut: Boolean(autoCut),
    buzzer: Boolean(buzzer),
    bytesSent: tcpResult.bytesSent,
    transportMode: 'raw-tcp-9100',
    status: 'printed',
    createdAt: new Date().toISOString(),
  };
  recordJob(job);
  return res.json({
    success: true,
    mode: 'raw-tcp-9100',
    protocol: kitchenProtocol,
    bytesSent: tcpResult.bytesSent,
    latencyMs: tcpResult.latencyMs,
    job,
  });
});

/**
 * POST /api/print/usb-receipt
 * Real Win32 Raw Spooler dispatch (NO FAKE SUCCESS when non-Windows or spooler fails).
 */
thermalPrintRouter.post('/usb-receipt', async (req, res) => {
  const {
    printerName = 'Rongta RP350 (Cashier - USB)',
    orderNumber = 'ORD-0000',
    copies = 1,
    autoCut = true,
    paperFeedLines = 4,
    escposBase64,
    simulateOffline = false,
  } = req.body || {};

  if (simulateOffline || String(printerName).toLowerCase().includes('offline')) {
    const errMsg = `طابعة الكاشير USB غير متصلة (${printerName})`;
    recordJob({
      id: `job-usb-${Date.now()}`,
      target: 'cashier_usb',
      orderNumber,
      printerIdentifier: printerName,
      protocol: 'escpos_raw',
      copies: Number(copies) || 1,
      autoCut: Boolean(autoCut),
      buzzer: false,
      bytesSent: 0,
      transportMode: 'winspool-raw',
      status: 'failed',
      createdAt: new Date().toISOString(),
      errorCode: 'USB_PRINTER_OFFLINE',
      error: errMsg,
    });
    return res.status(503).json({
      success: false,
      errorCode: 'USB_PRINTER_OFFLINE',
      error: errMsg,
    });
  }

  if (isLikelyLabelPrinter(printerName)) {
    return res.status(400).json({
      success: false,
      errorCode: 'USB_LABEL_PRINTER_BLOCKED',
      error: `تم رفض الطباعة: الطابعة (${printerName}) هي طابعة باركود/ملصقات وليست Rongta RP350.`,
    });
  }

  let payload: Buffer;
  try {
    if (escposBase64) {
      assertNoTsplCommands(String(escposBase64), 'USB Receipt Input');
    }
    payload = buildEscPosPayload({
      rasterEscPosBase64: escposBase64,
      autoCut: Boolean(autoCut),
      buzzer: false,
      copies: Number(copies) || 1,
      paperFeedLines: Number(paperFeedLines ?? 4),
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      errorCode: 'TSPL_COMMAND_BLOCKED',
      error: err?.message || 'تم رفض بيانات الطباعة لاحتوائها على أوامر غير صالحة لـ ESC/POS.',
    });
  }

  const winResult = await runWindowsSpoolerAction({
    printerName,
    payload,
    diagnoseOnly: false,
  });

  if (!winResult.ok) {
    const job: DispatchedPrintJob = {
      id: `job-usb-${Date.now()}`,
      target: 'cashier_usb',
      orderNumber,
      printerIdentifier: winResult.resolvedPrinter || printerName,
      protocol: 'escpos_raw',
      copies: Number(copies) || 1,
      autoCut: Boolean(autoCut),
      buzzer: false,
      bytesSent: 0,
      transportMode: 'winspool-raw',
      status: 'failed',
      createdAt: new Date().toISOString(),
      errorCode: winResult.errorCode || 'USB_WRITE_FAILED',
      error: winResult.error || `تعذرت الطباعة المباشرة على ${printerName}`,
      technicalDetails: winResult.technicalDetails,
    };
    recordJob(job);
    return res.status(503).json({
      success: false,
      errorCode: job.errorCode,
      error: job.error,
      technicalDetails: job.technicalDetails,
      resolvedPrinter: winResult.resolvedPrinter,
      portName: winResult.portName,
      driverName: winResult.driverName,
      printerStatus: winResult.printerStatus,
      spoolerStatus: winResult.spoolerStatus,
      installedPrinters: winResult.installedPrinters,
      job,
    });
  }

  const resolvedName = winResult.resolvedPrinter || printerName;
  const job: DispatchedPrintJob = {
    id: `job-usb-${Date.now()}`,
    target: 'cashier_usb',
    orderNumber,
    printerIdentifier: resolvedName,
    protocol: 'escpos_raw',
    copies: Number(copies) || 1,
    autoCut: Boolean(autoCut),
    buzzer: false,
    bytesSent: winResult.bytesSent || payload.length,
    transportMode: 'winspool-raw',
    status: 'printed',
    createdAt: new Date().toISOString(),
  };
  recordJob(job);

  return res.json({
    success: true,
    mode: 'winspool-raw',
    bytesSent: job.bytesSent,
    resolvedPrinter: resolvedName,
    portName: winResult.portName,
    driverName: winResult.driverName,
    printerStatus: winResult.printerStatus,
    spoolerStatus: winResult.spoolerStatus,
    job,
  });
});

/**
 * POST /api/print/test-connection
 */
thermalPrintRouter.post('/test-connection', async (req, res) => {
  const {
    target = 'cashier_usb',
    printerName = 'Rongta RP350 (Cashier - USB)',
    ip = '192.168.1.200',
    port = 9100,
    timeoutMs = 2500,
    checkType = 'port',
  } = req.body || {};

  if (target === 'kitchen_lan') {
    const probe = await testTcpEndpoint(String(ip), Number(port) || 9100, Number(timeoutMs) || 2500);
    const note =
      checkType === 'port'
        ? ' (ملاحظة: فتح منفذ 9100 يثبت اتصال الشبكة فقط ولا يثبت توافق لغة الطابعة حتى يتم طباعة بون اختباري)'
        : '';
    return res.json({
      success: probe.reachable,
      reachable: probe.reachable,
      latencyMs: probe.latencyMs,
      errorCode: probe.errorCode,
      technicalDetails: probe.technicalDetails,
      details: probe.reachable
        ? `تم فتح الاتصال الشبكي مع ${ip}:${port} بنجاح خلال ${probe.latencyMs}ms${note}`
        : probe.error || `تعذر الوصول إلى ${ip}:${port}`,
    });
  }

  if (printerName && isLikelyLabelPrinter(printerName)) {
    return res.json({
      success: false,
      reachable: false,
      errorCode: 'USB_LABEL_PRINTER_BLOCKED',
      details: `الطابعة (${printerName}) هي طابعة باركود/ملصقات TSPL ولا تناسب فواتير Rongta RP350.`,
    });
  }

  const diag = await runWindowsSpoolerAction({
    printerName,
    diagnoseOnly: true,
  });

  return res.json({
    success: diag.ok,
    reachable: diag.ok,
    errorCode: diag.errorCode,
    technicalDetails: diag.technicalDetails,
    resolvedPrinter: diag.resolvedPrinter,
    driverName: diag.driverName,
    portName: diag.portName,
    printerStatus: diag.printerStatus,
    spoolerStatus: diag.spoolerStatus,
    installedPrinters: diag.installedPrinters,
    details: diag.ok
      ? `الطابعة جاهزة في Windows: "${diag.resolvedPrinter}" | المنفذ: ${diag.portName || 'USB'} | التعريف: ${diag.driverName || 'Rongta/ESC-POS'} | الحالة: ${diag.printerStatus || 'Normal'}`
      : diag.error || 'تعذر التحقق من طابعة USB.',
  });
});

/**
 * GET /api/print/jobs
 */
thermalPrintRouter.get('/jobs', (_req, res) => {
  res.json({
    status: 'ok',
    jobs: recentPrintJobs,
  });
});

/**
 * GET /api/print/system-printers
 */
thermalPrintRouter.get('/system-printers', async (_req, res) => {
  const defaultList = [
    'Rongta RP350 (Cashier - USB)',
    'Rongta RP350 (Kitchen - LAN)',
    'RONGTA 80mm Series Printer',
    'RP350 (USB001)',
  ];
  if (process.platform === 'win32') {
    const diag = await runWindowsSpoolerAction({
      printerName: 'Rongta RP350',
      diagnoseOnly: true,
    });
    const winPrinters = diag.installedPrinters || [];
    return res.json({
      status: 'ok',
      spoolerStatus: diag.spoolerStatus,
      osPrinters: winPrinters,
      printers: Array.from(new Set([...winPrinters, ...defaultList])),
    });
  }
  res.json({ status: 'ok', spoolerStatus: 'NotWindows', osPrinters: [], printers: defaultList });
});
