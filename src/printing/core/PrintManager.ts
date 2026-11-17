import { Order, RestaurantProfile } from '../../types';
import { posDb } from '../../services/db';
import { createAndDispatchOrderTickets } from '../../services/kitchenStationService';
import { sharedKitchenPrintQueue } from './SharedKitchenPrintQueue';
import { PrintingMode } from '../../utils/printingProtocols';
import { cashierPrinterAdapter, PrinterExecutionResult } from '../adapters/CashierPrinterAdapter';
import { kitchenPrinterAdapter } from '../adapters/KitchenPrinterAdapter';
import { printJobQueue } from './PrintJobQueue';
import {
  createSampleTestOrder,
  generateReceiptQRCode,
  generateThermalReceiptHTML,
  RasterLineSpec,
} from '../templates/ReceiptTemplate';
import {
  generateKitchenTicketHTML,
  generateStationKitchenTicketHTML,
} from '../templates/KitchenTicketTemplate';
import { windowsBridge } from '../../services/windowsBridge';

export interface DualPrintExecutionResult {
  cashierOk: boolean;
  kitchenOk: boolean;
  errors: string[];
  detailedErrors: string[];
  cashierResult?: PrinterExecutionResult;
  kitchenResult?: PrinterExecutionResult;
}

export class PrintManager {
  public async printCashierReceipt(
    order: Order,
    profile: RestaurantProfile,
    options?: { skipBrowserDialog?: boolean; isReprint?: boolean; targetOverride?: 'cashier' | 'test'; retryCount?: number }
  ): Promise<PrinterExecutionResult> {
    return cashierPrinterAdapter.printCustomerReceipt(order, profile, options);
  }

  public async printKitchenTicket(
    order: Order,
    profile: RestaurantProfile,
    options?: { skipBrowserDialog?: boolean; isReprint?: boolean; targetOverride?: 'kitchen' | 'test'; retryCount?: number }
  ): Promise<PrinterExecutionResult> {
    if (options?.targetOverride === 'test') {
      return kitchenPrinterAdapter.printKitchenOrderTicket(order, profile, options);
    }

    const rs = profile.receiptSettings;
    const protocol = kitchenPrinterAdapter.resolveProtocol(profile);
    const targetPrinter = profile.kitchenPrinterName || 'Rongta RP350 (Kitchen - LAN)';
    const kitchenIp = rs?.kitchenPrinterIp || profile.kitchenPrinterIp || '192.168.1.200';
    const kitchenPort = Number(rs?.kitchenPrinterPort ?? profile.kitchenPrinterPort ?? 9100) || 9100;
    const displayPrinter = protocol === 'windows_driver' ? targetPrinter : `${targetPrinter} (${kitchenIp}:${kitchenPort})`;

    const { tickets, outcome } = await createAndDispatchOrderTickets(order, profile, {
      isReprint: options?.isReprint,
    });

    if (outcome.allOk) {
      return {
        success: true,
        target: 'kitchen',
        jobId: outcome.results[0]?.jobId || `batch-${order.id}`,
        printerName: displayPrinter,
        resolvedPrinter: protocol === 'windows_driver' ? targetPrinter : `${kitchenIp}:${kitchenPort}`,
        protocol,
        bytesSent: tickets.length * 512,
      };
    }

    const firstFailure = outcome.results.find((r) => !r.success);
    return {
      success: false,
      target: 'kitchen',
      jobId: firstFailure?.jobId || `batch-fail-${order.id}`,
      printerName: displayPrinter,
      protocol,
      bytesSent: 0,
      errorMessage:
        firstFailure?.errorMessage ||
        `تعذر طباعة ${outcome.failedCount} تذكرة محطة على طابعة المطبخ المشتركة`,
    };
  }

  public async dispatchDualPrint(
    order: Order,
    profile: RestaurantProfile,
    targets: { cashier?: boolean; kitchen?: boolean; isReprint?: boolean } = { cashier: true, kitchen: true }
  ): Promise<DualPrintExecutionResult> {
    const runCashier = targets.cashier !== false && profile.autoPrintReceipt !== false;
    const runKitchen = targets.kitchen !== false && profile.kitchenAutoPrint !== false;
    const cashierMode: PrintingMode = profile.receiptSettings?.printingMode || profile.printingMode || 'escpos_raw';
    const kitchenProto = kitchenPrinterAdapter.resolveProtocol(profile);

    const isBrowserOnly =
      typeof window !== 'undefined' &&
      typeof document !== 'undefined' &&
      !(window as any).electronAPI;

    const skipIndividualBrowserDialog =
      isBrowserOnly && runCashier && runKitchen && cashierMode === 'windows_driver' && kitchenProto === 'windows_driver';

    const [cashierResult, kitchenResult] = await Promise.all([
      runCashier
        ? cashierPrinterAdapter.printCustomerReceipt(order, profile, {
            skipBrowserDialog: skipIndividualBrowserDialog,
            isReprint: targets.isReprint,
          })
        : Promise.resolve(undefined),
      runKitchen
        ? this.printKitchenTicket(order, profile, {
            skipBrowserDialog: skipIndividualBrowserDialog,
            isReprint: targets.isReprint,
          })
        : Promise.resolve(undefined),
    ]);

    const cashierOk = !runCashier || Boolean(cashierResult?.success);
    const kitchenOk = !runKitchen || Boolean(kitchenResult?.success);

    // Combined browser print dialog fallback ONLY when both use Windows Driver in browser mode
    if (skipIndividualBrowserDialog && (cashierOk || kitchenOk)) {
      try {
        const rs = profile.receiptSettings;
        const paperWidth = (rs?.paperWidth || profile.thermalPaperWidth) === '58mm' ? '58mm' : '80mm';
        const qrDataUrl = await generateReceiptQRCode(order, profile);
        const cashierHtml = generateThermalReceiptHTML(order, profile, qrDataUrl);
        const stationTickets = posDb.getKitchenTickets({ orderId: order.id }).filter((t) => t.ticketType === 'NEW');
        const kitchenHtml =
          stationTickets.length > 0
            ? stationTickets
                .map((tk) => `<div class="thermal-page-break">${generateStationKitchenTicketHTML(tk, profile)}</div>`)
                .join('')
            : generateKitchenTicketHTML(order, profile);
        const combinedHtml =
          cashierOk && kitchenOk
            ? `<div class="thermal-page-break">${cashierHtml}</div><div style="margin-top: 4mm;">${kitchenHtml}</div>`
            : cashierOk
            ? cashierHtml
            : kitchenHtml;

        await windowsBridge.printDirect(combinedHtml, {
          printerName: rs?.cashierPrinterUsbName || profile.receiptPrinterName || 'Rongta RP350 (Cashier - USB)',
          paperWidth,
          silent: false,
        });
      } catch {
        // ignore combined fallback error
      }
    }

    const errors: string[] = [];
    const detailedErrors: string[] = [];

    if (!cashierOk) {
      const usbName = profile.receiptSettings?.cashierPrinterUsbName || profile.receiptPrinterName || 'طابعة الكاشير (USB)';
      errors.push(usbName);
      detailedErrors.push(cashierResult?.errorMessage || `فشل طابعة الكاشير (${usbName})`);
    }
    if (!kitchenOk) {
      const ip = profile.receiptSettings?.kitchenPrinterIp || profile.kitchenPrinterIp || '192.168.1.200';
      const port = profile.receiptSettings?.kitchenPrinterPort || profile.kitchenPrinterPort || 9100;
      errors.push(`طابعة المطبخ (LAN ${ip}:${port})`);
      detailedErrors.push(kitchenResult?.errorMessage || `فشل طابعة المطبخ (${ip}:${port})`);
    }

    return {
      cashierOk,
      kitchenOk,
      errors,
      detailedErrors,
      cashierResult,
      kitchenResult,
    };
  }

  public async retryFailedKitchenTicketsForOrder(orderId: string, profile: RestaurantProfile) {
    return sharedKitchenPrintQueue.retryFailedJobs(profile, orderId);
  }

  /**
   * Safe Manual Reprint:
   * - Never creates or duplicates an order
   * - Never touches inventory/ingredient deductions
   * - Blocks accidental rapid double-click within 1200ms
   * - Records explicit audit entry
   */
  public async reprintOrder(
    order: Order,
    profile: RestaurantProfile,
    scope: 'cashier' | 'kitchen' | 'both',
    actor?: { userId?: string; userName?: string }
  ): Promise<DualPrintExecutionResult> {
    const lockKey = `reprint:${order.id}:${scope}`;
    if (!printJobQueue.tryAcquireManualLock(lockKey, 1200)) {
      return {
        cashierOk: false,
        kitchenOk: false,
        errors: ['تم منع التكرار السريع للضغط المتكرر'],
        detailedErrors: ['انتظر ثانية قبل إعادة الضغط على زر إعادة الطباعة لمنع تكرار الورق.'],
      };
    }

    try {
      const res = await this.dispatchDualPrint(order, profile, {
        cashier: scope === 'cashier' || scope === 'both',
        kitchen: scope === 'kitchen' || scope === 'both',
        isReprint: true,
      });

      // Only update print status metadata on the existing order — NEVER createOrder / deduct inventory
      if ((scope === 'cashier' || scope === 'both') && res.cashierResult) {
        posDb.updateOrderPrintStatus(order.id, res.cashierOk ? 'printed' : 'failed');
      }
      if ((scope === 'kitchen' || scope === 'both') && res.kitchenResult) {
        posDb.updateOrderKitchenPrintStatus(
          order.id,
          res.kitchenOk ? 'printed' : 'failed',
          res.kitchenOk ? undefined : res.kitchenResult.errorMessage
        );
      }

      posDb.logAudit({
        userId: actor?.userId || 'cashier',
        userName: actor?.userName || order.cashierName || 'كاشير',
        action: `إعادة طباعة (${scope === 'both' ? 'الكاشير والمطبخ' : scope === 'cashier' ? 'الكاشير' : 'المطبخ'})`,
        category: 'order',
        details: `إعادة طباعة للطلب ${order.orderNumber} (${order.id}) | النتيجة: كاشير=${res.cashierOk ? 'نجاح' : 'فشل'}, مطبخ=${
          res.kitchenOk ? 'نجاح' : 'فشل'
        }${res.detailedErrors.length ? ` | الأخطاء: ${res.detailedErrors.join(' ؛ ')}` : ''}`,
      });

      return res;
    } finally {
      // Allow intentional reprint after short completion safety window
      setTimeout(() => printJobQueue.releaseManualLock(lockKey), 300);
    }
  }

  public async printTestReceipt(profile: RestaurantProfile): Promise<PrinterExecutionResult> {
    const dummyOrder = createSampleTestOrder();
    return cashierPrinterAdapter.printCustomerReceipt(dummyOrder, profile, {
      isReprint: true,
      targetOverride: 'test',
    });
  }

  public async printTestKitchenTicket(profile: RestaurantProfile): Promise<PrinterExecutionResult> {
    const dummyOrder = createSampleTestOrder();
    return kitchenPrinterAdapter.printKitchenOrderTicket(dummyOrder, profile, {
      isReprint: true,
      targetOverride: 'test',
    });
  }

  public async printTestArabicText(profile: RestaurantProfile): Promise<PrinterExecutionResult> {
    const rs = profile.receiptSettings;
    const targetPrinter = rs?.cashierPrinterUsbName || profile.receiptPrinterName || 'Rongta RP350 (Cashier - USB)';
    const paperWidth = (rs?.paperWidth || profile.thermalPaperWidth) === '58mm' ? '58mm' : '80mm';

    const lines: RasterLineSpec[] = [
      { text: 'اختبار الخط العربي والتشكيل', align: 'center', bold: true, fontSize: 26, inverted: true },
      { text: rs?.restaurantNameArabic || profile.name, align: 'center', bold: true, fontSize: 28 },
      { text: rs?.sloganArabic || profile.slogan || 'مشويات الباشا ... انت الباشا', align: 'center', bold: true, fontSize: 20 },
      { text: '', divider: true },
      { text: 'أبجد هوز حطي كلمن سعفص قرشت', align: 'right', bold: true, fontSize: 20 },
      { text: 'مشويات فحم: كباب • كفتة • ريش ضاني', align: 'right', bold: false, fontSize: 19 },
      { text: 'الأرقام: ١٢٣٤٥٦٧٨٩٠ | 1234567890 ج.م', align: 'right', bold: true, fontSize: 19 },
      { text: `✓ طابعة: ${targetPrinter}`, align: 'center', bold: true, fontSize: 18 },
    ];

    const html = `<div style="font-family: 'Cairo', sans-serif; direction: rtl; text-align: center; padding: 8px; width: ${
      paperWidth === '58mm' ? '54mm' : '76mm'
    }; color: #000;">
      <h3 style="margin:0 0 6px; border-bottom: 2px solid #000; padding-bottom:4px;">اختبار الخط العربي والتشكيل</h3>
      <div style="font-weight:900; font-size:16px;">${rs?.restaurantNameArabic || profile.name}</div>
      <div style="font-weight:700; font-size:12px; margin:4px 0;">${rs?.sloganArabic || profile.slogan || 'مشويات الباشا ... انت الباشا'}</div>
      <div style="font-size:12px; text-align:right; margin-top:6px;">مشويات فحم: كباب • كفتة • ريش ضاني</div>
      <div style="font-size:11px; margin-top:6px;">الأرقام: ١٢٣٤٥٦٧٨٩٠ | 1234567890 ج.م</div>
    </div>`;

    return cashierPrinterAdapter.printCustomLines('TEST-ARABIC', lines, html, profile);
  }

  public async printTestLogo(profile: RestaurantProfile): Promise<PrinterExecutionResult> {
    return cashierPrinterAdapter.printLogoTest(profile);
  }
}

export const printManager = new PrintManager();
export type { PrinterExecutionResult };
