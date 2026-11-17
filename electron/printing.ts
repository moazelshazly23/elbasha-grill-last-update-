/**
 * Native Printing Service for Windows POS Thermal Printers (Rongta RP350 80mm/58mm)
 *
 * Handles:
 * 1. Raw ESC/POS binary dispatch (Windows winspool.drv RAW USB + LAN TCP/IP Port 9100)
 * 2. Kitchen protocol routing (escpos_raster | escpos_text | plain_line | windows_driver)
 * 3. Windows Driver HTML silent printing with isolated worker window & strict printer matching
 * 4. Deep Windows Spooler & LAN TCP diagnostics without masking errors
 */

import { BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  assertNoTsplCommands,
  buildEscPosReceiptBytes,
  isLikelyLabelPrinter,
} from '../src/utils/printingProtocols.js';
import {
  sendRawTcpSocket,
  testTcpEndpoint,
  runWindowsSpoolerAction,
} from '../server/nativePrintCore.js';
import type {
  PrintOptions,
  PrintResult,
  PrinterDevice,
  RawEscPosOptions,
  RawEscPosResult,
  TestConnectionOptions,
  TestConnectionResult,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXTRA_SPOOLER_CANDIDATES = [
  path.resolve(__dirname, '..', 'server', 'rawPrintSpooler.ps1'),
];

export class NativePrintingService {
  /**
   * Retrieves all installed local and network printers from Windows spooler
   */
  public static async getAvailablePrinters(window: BrowserWindow): Promise<PrinterDevice[]> {
    try {
      const printers = await window.webContents.getPrintersAsync();
      return printers.map((p) => {
        const anyP = p as any;
        return {
          name: p.name,
          displayName: p.displayName || p.name,
          description: p.description || '',
          status: typeof anyP.status === 'number' ? anyP.status : 0,
          isDefault: Boolean(anyP.isDefault),
        };
      });
    } catch (err) {
      console.error('[NativePrintingService] Failed to get printers:', err);
      return [];
    }
  }

  /**
   * Direct Raw ESC/POS & Kitchen Protocol binary dispatch for Rongta RP350 USB & LAN
   */
  public static async printRawEscPos(options: RawEscPosOptions): Promise<RawEscPosResult> {
    try {
      if (options.escposBase64) {
        assertNoTsplCommands(options.escposBase64, 'Electron Raw ESC/POS');
      }
      if (options.rawText) {
        assertNoTsplCommands(options.rawText, 'Electron Raw Text');
      }

      if (options.printerName && isLikelyLabelPrinter(options.printerName)) {
        return {
          success: false,
          errorCode: 'USB_LABEL_PRINTER_BLOCKED',
          error: `الطابعة (${options.printerName}) هي طابعة باركود/ملصقات TSPL وليست Rongta RP350.`,
        };
      }

      let payloadBuffer: Buffer;
      const kProto = options.kitchenProtocol || 'escpos_raster';
      if (options.target === 'kitchen_lan' && kProto === 'plain_line') {
        const copies = Math.max(1, Math.min(5, options.copies ?? 1));
        const feed = Math.max(2, options.paperFeedLines ?? 4);
        const single = Buffer.from((options.rawText || '') + '\n'.repeat(feed), 'utf8');
        payloadBuffer = Buffer.concat(Array.from({ length: copies }, () => single));
      } else if (options.target === 'kitchen_lan' && kProto === 'escpos_text') {
        const copies = Math.max(1, Math.min(5, options.copies ?? 1));
        const feed = Math.max(0, Math.min(10, options.paperFeedLines ?? 4));
        const chunks: Buffer[] = [Buffer.from([0x1b, 0x40])];
        if (options.buzzer) chunks.push(Buffer.from([0x1b, 0x42, 0x03, 0x02, 0x07]));
        chunks.push(Buffer.from((options.rawText || '') + '\n', 'utf8'));
        if (feed > 0) chunks.push(Buffer.from([0x1b, 0x64, feed]));
        if (options.autoCut !== false) chunks.push(Buffer.from([0x1d, 0x56, 0x42, 0x00]));
        const single = Buffer.concat(chunks);
        payloadBuffer = Buffer.concat(Array.from({ length: copies }, () => single));
      } else {
        const payloadBytes = buildEscPosReceiptBytes({
          rasterBase64: options.escposBase64,
          alignment: 'center',
          paperFeedLines: options.paperFeedLines ?? 4,
          autoCut: options.autoCut !== false,
          buzzer: Boolean(options.buzzer),
          copies: options.copies ?? 1,
        });
        payloadBuffer = Buffer.from(payloadBytes);
      }

      if (options.target === 'kitchen_lan') {
        const ip = String(options.ip || '').trim();
        const port = Number(options.port) || 9100;
        const tcpRes = await sendRawTcpSocket(ip, port, payloadBuffer, {
          connectTimeoutMs: options.timeoutMs ?? 3000,
          writeTimeoutMs: Math.max(4000, (options.timeoutMs ?? 3000) + 1500),
          retries: 1,
        });
        if (!tcpRes.ok) {
          return {
            success: false,
            errorCode: tcpRes.errorCode || 'LAN_WRITE_ERROR',
            error: tcpRes.error || `تعذر الاتصال بطابعة المطبخ (${ip}:${port})`,
            technicalDetails: tcpRes.technicalDetails,
            printerUsed: `${ip}:${port}`,
          };
        }
        return {
          success: true,
          mode: 'raw-tcp-9100',
          bytesSent: tcpRes.bytesSent,
          printerUsed: `${ip}:${port}`,
        };
      }

      const winResult = await runWindowsSpoolerAction({
        printerName: options.printerName || 'Rongta RP350 (Cashier - USB)',
        payload: payloadBuffer,
        diagnoseOnly: false,
        extraScriptCandidates: EXTRA_SPOOLER_CANDIDATES,
      });

      if (!winResult.ok) {
        return {
          success: false,
          errorCode: winResult.errorCode || 'USB_WRITE_FAILED',
          error: winResult.error || 'فشل إرسال بايتات ESC/POS عبر winspool.drv',
          technicalDetails: winResult.technicalDetails,
          printerUsed: winResult.resolvedPrinter || options.printerName,
          portName: winResult.portName,
          driverName: winResult.driverName,
          printerStatus: winResult.printerStatus,
          spoolerStatus: winResult.spoolerStatus,
        };
      }

      return {
        success: true,
        mode: 'winspool-raw',
        bytesSent: winResult.bytesSent || payloadBuffer.length,
        printerUsed: winResult.resolvedPrinter || options.printerName,
        portName: winResult.portName,
        driverName: winResult.driverName,
        printerStatus: winResult.printerStatus,
        spoolerStatus: winResult.spoolerStatus,
      };
    } catch (err: any) {
      return {
        success: false,
        errorCode: 'UNKNOWN_PRINT_ERROR',
        error: err?.message || 'خطأ غير متوقع في قناة الطباعة الخام ESC/POS',
        technicalDetails: String(err?.stack || err?.message || err),
      };
    }
  }

  /**
   * Deep USB / LAN printer diagnostics
   */
  public static async testPrinterConnection(
    window: BrowserWindow,
    options: TestConnectionOptions
  ): Promise<TestConnectionResult> {
    if (options.target === 'kitchen_lan') {
      const ip = String(options.ip || '').trim();
      const port = Number(options.port) || 9100;
      const tcpRes = await testTcpEndpoint(ip, port, options.timeoutMs ?? 2500);
      const note =
        options.checkType === 'port'
          ? ' (فحص منفذ TCP فقط — نفّذ اختبار طباعة بون مطبخ للتحقق من توافق لغة الطباعة)'
          : '';
      return {
        success: tcpRes.reachable,
        reachable: tcpRes.reachable,
        latencyMs: tcpRes.latencyMs,
        errorCode: tcpRes.errorCode,
        technicalDetails: tcpRes.technicalDetails,
        details: tcpRes.reachable
          ? `تم فتح منفذ TCP ${ip}:${port} بنجاح خلال ${tcpRes.latencyMs}ms${note}`
          : tcpRes.error || `تعذر الوصول لطابعة المطبخ (${ip}:${port})`,
      };
    }

    const reqName = (options.printerName || '').replace(/\s*\[.*?\]\s*$/, '').trim();
    if (reqName && isLikelyLabelPrinter(reqName)) {
      return {
        success: false,
        reachable: false,
        errorCode: 'USB_LABEL_PRINTER_BLOCKED',
        details: `الطابعة (${reqName}) طابعة باركود/TSPL ولا تصلح لفواتير Rongta RP350.`,
      };
    }

    // Use deep Windows Spooler diagnostic when running on Windows
    if (process.platform === 'win32') {
      const diag = await runWindowsSpoolerAction({
        printerName: reqName || 'Rongta RP350 (Cashier - USB)',
        diagnoseOnly: true,
        extraScriptCandidates: EXTRA_SPOOLER_CANDIDATES,
      });
      return {
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
          ? `الطابعة جاهزة: "${diag.resolvedPrinter}" | المنفذ: ${diag.portName || 'USB'} | التعريف: ${diag.driverName || 'Windows Driver'} | الحالة: ${diag.printerStatus || 'Normal'}`
          : diag.error || `لم يتم العثور على طابعة Rongta RP350 مطابقة لـ (${reqName || 'USB'}).`,
      };
    }

    // Electron non-Windows inspection fallback
    const installed = await NativePrintingService.getAvailablePrinters(window);
    const matched = installed.find((p) => {
      if (isLikelyLabelPrinter(p.name)) return false;
      const lower = p.name.toLowerCase();
      return (
        (reqName && (lower === reqName.toLowerCase() || lower.includes(reqName.toLowerCase()))) ||
        lower.includes('rp350') ||
        lower.includes('rongta')
      );
    });

    if (matched) {
      return {
        success: true,
        reachable: true,
        resolvedPrinter: matched.name,
        installedPrinters: installed.map((p) => p.name),
        details: `الطابعة متصلة في نظام التشغيل: ${matched.name}`,
      };
    }

    return {
      success: false,
      reachable: false,
      errorCode: 'USB_PRINTER_NOT_FOUND',
      installedPrinters: installed.map((p) => p.name),
      details: `لم يتم العثور على طابعة Rongta RP350 مطابقة لـ (${reqName || 'USB'}).`,
    };
  }

  /**
   * Executes silent Windows-Driver receipt printing in an isolated background worker window
   */
  public static async printSilent(options: PrintOptions): Promise<PrintResult> {
    const { html, printerName, paperWidth = '80mm', silent = true, copies = 1, margins } = options;

    try {
      assertNoTsplCommands(html, 'Electron Driver HTML Print');
    } catch (err: any) {
      return {
        success: false,
        errorCode: 'TSPL_COMMAND_BLOCKED',
        error: err?.message || 'Blocked invalid TSPL command in receipt',
      };
    }

    return new Promise((resolve) => {
      let printWorker: BrowserWindow | null = null;
      let hasFinished = false;

      const timeoutTimer = setTimeout(() => {
        if (!hasFinished) {
          hasFinished = true;
          if (printWorker && !printWorker.isDestroyed()) {
            printWorker.destroy();
          }
          resolve({
            success: false,
            errorCode: 'USB_WRITE_FAILED',
            error: 'انتهت مهلة إرسال مستند الطباعة إلى Windows Spooler (20s timeout)',
          });
        }
      }, 20000);

      const cleanup = (result: PrintResult) => {
        if (!hasFinished) {
          hasFinished = true;
          clearTimeout(timeoutTimer);
          if (printWorker && !printWorker.isDestroyed()) {
            printWorker.destroy();
          }
          resolve(result);
        }
      };

      try {
        printWorker = new BrowserWindow({
          show: false,
          width: paperWidth === '58mm' ? 384 : paperWidth === '80mm' ? 576 : 800,
          height: 1000,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
          },
        });

        const mTop = Math.max(0, Math.min(15, margins?.top ?? 1));
        const mRight = Math.max(0, Math.min(15, margins?.right ?? 2));
        const mBottom = Math.max(0, Math.min(15, margins?.bottom ?? 1));
        const mLeft = Math.max(0, Math.min(15, margins?.left ?? 2));

        const styledReceiptHtml = `
          <!DOCTYPE html>
          <html dir="rtl" lang="ar">
            <head>
              <meta charset="utf-8" />
              <style>
                @page {
                  margin: 0;
                  size: ${paperWidth === '58mm' ? '58mm auto' : paperWidth === '80mm' ? '80mm auto' : 'A4'};
                }
                * {
                  box-sizing: border-box;
                  -webkit-print-color-adjust: exact !important;
                  print-color-adjust: exact !important;
                }
                body {
                  margin: 0;
                  padding: ${mTop}mm ${mRight}mm ${mBottom}mm ${mLeft}mm;
                  font-family: 'Cairo', 'Segoe UI', Arial, sans-serif;
                  width: ${paperWidth === '58mm' ? '54mm' : paperWidth === '80mm' ? '76mm' : '100%'};
                  background: #ffffff;
                  color: #000000;
                }
                img {
                  max-width: 100%;
                  height: auto;
                }
              </style>
            </head>
            <body>
              ${html}
            </body>
          </html>
        `;

        printWorker.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(styledReceiptHtml)}`);

        printWorker.webContents.on('did-finish-load', async () => {
          if (!printWorker || printWorker.isDestroyed()) return;

          const reqClean = (printerName || '').replace(/\s*\[.*?\]\s*$/, '').trim();
          if (reqClean && isLikelyLabelPrinter(reqClean)) {
            cleanup({
              success: false,
              errorCode: 'USB_LABEL_PRINTER_BLOCKED',
              error: `الطابعة (${reqClean}) مصنفة كطابعة ملصقات/TSPL وليست طابعة فواتير.`,
              printerUsed: reqClean,
            });
            return;
          }

          let resolvedDeviceName = '';
          let availableNames: string[] = [];
          try {
            const installed = await printWorker.webContents.getPrintersAsync();
            availableNames = installed.map((p) => p.name);
            if (Array.isArray(installed) && installed.length > 0) {
              const lowerReq = reqClean.toLowerCase();
              const normReq = lowerReq.replace(/[\s\-_()]/g, '');
              const nonLabelPrinters = installed.filter((p) => !isLikelyLabelPrinter(p.name));

              const exact = nonLabelPrinters.find(
                (p) => p.name.toLowerCase() === lowerReq || (p.displayName && p.displayName.toLowerCase() === lowerReq)
              );
              if (exact) {
                resolvedDeviceName = exact.name;
              } else if (lowerReq) {
                const isKitchenReq = lowerReq.includes('kitchen') || lowerReq.includes('مطبخ') || lowerReq.includes('lan');
                const keywordMatch = nonLabelPrinters.find((p) => {
                  const n = `${p.name} ${p.displayName || ''}`.toLowerCase();
                  const nNorm = n.replace(/[\s\-_()]/g, '');
                  if (n.includes('pdf') || n.includes('xps') || n.includes('onenote') || n.includes('fax')) return false;
                  if (normReq && nNorm.includes(normReq)) return true;
                  if (isKitchenReq && (n.includes('kitchen') || n.includes('lan') || n.includes('مطبخ'))) return true;
                  if (!isKitchenReq && (n.includes('cashier') || n.includes('usb') || n.includes('كاشير'))) return true;
                  return (
                    n.includes('rp350') ||
                    n.includes('rp-350') ||
                    n.includes('rongta') ||
                    n.includes('80mm') ||
                    n.includes('pos-80') ||
                    n.includes('pos80')
                  );
                });
                if (keywordMatch) {
                  resolvedDeviceName = keywordMatch.name;
                } else {
                  const defaultThermal = nonLabelPrinters.find((p: any) => {
                    const n = p.name.toLowerCase();
                    return (
                      p.isDefault &&
                      (n.includes('rp350') ||
                        n.includes('rp-350') ||
                        n.includes('rongta') ||
                        n.includes('80mm') ||
                        n.includes('pos'))
                    );
                  });
                  resolvedDeviceName = defaultThermal ? defaultThermal.name : '';
                }
              }
            }
          } catch {
            resolvedDeviceName = '';
          }

          if (!resolvedDeviceName && silent) {
            cleanup({
              success: false,
              errorCode: availableNames.length === 0 ? 'USB_PRINTER_NOT_FOUND' : 'USB_INCORRECT_NAME',
              error: `لم يتم العثور على الطابعة الحرارية (${reqClean || 'Rongta RP350'}) ضمن طابعات Windows المثبتة.`,
              technicalDetails: `Installed Windows Printers: [${availableNames.join(', ')}]`,
              printerUsed: reqClean,
            });
            return;
          }

          printWorker.webContents.print(
            {
              silent,
              printBackground: true,
              deviceName: resolvedDeviceName,
              copies: Math.max(1, copies),
              margins: {
                marginType: 'none',
              },
            },
            (success, failureReason) => {
              if (success) {
                cleanup({ success: true, printerUsed: resolvedDeviceName || 'Selected Printer' });
              } else {
                cleanup({
                  success: false,
                  errorCode: 'USB_WRITE_FAILED',
                  error: failureReason || `فشل الطباعة عبر تعريف Windows للطابعة (${resolvedDeviceName || reqClean})`,
                  technicalDetails: `Chromium print failureReason="${failureReason}" on device="${resolvedDeviceName}"`,
                  printerUsed: resolvedDeviceName || reqClean,
                });
              }
            }
          );
        });

        printWorker.webContents.on('did-fail-load', (_, errorCode, errorDescription) => {
          cleanup({
            success: false,
            errorCode: 'USB_WRITE_FAILED',
            error: `Failed to load receipt template: ${errorDescription} (${errorCode})`,
          });
        });
      } catch (err: any) {
        cleanup({
          success: false,
          errorCode: 'UNKNOWN_PRINT_ERROR',
          error: err?.message || 'Exception in native printing pipeline',
        });
      }
    });
  }
}
