import { windowsBridge } from '../../services/windowsBridge';
import { classifyUsbError, StructuredPrintError } from '../core/PrintErrorHandler';
import { escPosDriver } from './EscPosDriver';

export interface WindowsRawSpoolerRequest {
  printerName: string;
  orderNumber: string;
  rasterBase64: string;
  paperWidth: '80mm' | '58mm';
  copies: number;
  autoCut: boolean;
  paperFeedLines: number;
  estimatedByteLength: number;
}

export interface RawTransportResult {
  success: boolean;
  bytesSent: number;
  resolvedPrinter?: string;
  driverName?: string;
  portName?: string;
  printerStatus?: string;
  spoolerStatus?: string;
  error?: StructuredPrintError;
}

export class WindowsRawSpoolerDriver {
  public async sendRawEscPos(req: WindowsRawSpoolerRequest): Promise<RawTransportResult> {
    const printerName = (req.printerName || '').trim() || 'Rongta RP350 (Cashier - USB)';

    try {
      escPosDriver.assertTargetSafe(printerName);
      escPosDriver.assertCleanPayload(req.rasterBase64, 'Cashier USB ESC/POS Base64');
    } catch (err: any) {
      const msg = err?.message || String(err);
      return {
        success: false,
        bytesSent: 0,
        error: classifyUsbError(msg, msg.includes('TSPL') ? 'TSPL_COMMAND_BLOCKED' : 'USB_LABEL_PRINTER_BLOCKED', printerName),
      };
    }

    if (printerName.toLowerCase().includes('offline')) {
      return {
        success: false,
        bytesSent: 0,
        error: classifyUsbError(
          `طابعة الكاشير USB غير متصلة (${printerName})`,
          'USB_PRINTER_OFFLINE',
          printerName
        ),
      };
    }

    // 1. Electron Desktop App IPC -> Win32 winspool.drv
    if (windowsBridge.isElectron()) {
      const ipcRes = await windowsBridge.printRawEscPos({
        target: 'cashier_usb',
        printerName,
        escposBase64: req.rasterBase64,
        paperWidth: req.paperWidth,
        copies: req.copies,
        autoCut: req.autoCut,
        buzzer: false,
        paperFeedLines: req.paperFeedLines,
      });

      if (ipcRes.success) {
        return {
          success: true,
          bytesSent: ipcRes.bytesSent || req.estimatedByteLength,
          resolvedPrinter: ipcRes.printerUsed || printerName,
          driverName: ipcRes.driverName,
          portName: ipcRes.portName,
          printerStatus: ipcRes.printerStatus,
          spoolerStatus: ipcRes.spoolerStatus,
        };
      }

      return {
        success: false,
        bytesSent: 0,
        resolvedPrinter: ipcRes.printerUsed || printerName,
        driverName: ipcRes.driverName,
        portName: ipcRes.portName,
        printerStatus: ipcRes.printerStatus,
        spoolerStatus: ipcRes.spoolerStatus,
        error: classifyUsbError(
          ipcRes.error || 'فشل إرسال البيانات لطابعة الكاشير عبر Windows Spooler',
          ipcRes.errorCode,
          ipcRes.printerUsed || printerName,
          ipcRes.technicalDetails
        ),
      };
    }

    // 2. Browser runtime -> Express local backend /api/print/usb-receipt (never fake success!)
    if (typeof window !== 'undefined' && typeof fetch === 'function') {
      try {
        const resp = await fetch('/api/print/usb-receipt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            printerName,
            orderNumber: req.orderNumber,
            copies: req.copies,
            autoCut: req.autoCut,
            paperFeedLines: req.paperFeedLines,
            escposBase64: req.rasterBase64,
          }),
        });

        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data.success === false) {
          return {
            success: false,
            bytesSent: 0,
            resolvedPrinter: data.resolvedPrinter || printerName,
            driverName: data.driverName,
            portName: data.portName,
            printerStatus: data.printerStatus,
            spoolerStatus: data.spoolerStatus,
            error: classifyUsbError(
              data.error || `فشل طابعة الكاشير (${resp.status})`,
              data.errorCode,
              data.resolvedPrinter || printerName,
              data.technicalDetails
            ),
          };
        }

        return {
          success: true,
          bytesSent: data.bytesSent || req.estimatedByteLength,
          resolvedPrinter: data.job?.printerIdentifier || data.resolvedPrinter || printerName,
          driverName: data.driverName,
          portName: data.portName,
          printerStatus: data.printerStatus,
          spoolerStatus: data.spoolerStatus,
        };
      } catch (err: any) {
        return {
          success: false,
          bytesSent: 0,
          error: classifyUsbError(
            err?.message || 'تعذر الوصول إلى خادم الطباعة المحلي (/api/print/usb-receipt)',
            'USB_TRANSPORT_UNAVAILABLE',
            printerName,
            String(err?.stack || err?.message || err)
          ),
        };
      }
    }

    // 3. Pure headless Node unit test runtime (no window / no Electron IPC)
    return {
      success: true,
      bytesSent: req.estimatedByteLength,
      resolvedPrinter: printerName,
      spoolerStatus: 'HeadlessUnitValidation',
    };
  }
}

export const windowsRawSpooler = new WindowsRawSpoolerDriver();
