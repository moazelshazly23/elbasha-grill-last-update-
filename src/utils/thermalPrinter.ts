import { Order, RestaurantProfile, Shift } from '../types';
import { windowsBridge } from '../services/windowsBridge';
import {
  generateReceiptQRCode,
  ditherImageToMonochromeDataUrl,
  renderLinesToEscPosGSv0Base64,
  renderFullReceiptToEscPosGSv0Base64,
  generateThermalReceiptHTML,
  RasterLineSpec,
} from '../printing/templates/ReceiptTemplate';
import { generateKitchenTicketHTML } from '../printing/templates/KitchenTicketTemplate';
import {
  printManager,
  DualPrintExecutionResult,
  PrinterExecutionResult,
} from '../printing/core/PrintManager';

export {
  generateReceiptQRCode,
  ditherImageToMonochromeDataUrl,
  renderLinesToEscPosGSv0Base64,
  renderFullReceiptToEscPosGSv0Base64,
  generateThermalReceiptHTML,
  generateKitchenTicketHTML,
};

export type { RasterLineSpec, PrinterExecutionResult, DualPrintExecutionResult };

export interface DualPrintResult {
  cashierOk: boolean;
  kitchenOk: boolean;
  errors: string[];
  detailedErrors?: string[];
  cashierResult?: PrinterExecutionResult;
  kitchenResult?: PrinterExecutionResult;
}

/**
 * Execute Direct Thermal Receipt Printing on USB Cashier Printer (Rongta RP350)
 * Delegates to unified PrintManager and returns structured/boolean compatibility.
 */
export async function printReceipt(
  order: Order,
  profile: RestaurantProfile,
  options?: { skipBrowserDialog?: boolean; isReprint?: boolean; targetOverride?: 'cashier' | 'test' }
): Promise<boolean> {
  const res = await printManager.printCashierReceipt(order, profile, options);
  return res.success;
}

export async function printReceiptDetailed(
  order: Order,
  profile: RestaurantProfile,
  options?: { skipBrowserDialog?: boolean; isReprint?: boolean; targetOverride?: 'cashier' | 'test' }
): Promise<PrinterExecutionResult> {
  return printManager.printCashierReceipt(order, profile, options);
}

/**
 * Print Kitchen Order Ticket (KOT) directly to LAN Kitchen Printer (IP:9100 or Windows Driver)
 */
export async function printKitchenOrderDirect(
  order: Order,
  profile: RestaurantProfile,
  options?: { skipBrowserDialog?: boolean; isReprint?: boolean }
): Promise<boolean> {
  const res = await printManager.printKitchenTicket(order, profile, options);
  return res.success;
}

export async function printKitchenOrderDetailed(
  order: Order,
  profile: RestaurantProfile,
  options?: { skipBrowserDialog?: boolean; isReprint?: boolean }
): Promise<PrinterExecutionResult> {
  return printManager.printKitchenTicket(order, profile, options);
}

export async function dispatchDualThermalPrint(
  order: Order,
  profile: RestaurantProfile,
  targets: { cashier?: boolean; kitchen?: boolean; isReprint?: boolean } = { cashier: true, kitchen: true }
): Promise<DualPrintResult> {
  const res = await printManager.dispatchDualPrint(order, profile, targets);
  return {
    cashierOk: res.cashierOk,
    kitchenOk: res.kitchenOk,
    errors: res.errors,
    detailedErrors: res.detailedErrors,
    cashierResult: res.cashierResult,
    kitchenResult: res.kitchenResult,
  };
}

export async function printTestReceipt(profile: RestaurantProfile): Promise<boolean> {
  const res = await printManager.printTestReceipt(profile);
  return res.success;
}

export async function printTestKitchenTicket(profile: RestaurantProfile): Promise<boolean> {
  const res = await printManager.printTestKitchenTicket(profile);
  return res.success;
}

export async function printTestArabicText(profile: RestaurantProfile): Promise<boolean> {
  const res = await printManager.printTestArabicText(profile);
  return res.success;
}

export async function printTestLogo(profile: RestaurantProfile): Promise<boolean> {
  const res = await printManager.printTestLogo(profile);
  return res.success;
}

export interface ShiftReportData {
  shift: Shift;
  branchName: string;
  totalRevenue: number;
  taxCollected: number;
  orderCount: number;
  netSales: number;
  avgOrderValue: number;
  cashSales: number;
  cardSales: number;
  otherSales: number;
  expenses: number;
  startingCash: number;
  expectedCash: number;
  dineInSales: { count: number; total: number };
  takeawaySales: { count: number; total: number };
  deliverySales: { count: number; total: number };
}

export async function printShiftXReport(
  data: ShiftReportData,
  profile: RestaurantProfile
): Promise<boolean> {
  try {
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

    const printDate = new Date().toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    });
    const printTime = new Date().toLocaleTimeString('ar-EG', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    const shiftStartTime = new Date(data.shift.startTime).toLocaleTimeString('ar-EG', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    const reportHtml = `
      <div style="font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif; direction: rtl; text-align: right; color: #000; background: #fff; width: 76mm; max-width: 76mm; margin: 0 auto; padding: 4px; box-sizing: border-box; font-size: 12px; line-height: 1.4;">
        <div style="text-align: center; border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 8px;">
          <div style="font-size: 16px; font-weight: 900; letter-spacing: 0.5px; margin-bottom: 2px;">${profile.name}</div>
          <div style="font-size: 11px; font-weight: 700; color: #333;">${data.branchName}</div>
          <div style="display: inline-block; background: #000; color: #fff; padding: 3px 10px; font-size: 12px; font-weight: 900; border-radius: 4px; margin-top: 6px;">
            تقرير ملخص المبيعات اليومي (X-Report)
          </div>
        </div>

        <div style="font-size: 10.5px; border-bottom: 1.5px dashed #000; padding-bottom: 6px; margin-bottom: 6px;">
          <div style="display: flex; justify-content: space-between;"><span style="font-weight: 700;">كاشير الوردية:</span><span>${data.shift.userName}</span></div>
          <div style="display: flex; justify-content: space-between;"><span style="font-weight: 700;">بدء الوردية:</span><span>${shiftStartTime}</span></div>
          <div style="display: flex; justify-content: space-between;"><span style="font-weight: 700;">تاريخ ووقت الطباعة:</span><span>${printDate} - ${printTime}</span></div>
          <div style="display: flex; justify-content: space-between;"><span style="font-weight: 700;">حالة الوردية:</span><span>${data.shift.status === 'open' ? 'نشطة ومفتوحة' : 'مغلقة'}</span></div>
        </div>

        <div style="border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 6px; background: #f9f9f9; padding: 6px; border: 1px solid #ccc; border-radius: 4px;">
          <div style="display: flex; justify-content: space-between; font-size: 14px; font-weight: 900; margin-bottom: 4px;"><span>إجمالي الإيرادات:</span><span>${data.totalRevenue.toFixed(2)} ${profile.currency}</span></div>
          <div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: 800; color: #222;"><span>عدد الطلبات المنجزة:</span><span>${data.orderCount} طلب</span></div>
        </div>

        <div style="font-size: 11px; border-bottom: 1.5px dashed #000; padding-bottom: 6px; margin-bottom: 6px;">
          <div style="font-weight: 800; margin-bottom: 4px; font-size: 11.5px;">تفاصيل المبيعات وطرق الدفع:</div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 2px;"><span>متوسط قيمة الطلب:</span><span style="font-weight: 700;">${data.avgOrderValue.toFixed(2)} ${profile.currency}</span></div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 2px;"><span>مبيعات نقدي (Cash):</span><span style="font-weight: 700;">${data.cashSales.toFixed(2)} ${profile.currency}</span></div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 2px;"><span>مبيعات شبكة وبطاقة (Card):</span><span style="font-weight: 700;">${data.cardSales.toFixed(2)} ${profile.currency}</span></div>
          <div style="display: flex; justify-content: space-between;"><span>مبيعات إلكترونية وانستاباي:</span><span style="font-weight: 700;">${data.otherSales.toFixed(2)} ${profile.currency}</span></div>
        </div>

        <div style="font-size: 11px; border-bottom: 1.5px dashed #000; padding-bottom: 6px; margin-bottom: 6px;">
          <div style="font-weight: 800; margin-bottom: 4px; font-size: 11.5px;">مطابقة درج النقدية والخزينة:</div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 2px;"><span>العهدة الافتتاحية:</span><span style="font-weight: 700;">${data.startingCash.toFixed(2)} ${profile.currency}</span></div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 2px;"><span>المقبوضات النقدية:</span><span style="font-weight: 700;">+${data.cashSales.toFixed(2)} ${profile.currency}</span></div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 2px;"><span>المصروفات المنصرفة:</span><span style="font-weight: 700; color: #b00;">-${data.expenses.toFixed(2)} ${profile.currency}</span></div>
          <div style="display: flex; justify-content: space-between; font-weight: 900; font-size: 12px; border-top: 1px dotted #000; padding-top: 3px; margin-top: 3px;"><span>النقد المتوقع في الدرج:</span><span>${data.expectedCash.toFixed(2)} ${profile.currency}</span></div>
        </div>

        <div style="font-size: 10.5px; border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 8px;">
          <div style="font-weight: 800; margin-bottom: 4px;">توزيع قنوات البيع:</div>
          <div style="display: flex; justify-content: space-between;"><span>صالات (Dine-in): ${data.dineInSales.count} طلب</span><span>${data.dineInSales.total.toFixed(2)} ${profile.currency}</span></div>
          <div style="display: flex; justify-content: space-between;"><span>سفري (Takeaway): ${data.takeawaySales.count} طلب</span><span>${data.takeawaySales.total.toFixed(2)} ${profile.currency}</span></div>
          <div style="display: flex; justify-content: space-between;"><span>توصيل (Delivery): ${data.deliverySales.count} طلب</span><span>${data.deliverySales.total.toFixed(2)} ${profile.currency}</span></div>
        </div>

        <div style="margin-top: 10px; font-size: 10px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 25px;">
            <div>توقيع الكاشير: ........................</div>
            <div>توقيع المشرف: ........................</div>
          </div>
          <div style="text-align: center; color: #666; font-size: 8.5px;">
            *** تم استخراج هذا التقرير تلقائياً من نظام الباشا لنقاط البيع ***
          </div>
        </div>
      </div>
    `;

    const res = await windowsBridge.printDirect(reportHtml, {
      printerName: profile.receiptPrinterName || 'Rongta RP350 (Cashier - USB)',
      paperWidth: '80mm',
      silent: false,
    });
    return res.success;
  } catch (err) {
    console.error('Failed to print Shift X-Report:', err);
    return false;
  }
}
