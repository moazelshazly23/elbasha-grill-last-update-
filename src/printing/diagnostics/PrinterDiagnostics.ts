import { RestaurantProfile } from '../../types';
import { PrinterExecutionResult, cashierPrinterAdapter } from '../adapters/CashierPrinterAdapter';
import { kitchenPrinterAdapter } from '../adapters/KitchenPrinterAdapter';
import { RasterLineSpec, createSampleTestOrder } from '../templates/ReceiptTemplate';
import { windowsPrinterDiagnostics, WindowsPrinterCheckResult } from './WindowsPrinterDiagnostics';
import { networkDiagnostics, NetworkDiagnosticResult } from './NetworkDiagnostics';

export class PrinterDiagnosticsService {
  public async testCashierUsbConnection(printerName: string): Promise<WindowsPrinterCheckResult> {
    return windowsPrinterDiagnostics.runCheck(printerName);
  }

  public async testKitchenNetwork(ip: string, port: number, timeoutMs = 3000): Promise<NetworkDiagnosticResult> {
    return networkDiagnostics.testEndpoint({ ip, port, timeoutMs, checkType: 'network' });
  }

  public async testKitchenTcpPort(ip: string, port: number, timeoutMs = 3000): Promise<NetworkDiagnosticResult> {
    return networkDiagnostics.testEndpoint({ ip, port, timeoutMs, checkType: 'port' });
  }

  public async printCashierDiagnosticReport(
    profile: RestaurantProfile,
    lastUsbCheck?: WindowsPrinterCheckResult | null
  ): Promise<PrinterExecutionResult> {
    const rs = profile.receiptSettings;
    const printerName = rs?.cashierPrinterUsbName || profile.receiptPrinterName || 'Rongta RP350 (Cashier - USB)';
    const mode = rs?.printingMode || profile.printingMode || 'escpos_raw';
    const check = lastUsbCheck || (await this.testCashierUsbConnection(printerName));
    const paperWidth = (rs?.paperWidth || profile.thermalPaperWidth) === '58mm' ? '58mm' : '80mm';

    const lines: RasterLineSpec[] = [
      { text: 'تقرير تشخيص طابعة الكاشير (USB)', align: 'center', bold: true, fontSize: 25, inverted: true },
      { text: rs?.restaurantNameArabic || profile.name, align: 'center', bold: true, fontSize: 22 },
      { text: `الوقت: ${new Date().toLocaleString('ar-EG')}`, align: 'center', fontSize: 16 },
      { text: '', divider: true },
      { text: `الاسم المهيأ: ${printerName}`, align: 'right', bold: true, fontSize: 17 },
      { text: `الاسم الفعلي في Windows: ${check.resolvedPrinter || 'غير متطابق'}`, align: 'right', fontSize: 17 },
      { text: `المنفذ: ${check.portName || 'USB'} | التعريف: ${check.driverName || 'Rongta'}`, align: 'right', fontSize: 16 },
      { text: `حالة Spooler: ${check.spoolerStatus || 'Unknown'}`, align: 'right', fontSize: 17 },
      { text: `حالة الطابعة: ${check.printerStatus || (check.reachable ? 'Normal' : 'Unreachable')}`, align: 'right', fontSize: 17 },
      { text: `البروتوكول: ${mode} | عرض الورق: ${paperWidth}`, align: 'right', fontSize: 17 },
      { text: '', divider: true },
      { text: '✓ في حال خروج هذه الورقة، فإن اتصال USB يعمل بنجاح', align: 'center', bold: true, fontSize: 17 },
    ];

    const fallbackHtml = `<div style="font-family: 'Cairo', sans-serif; direction: rtl; padding: 10px; width: ${
      paperWidth === '58mm' ? '54mm' : '76mm'
    }; color: #000;">
      <h3 style="text-align:center; border-bottom:2px solid #000; padding-bottom:4px;">تقرير تشخيص طابعة الكاشير</h3>
      <div><b>الاسم المهيأ:</b> ${printerName}</div>
      <div><b>الاسم الفعلي:</b> ${check.resolvedPrinter || '-'}</div>
      <div><b>المنفذ:</b> ${check.portName || '-'}</div>
      <div><b>حالة Spooler:</b> ${check.spoolerStatus || '-'}</div>
      <div><b>البروتوكول:</b> ${mode}</div>
      <div style="margin-top:8px; text-align:center; font-weight:bold;">✓ نجاح اختبار الطباعة</div>
    </div>`;

    return cashierPrinterAdapter.printCustomLines('DIAG-CASHIER-USB', lines, fallbackHtml, profile);
  }

  public async printKitchenProtocolTicket(profile: RestaurantProfile): Promise<PrinterExecutionResult> {
    const sample = createSampleTestOrder();
    sample.orderNumber = 'KOT-TEST';
    sample.notes = `اختبار بروتوكول المطبخ (${kitchenPrinterAdapter.resolveProtocol(profile)})`;
    return kitchenPrinterAdapter.printKitchenOrderTicket(sample, profile, {
      isReprint: true,
      targetOverride: 'test',
    });
  }

  public async printKitchenDiagnosticReport(
    profile: RestaurantProfile,
    lastLanCheck?: NetworkDiagnosticResult | null
  ): Promise<PrinterExecutionResult> {
    const rs = profile.receiptSettings;
    const ip = rs?.kitchenPrinterIp || profile.kitchenPrinterIp || '192.168.1.200';
    const port = Number(rs?.kitchenPrinterPort ?? profile.kitchenPrinterPort ?? 9100) || 9100;
    const protocol = kitchenPrinterAdapter.resolveProtocol(profile);
    const check = lastLanCheck || (await this.testKitchenTcpPort(ip, port));

    const diagOrder = createSampleTestOrder();
    diagOrder.orderNumber = 'DIAG-KITCHEN-LAN';
    diagOrder.items = [
      {
        id: 'diag-1',
        productId: 'diag-p1',
        productNameAr: `اختبار شبكة LAN: ${ip}:${port}`,
        unitPrice: 0,
        costPrice: 0,
        quantity: 1,
        selectedModifiers: [],
        itemTotal: 0,
        notes: `Protocol=${protocol} | PortOpen=${check.reachable ? 'YES' : 'NO'} | Latency=${check.latencyMs ?? 0}ms`,
        kitchenStation: 'kitchen',
        status: 'ready',
      },
    ];
    diagOrder.notes = 'تقرير فحص تشخيص طابعة المطبخ';

    return kitchenPrinterAdapter.printKitchenOrderTicket(diagOrder, profile, {
      isReprint: true,
      targetOverride: 'test',
    });
  }
}

export const printerDiagnostics = new PrinterDiagnosticsService();
