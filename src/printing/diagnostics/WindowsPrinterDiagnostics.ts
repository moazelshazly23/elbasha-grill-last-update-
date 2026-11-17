import { windowsBridge, PrinterTestConnectionResult } from '../../services/windowsBridge';
import { printJobManager } from '../../services/printJobManager';
import { classifyUsbError } from '../core/PrintErrorHandler';

export interface WindowsPrinterCheckResult extends PrinterTestConnectionResult {
  checkedAt: string;
  exactNameMatched?: boolean;
}

export class WindowsPrinterDiagnosticsService {
  public async runCheck(printerName: string): Promise<WindowsPrinterCheckResult> {
    const target = (printerName || '').trim() || 'Rongta RP350 (Cashier - USB)';
    const checkedAt = new Date().toISOString();

    const res = await windowsBridge.testPrinterConnection({
      target: 'cashier_usb',
      printerName: target,
      checkType: 'usb_spooler',
    });

    if (res.reachable) {
      printJobManager.updateConnectionStatus('cashier', 'connected', res.resolvedPrinter || target);
    } else {
      const classified = classifyUsbError(res.details, res.errorCode, target, res.technicalDetails);
      printJobManager.updateConnectionStatus(
        'cashier',
        classified.isOffline ? 'offline' : 'error',
        target,
        classified.userMessageAr,
        classified.code
      );
    }

    const exactNameMatched = Boolean(
      res.resolvedPrinter &&
        res.resolvedPrinter.trim().toLowerCase() === target.trim().toLowerCase()
    );

    return {
      ...res,
      checkedAt,
      exactNameMatched,
    };
  }
}

export const windowsPrinterDiagnostics = new WindowsPrinterDiagnosticsService();
