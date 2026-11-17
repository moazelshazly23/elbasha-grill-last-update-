import { windowsBridge } from '../../services/windowsBridge';
import { classifyUsbError } from '../core/PrintErrorHandler';
import { RawTransportResult } from './WindowsRawSpooler';

export interface WindowsDriverPrintRequest {
  html: string;
  printerName: string;
  paperWidth: '80mm' | '58mm' | 'a4';
  copies: number;
  silent?: boolean;
  skipBrowserDialog?: boolean;
  margins?: { top?: number; bottom?: number; left?: number; right?: number };
}

export class WindowsPrinterDriver {
  public async printHtml(req: WindowsDriverPrintRequest): Promise<RawTransportResult> {
    const res = await windowsBridge.printDirect(req.html, {
      printerName: req.printerName,
      paperWidth: req.paperWidth,
      silent: req.silent !== false,
      copies: req.copies,
      skipBrowserDialog: req.skipBrowserDialog,
      margins: req.margins,
    });

    if (res.success) {
      return {
        success: true,
        bytesSent: req.html.length,
        resolvedPrinter: res.printerUsed || req.printerName,
      };
    }

    return {
      success: false,
      bytesSent: 0,
      error: classifyUsbError(
        res.message || `تعذرت الطباعة عبر تعريف Windows (${req.printerName})`,
        res.errorCode,
        req.printerName,
        res.technicalDetails
      ),
    };
  }
}

export const windowsPrinterDriver = new WindowsPrinterDriver();
