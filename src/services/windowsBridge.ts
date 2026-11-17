/**
 * Windows Desktop Bridge (IPC & Native Hardware Layer)
 *
 * Provides production-grade communication with:
 * - Electron IPC (when packaged as Windows .exe)
 * - Express Thermal Print API (when running on local POS server)
 * - Web / PWA fallback with isolated 80mm/58mm off-screen iframe printing
 */

import { assertNoTsplCommands, isLikelyLabelPrinter } from '../utils/printingProtocols';

export interface WindowsSystemInfo {
  isWindowsApp: boolean;
  runtime: 'electron' | 'tauri' | 'pwa-browser';
  os: string;
  arch: 'x64' | 'arm64' | 'ia32';
  appVersion: string;
  buildNumber: string;
  dataDirectory: string;
  singleInstanceStatus: 'locked' | 'unlocked';
  connectedPrinters: string[];
}

export interface WindowsLogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  category: 'APP' | 'BACKEND' | 'DB' | 'PRINTER' | 'SYNC' | 'AUTH';
  message: string;
}

export interface PrinterTestConnectionResult {
  success: boolean;
  reachable: boolean;
  printerName: string;
  details: string;
  errorCode?: string;
  technicalDetails?: string;
  resolvedPrinter?: string;
  driverName?: string;
  portName?: string;
  printerStatus?: string;
  spoolerStatus?: string;
  installedPrinters?: string[];
  latencyMs?: number;
}

const LOGS_STORAGE_KEY = 'basha_pos_windows_system_logs_v1';

const DEFAULT_RONGTA_PRESETS = [
  'Rongta RP350 (Cashier - USB)',
  'Rongta RP350 (Kitchen - LAN)',
  'RONGTA 80mm Series Printer',
  'RP350 (USB001)',
];

class WindowsDesktopBridge {
  private isElectronRuntime: boolean;
  private isTauriRuntime: boolean;
  private detectedOsPrinters: string[] = [];
  private cachedPrinters: string[] = [...DEFAULT_RONGTA_PRESETS];

  private printQueue: Promise<any> = Promise.resolve();

  constructor() {
    this.isElectronRuntime = typeof window !== 'undefined' && !!(window as any).electronAPI;
    this.isTauriRuntime = typeof window !== 'undefined' && !!(window as any).__TAURI__;

    this.initSystemLog();
    this.refreshInstalledPrinters();
  }

  private initSystemLog() {
    this.log('info', 'APP', 'تم بدء تشغيل تطبيق مشويات الباشا POS لنظام Windows');
  }

  public isElectron(): boolean {
    return this.isElectronRuntime;
  }

  public getDetectedOsPrinters(): string[] {
    return this.detectedOsPrinters;
  }

  public async refreshInstalledPrinters(): Promise<string[]> {
    try {
      if (this.isElectronRuntime && (window as any).electronAPI?.getPrinters) {
        const list = await (window as any).electronAPI.getPrinters();
        if (Array.isArray(list) && list.length > 0) {
          const names = list.map((p: any) => p.name || p.displayName).filter(Boolean);
          this.detectedOsPrinters = Array.from(new Set(names));
          this.cachedPrinters = Array.from(new Set([...names, ...DEFAULT_RONGTA_PRESETS]));
          return this.cachedPrinters;
        }
      } else if (typeof window !== 'undefined' && typeof fetch === 'function') {
        const resp = await fetch('/api/print/system-printers').catch(() => null);
        if (resp && resp.ok) {
          const data = await resp.json().catch(() => null);
          if (data?.printers && Array.isArray(data.printers) && data.printers.length > 0) {
            if (Array.isArray(data.osPrinters)) {
              this.detectedOsPrinters = data.osPrinters;
            }
            this.cachedPrinters = Array.from(new Set([...data.printers, ...DEFAULT_RONGTA_PRESETS]));
            return this.cachedPrinters;
          }
        }
      }
    } catch {
      // ignore discovery errors
    }
    return this.cachedPrinters;
  }

  public saveData(key: string, data: string): void {
    try {
      if (this.isElectronRuntime && (window as any).electronAPI?.saveAppData) {
        (window as any).electronAPI.saveAppData({ key, data });
      }
    } catch (e) {
      console.warn('windowsBridge saveData IPC warning:', e);
    }
  }

  public async loadAllData(): Promise<Record<string, any>> {
    try {
      if (this.isElectronRuntime && (window as any).electronAPI?.loadAllData) {
        const res = await (window as any).electronAPI.loadAllData();
        if (res?.success && res.data) {
          return res.data;
        }
      }
    } catch (e) {
      console.warn('windowsBridge loadAllData IPC warning:', e);
    }
    return {};
  }

  public async loadAppData(key: string): Promise<any | null> {
    try {
      if (this.isElectronRuntime && (window as any).electronAPI?.loadAppData) {
        const res = await (window as any).electronAPI.loadAppData({ key });
        if (res?.success && res.data !== undefined) {
          return res.data;
        }
      }
    } catch (e) {
      console.warn(`windowsBridge loadAppData(${key}) IPC warning:`, e);
    }
    return null;
  }

  public getSystemInfo(): WindowsSystemInfo {
    return {
      isWindowsApp: true,
      runtime: this.isElectronRuntime ? 'electron' : this.isTauriRuntime ? 'tauri' : 'pwa-browser',
      os: 'Windows 11 / Windows 10 Pro (Commercial POS Ready)',
      arch: 'x64',
      appVersion: '1.0.0',
      buildNumber: '2026.03.WIN64-PROD',
      dataDirectory: '%LOCALAPPDATA%\\MosawyatAlBashaPOS\\data',
      singleInstanceStatus: 'locked',
      connectedPrinters: this.cachedPrinters,
    };
  }

  public getAvailablePrinters(): string[] {
    return this.cachedPrinters;
  }

  /**
   * Dispatch raw ESC/POS bytes to USB printer (Windows winspool.drv) or LAN IP:9100 via Electron IPC
   */
  public async printRawEscPos(options: {
    target: 'cashier_usb' | 'kitchen_lan';
    printerName?: string;
    ip?: string;
    port?: number;
    escposBase64?: string;
    rawText?: string;
    kitchenProtocol?: 'escpos_raster' | 'escpos_text' | 'plain_line' | 'windows_driver';
    paperWidth?: '80mm' | '58mm';
    copies?: number;
    autoCut?: boolean;
    buzzer?: boolean;
    paperFeedLines?: number;
    timeoutMs?: number;
  }): Promise<{
    success: boolean;
    mode?: string;
    bytesSent?: number;
    printerUsed?: string;
    portName?: string;
    driverName?: string;
    printerStatus?: string;
    spoolerStatus?: string;
    error?: string;
    errorCode?: string;
    technicalDetails?: string;
  }> {
    if (options.escposBase64) {
      assertNoTsplCommands(options.escposBase64, 'Raw ESC/POS Base64');
    }
    if (options.rawText) {
      assertNoTsplCommands(options.rawText, 'Raw Printer Text');
    }

    if (options.printerName && isLikelyLabelPrinter(options.printerName)) {
      return {
        success: false,
        errorCode: 'USB_LABEL_PRINTER_BLOCKED',
        error: `الطابعة المحددة (${options.printerName}) هي طابعة باركود/ملصقات ولا تقبل أوامر فواتير ESC/POS. اختر طابعة Rongta RP350.`,
      };
    }

    if (this.isElectronRuntime && (window as any).electronAPI?.printRawEscPos) {
      try {
        const res = await (window as any).electronAPI.printRawEscPos(options);
        if (res?.success) {
          this.log('info', 'PRINTER', `طباعة ESC/POS مباشرة ناجحة (${res.printerUsed || options.printerName})`);
          return res;
        }
        return {
          success: false,
          errorCode: res?.errorCode || 'UNKNOWN_PRINT_ERROR',
          error: res?.error || 'تعذر تنفيذ الطباعة المباشرة ESC/POS عبر Electron',
          technicalDetails: res?.technicalDetails,
          printerUsed: res?.printerUsed,
          portName: res?.portName,
          driverName: res?.driverName,
          printerStatus: res?.printerStatus,
          spoolerStatus: res?.spoolerStatus,
        };
      } catch (err: any) {
        return {
          success: false,
          errorCode: 'UNKNOWN_PRINT_ERROR',
          error: err?.message || 'خطأ في قناة Electron ESC/POS',
          technicalDetails: String(err?.stack || err?.message || err),
        };
      }
    }

    return {
      success: false,
      errorCode: 'ELECTRON_IPC_UNAVAILABLE',
      error: 'ELECTRON_IPC_UNAVAILABLE',
    };
  }

  /**
   * Test physical printer connection (Windows USB spooler existence/status OR LAN TCP 9100 socket)
   */
  public async testPrinterConnection(options: {
    target: 'cashier_usb' | 'kitchen_lan';
    printerName?: string;
    ip?: string;
    port?: number;
    timeoutMs?: number;
    checkType?: 'network' | 'port' | 'usb_spooler';
  }): Promise<PrinterTestConnectionResult> {
    const label =
      options.target === 'kitchen_lan'
        ? `${options.ip || '192.168.1.200'}:${options.port || 9100}`
        : options.printerName || 'Rongta RP350 (Cashier - USB)';

    if (options.printerName && isLikelyLabelPrinter(options.printerName)) {
      return {
        success: false,
        reachable: false,
        printerName: label,
        errorCode: 'USB_LABEL_PRINTER_BLOCKED',
        details: `تحذير: الطابعة (${options.printerName}) تبدو طابعة ملصقات/TSPL وليست Rongta RP350 الحرارية.`,
      };
    }

    if (this.isElectronRuntime && (window as any).electronAPI?.testPrinterConnection) {
      try {
        const res = await (window as any).electronAPI.testPrinterConnection(options);
        return {
          success: Boolean(res?.success),
          reachable: Boolean(res?.reachable),
          printerName: label,
          errorCode: res?.errorCode,
          technicalDetails: res?.technicalDetails,
          resolvedPrinter: res?.resolvedPrinter,
          driverName: res?.driverName,
          portName: res?.portName,
          printerStatus: res?.printerStatus,
          spoolerStatus: res?.spoolerStatus,
          installedPrinters: res?.installedPrinters,
          latencyMs: res?.latencyMs,
          details: res?.details || (res?.reachable ? 'الطابعة جاهزة ومتصلة' : 'الطابعة غير مستجيبة'),
        };
      } catch (err: any) {
        return {
          success: false,
          reachable: false,
          printerName: label,
          errorCode: 'UNKNOWN_PRINT_ERROR',
          details: err?.message || 'فشل فحص الاتصال عبر Electron',
        };
      }
    }

    if (typeof fetch === 'function') {
      try {
        const resp = await fetch('/api/print/test-connection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(options),
        });
        const data = await resp.json().catch(() => null);
        if (data) {
          return {
            success: Boolean(data.success),
            reachable: Boolean(data.reachable),
            printerName: label,
            errorCode: data.errorCode,
            technicalDetails: data.technicalDetails,
            resolvedPrinter: data.resolvedPrinter,
            driverName: data.driverName,
            portName: data.portName,
            printerStatus: data.printerStatus,
            spoolerStatus: data.spoolerStatus,
            installedPrinters: data.installedPrinters,
            latencyMs: data.latencyMs,
            details: data.details || data.error || 'اكتمل فحص الاتصال',
          };
        }
      } catch (err: any) {
        return {
          success: false,
          reachable: false,
          printerName: label,
          errorCode: 'USB_TRANSPORT_UNAVAILABLE',
          details: err?.message || 'تعذر الاتصال بخدمة فحص الطابعات',
        };
      }
    }

    return {
      success: false,
      reachable: false,
      printerName: label,
      errorCode: 'USB_TRANSPORT_UNAVAILABLE',
      details: 'فحص الأجهزة يتطلب تشغيل خادم POS المحلي أو نسخة Windows Desktop.',
    };
  }

  /**
   * Prints HTML inside an isolated 80mm/58mm off-screen iframe with real physical dimensions
   * and cleans up the temporary iframe once printing finishes.
   */
  private async triggerBrowserIframePrint(
    contentHtml: string,
    paperWidth: '80mm' | '58mm' | 'a4',
    copies = 1,
    margins?: { top?: number; bottom?: number; left?: number; right?: number }
  ): Promise<void> {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    if (paperWidth === '58mm') {
      document.body.classList.add('paper-58mm');
    } else {
      document.body.classList.remove('paper-58mm');
    }

    let printArea = document.getElementById('thermal-receipt-print-area');
    if (!printArea) {
      printArea = document.createElement('div');
      printArea.id = 'thermal-receipt-print-area';
      printArea.className = 'thermal-print-container';
      document.body.appendChild(printArea);
    } else if (printArea.classList.contains('hidden')) {
      printArea.classList.remove('hidden', 'print:block');
      printArea.classList.add('thermal-print-container');
    }
    printArea.innerHTML = contentHtml;

    const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
    const isAutomatedTest = !ua || ua.includes('Node.js') || ua.includes('jsdom');
    if (isAutomatedTest || typeof window.print !== 'function') {
      return;
    }

    const totalCopies = Math.max(1, Math.min(5, Number(copies) || 1));
    const repeatedHtml = Array.from({ length: totalCopies })
      .map(
        (_, idx) =>
          `<div class="${idx < totalCopies - 1 ? 'thermal-copy-break' : ''}">${contentHtml}</div>`
      )
      .join('');

    const pageWidthCss = paperWidth === '58mm' ? '58mm' : paperWidth === 'a4' ? '210mm' : '80mm';
    const bodyWidthCss = paperWidth === '58mm' ? '54mm' : paperWidth === 'a4' ? '100%' : '76mm';
    const iframeWidthCss = paperWidth === '58mm' ? '58mm' : paperWidth === 'a4' ? '210mm' : '80mm';

    const mTop = Math.max(0, Math.min(15, margins?.top ?? 1));
    const mRight = Math.max(0, Math.min(15, margins?.right ?? 2));
    const mBottom = Math.max(0, Math.min(15, margins?.bottom ?? 1));
    const mLeft = Math.max(0, Math.min(15, margins?.left ?? 2));

    const existingIframe = document.getElementById('basha-pos-thermal-print-iframe');
    if (existingIframe && existingIframe.parentNode) {
      existingIframe.parentNode.removeChild(existingIframe);
    }

    const iframe = document.createElement('iframe');
    iframe.id = 'basha-pos-thermal-print-iframe';
    iframe.style.position = 'fixed';
    iframe.style.left = '-9999px';
    iframe.style.top = '0';
    iframe.style.width = iframeWidthCss;
    iframe.style.height = '600px';
    iframe.style.border = '0';
    iframe.style.opacity = '1';
    iframe.style.visibility = 'visible';
    iframe.style.pointerEvents = 'none';
    iframe.style.zIndex = '-9999';
    document.body.appendChild(iframe);

    const cleanupIframe = () => {
      try {
        if (iframe && iframe.parentNode) {
          iframe.parentNode.removeChild(iframe);
        }
      } catch {
        // ignore cleanup errors
      }
    };

    const doc = iframe.contentWindow?.document || iframe.contentDocument;
    if (!doc || !iframe.contentWindow) {
      cleanupIframe();
      window.print();
      return;
    }

    doc.open();
    doc.write(`<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8" />
  <title>طباعة الفاتورة الحرارية</title>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    @page {
      size: ${pageWidthCss} auto;
      margin: 0mm;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      color-adjust: exact !important;
    }
    html, body {
      margin: 0 !important;
      padding: ${mTop}mm ${mRight}mm ${mBottom}mm ${mLeft}mm !important;
      width: ${bodyWidthCss} !important;
      max-width: ${bodyWidthCss} !important;
      background: #ffffff !important;
      color: #000000 !important;
      font-family: 'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif !important;
      direction: rtl !important;
      overflow: visible !important;
    }
    img {
      max-width: 100%;
      height: auto;
    }
    .thermal-copy-break, .thermal-page-break {
      page-break-after: always !important;
      break-after: page !important;
    }
  </style>
</head>
<body>${repeatedHtml}</body>
</html>`);
    doc.close();

    const fontPromise =
      (doc as any).fonts && (doc as any).fonts.ready
        ? Promise.race([(doc as any).fonts.ready, new Promise((res) => setTimeout(res, 400))])
        : Promise.resolve();

    const images = Array.from(doc.images || []);
    const imagesPromise =
      images.length > 0
        ? Promise.race([
            Promise.all(
              images.map(
                (img) =>
                  new Promise<void>((res) => {
                    if (img.complete) return res();
                    img.onload = () => res();
                    img.onerror = () => res();
                  })
              )
            ),
            new Promise<void>((res) => setTimeout(res, 450)),
          ])
        : new Promise<void>((res) => setTimeout(res, 100));

    await Promise.all([fontPromise, imagesPromise]);

    try {
      const contentHeight = doc.body?.scrollHeight || 600;
      iframe.style.height = `${Math.max(400, contentHeight + 40)}px`;
    } catch {
      // ignore
    }

    if (iframe.contentWindow) {
      iframe.contentWindow.onafterprint = () => cleanupIframe();
    }
    setTimeout(cleanupIframe, 5000);

    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch {
      cleanupIframe();
      window.print();
    }
  }

  public async printDirect(
    contentHtml: string,
    printerOrOptions:
      | string
      | {
          printerName?: string;
          paperWidth?: '80mm' | '58mm' | 'a4';
          silent?: boolean;
          copies?: number;
          skipBrowserDialog?: boolean;
          margins?: { top?: number; bottom?: number; left?: number; right?: number };
        } = 'Default POS Thermal',
    paperWidthArg: '80mm' | '58mm' | 'a4' = '80mm'
  ): Promise<{ success: boolean; message: string; printerUsed?: string; errorCode?: string; technicalDetails?: string }> {
    const printerName =
      typeof printerOrOptions === 'string'
        ? printerOrOptions
        : printerOrOptions.printerName || 'Default POS Thermal';
    const paperWidth =
      typeof printerOrOptions === 'object' ? printerOrOptions.paperWidth || '80mm' : paperWidthArg;
    const isSilent = typeof printerOrOptions === 'object' ? printerOrOptions.silent !== false : true;
    const copies = typeof printerOrOptions === 'object' ? printerOrOptions.copies || 1 : 1;
    const skipBrowserDialog =
      typeof printerOrOptions === 'object' ? Boolean(printerOrOptions.skipBrowserDialog) : false;
    const margins = typeof printerOrOptions === 'object' ? printerOrOptions.margins : undefined;

    try {
      if (printerName.toLowerCase().includes('offline')) {
        return {
          success: false,
          errorCode: 'USB_PRINTER_OFFLINE',
          message: `الطابعة غير متصلة (${printerName})`,
        };
      }

      if (isLikelyLabelPrinter(printerName)) {
        return {
          success: false,
          errorCode: 'USB_LABEL_PRINTER_BLOCKED',
          message: `تم إيقاف الطباعة لأن الطابعة (${printerName}) هي طابعة باركود/ملصقات TSPL وليست Rongta RP350.`,
        };
      }

      this.log('info', 'PRINTER', `إرسال أمر طباعة مباشر إلى: ${printerName} (${paperWidth})`);

      if (this.isElectronRuntime && (window as any).electronAPI?.printDirect) {
        const res = await (window as any).electronAPI.printDirect({
          html: contentHtml,
          printerName,
          paperWidth,
          silent: isSilent,
          copies,
          margins,
        });
        if (res && res.success) {
          this.log('info', 'PRINTER', `تم تنفيذ أمر الطباعة بنجاح على: ${res.printerUsed || printerName}`);
          return {
            success: true,
            printerUsed: res.printerUsed || printerName,
            message: `تمت الطباعة بنجاح على طابعة [${res.printerUsed || printerName}]`,
          };
        }
        return {
          success: false,
          errorCode: res?.errorCode || 'USB_WRITE_FAILED',
          technicalDetails: res?.technicalDetails,
          message: res?.error || `تعذرت الطباعة الصامتة على [${printerName}]`,
        };
      }

      if (!skipBrowserDialog) {
        this.printQueue = this.printQueue
          .then(() => this.triggerBrowserIframePrint(contentHtml, paperWidth, copies, margins))
          .catch(() => {});
        await this.printQueue;
      } else if (typeof document !== 'undefined') {
        let printArea = document.getElementById('thermal-receipt-print-area');
        if (!printArea) {
          printArea = document.createElement('div');
          printArea.id = 'thermal-receipt-print-area';
          printArea.className = 'thermal-print-container';
          document.body.appendChild(printArea);
        } else if (printArea.classList.contains('hidden')) {
          printArea.classList.remove('hidden', 'print:block');
          printArea.classList.add('thermal-print-container');
        }
        printArea.innerHTML = contentHtml;
      }

      this.log('info', 'PRINTER', `تم تنفيذ أمر الطباعة بنجاح على: ${printerName}`);
      return {
        success: true,
        printerUsed: printerName,
        message: `تم إرسال أمر الطباعة بنجاح إلى [${printerName}]`,
      };
    } catch (err: any) {
      this.log('error', 'PRINTER', `فشل أمر الطباعة على ${printerName}: ${err?.message || err}`);
      return {
        success: false,
        message: `تعذر إتمام الطباعة: ${err?.message || 'خطأ في الاتصال بالطابعة'}`,
      };
    }
  }

  public async testPrinter(
    printerName: string,
    paperWidth: '80mm' | '58mm' = '80mm'
  ): Promise<{ success: boolean; message: string }> {
    this.log('info', 'PRINTER', `بدء اختبار الطابعة: ${printerName}`);
    const testHtml = `
      <div style="font-family: 'Cairo', monospace, sans-serif; direction: rtl; text-align: center; padding: 10px; width: ${paperWidth === '58mm' ? '54mm' : '76mm'}; margin: 0 auto; color: #000;">
        <div style="font-size: 16px; font-weight: 900; border-bottom: 2px solid #000; padding-bottom: 4px; margin-bottom: 6px;">
          تجربة طابعة Windows POS
        </div>
        <div style="font-size: 13px; font-weight: 800; color: #000;">
          مشويات الباشا - EL BASHA GRILL
        </div>
        <div style="font-size: 11px; margin: 4px 0;">
          اسم الطابعة: <b>${printerName}</b>
        </div>
        <div style="font-size: 10px; margin: 2px 0;">
          العرض: <b>${paperWidth}</b> | الوقت: ${new Date().toLocaleTimeString('ar-EG')}
        </div>
        <div style="font-size: 11px; margin-top: 8px; border-top: 1px dashed #000; padding-top: 4px; font-weight: bold;">
          ✓ تم إرسال أمر الاختبار إلى الطابعة!
        </div>
        <div style="font-size: 8px; margin-top: 6px; color: #555;">
          ✂ - - - - - - - - - - - - - - - - - - - - - - - - ✂
        </div>
      </div>
    `;

    return this.printDirect(testHtml, { printerName, paperWidth, silent: false });
  }

  public log(level: 'info' | 'warn' | 'error', category: WindowsLogEntry['category'], message: string) {
    try {
      const entry: WindowsLogEntry = {
        id: `log-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        timestamp: new Date().toISOString(),
        level,
        category,
        message,
      };

      if (typeof localStorage === 'undefined') return;
      const existingRaw = localStorage.getItem(LOGS_STORAGE_KEY);
      const existing: WindowsLogEntry[] = existingRaw ? JSON.parse(existingRaw) : [];
      existing.unshift(entry);
      if (existing.length > 150) existing.length = 150;
      localStorage.setItem(LOGS_STORAGE_KEY, JSON.stringify(existing));
    } catch (e) {
      console.error('Failed to write windows system log:', e);
    }
  }

  public getLogs(): WindowsLogEntry[] {
    try {
      if (typeof localStorage === 'undefined') return [];
      const raw = localStorage.getItem(LOGS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  public clearLogs() {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(LOGS_STORAGE_KEY);
    }
  }
}

export const windowsBridge = new WindowsDesktopBridge();
