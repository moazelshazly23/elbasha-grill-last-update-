import React, { useEffect, useState } from 'react';
import {
  Printer,
  Usb,
  Wifi,
  RefreshCw,
  Save,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Download,
  Trash2,
  FileText,
  Activity,
  ShieldAlert,
  Wrench,
  Clock,
  ChevronDown,
  ChevronUp,
  RotateCcw,
} from 'lucide-react';
import { useBrand } from '../../context/BrandContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { posDb } from '../../services/db';
import { windowsBridge } from '../../services/windowsBridge';
import { printJobManager, PrintJobRecord, PrinterHealthSummary } from '../../services/printJobManager';
import { printerDiagnostics } from '../../printing/diagnostics/PrinterDiagnostics';
import type { WindowsPrinterCheckResult } from '../../printing/diagnostics/WindowsPrinterDiagnostics';
import type { NetworkDiagnosticResult } from '../../printing/diagnostics/NetworkDiagnostics';
import { printManager, PrinterExecutionResult } from '../../printing/core/PrintManager';
import { printLogger } from '../../printing/core/PrintLogger';
import type { KitchenLanguageProtocol } from '../../printing/drivers/EscPosDriver';
import { defaultReceiptSettings } from '../../services/seedData';
import { RestaurantProfile } from '../../types';

export const PrinterDiagnosticsView: React.FC = () => {
  const { profile, updateProfile } = useBrand();
  const { currentUser } = useAuth();
  const { showToast } = useToast();

  const [draft, setDraft] = useState<RestaurantProfile>(() => profile);
  const [availablePrinters, setAvailablePrinters] = useState<string[]>(() =>
    windowsBridge.getAvailablePrinters()
  );
  const [detectedOsPrinters, setDetectedOsPrinters] = useState<string[]>(() =>
    windowsBridge.getDetectedOsPrinters()
  );
  const [isRefreshingPrinters, setIsRefreshingPrinters] = useState(false);

  const [usbCheck, setUsbCheck] = useState<WindowsPrinterCheckResult | null>(null);
  const [lanCheck, setLanCheck] = useState<NetworkDiagnosticResult | null>(null);
  const [lastCashierTest, setLastCashierTest] = useState<PrinterExecutionResult | null>(null);
  const [lastKitchenTest, setLastKitchenTest] = useState<PrinterExecutionResult | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const [showUsbTech, setShowUsbTech] = useState(false);
  const [showLanTech, setShowLanTech] = useState(false);
  const [logFilter, setLogFilter] = useState<'all' | 'failed' | 'cashier' | 'kitchen' | 'test'>('all');

  const [jobs, setJobs] = useState<PrintJobRecord[]>(() => printLogger.getLogs(100));
  const [health, setHealth] = useState<Record<'cashier' | 'kitchen', PrinterHealthSummary>>(() =>
    printLogger.getHealth()
  );

  useEffect(() => {
    setDraft(profile);
  }, [profile]);

  useEffect(() => {
    const unsub = printLogger.subscribe(() => {
      setJobs(printLogger.getLogs(100));
      setHealth(printLogger.getHealth());
    });
    return unsub;
  }, []);

  if (currentUser?.role !== 'admin') {
    return (
      <div className="flex-1 flex items-center justify-center p-6 bg-[#F8F5F0]">
        <div className="max-w-md w-full bg-white rounded-3xl p-6 border-2 border-red-200 text-center space-y-3 shadow-sm">
          <ShieldAlert className="w-10 h-10 text-red-600 mx-auto" />
          <h2 className="text-base font-black text-[#231610]">صفحة مخصصة لمدير النظام فقط</h2>
          <p className="text-xs text-[#6F4E37]">
            لا تملك صلاحية الوصول إلى إدارة وتشخيص الطابعات. يرجى مراجعة المدير العام (Admin).
          </p>
        </div>
      </div>
    );
  }

  const rs = draft.receiptSettings || defaultReceiptSettings;
  const cashierPrinterName =
    rs.cashierPrinterUsbName || draft.receiptPrinterName || 'Rongta RP350 (Cashier - USB)';
  const cashierModel = rs.cashierPrinterModel || draft.cashierPrinterModel || 'Rongta RP350';
  const printingMode = rs.printingMode || draft.printingMode || 'escpos_raw';

  const kitchenPrinterName = draft.kitchenPrinterName || 'Rongta RP350 (Kitchen - LAN)';
  const kitchenModel = rs.kitchenPrinterModel || draft.kitchenPrinterModel || 'Rongta RP350';
  const kitchenIp = rs.kitchenPrinterIp || draft.kitchenPrinterIp || '192.168.1.200';
  const kitchenPort = Number(rs.kitchenPrinterPort ?? draft.kitchenPrinterPort ?? 9100) || 9100;
  const kitchenProtocol: KitchenLanguageProtocol =
    rs.kitchenPrinterProtocol ||
    draft.kitchenPrinterProtocol ||
    (printingMode === 'windows_driver' ? 'windows_driver' : 'escpos_raster');
  const kitchenTimeoutMs = Number(rs.kitchenConnectTimeoutMs ?? draft.kitchenConnectTimeoutMs ?? 3500) || 3500;

  const updateDraftFields = (patch: Partial<RestaurantProfile>, rsPatch: Partial<typeof rs> = {}) => {
    setDraft((prev) => ({
      ...prev,
      ...patch,
      receiptSettings: {
        ...(prev.receiptSettings || defaultReceiptSettings),
        ...rsPatch,
      },
    }));
  };

  const handleSaveConfig = () => {
    updateProfile(draft);
    posDb.logAudit({
      userId: currentUser?.id || 'admin',
      userName: currentUser?.name || 'المدير العام',
      action: 'تحديث إعدادات الطابعات',
      category: 'settings',
      details: `حفظ إعدادات الطابعات: الكاشير="${cashierPrinterName}" (${printingMode})، المطبخ="${kitchenIp}:${kitchenPort}" (${kitchenProtocol})`,
    });
    showToast('تم حفظ إعدادات الطابعتين بنجاح وتفعيلها فوراً', 'success');
  };

  const handleRefreshPrinters = async () => {
    setIsRefreshingPrinters(true);
    const list = await windowsBridge.refreshInstalledPrinters();
    setAvailablePrinters(list);
    setDetectedOsPrinters(windowsBridge.getDetectedOsPrinters());
    setIsRefreshingPrinters(false);
    showToast(`تم تحديث قائمة طابعات Windows (${windowsBridge.getDetectedOsPrinters().length} طابعة مكتشفة)`, 'info');
  };

  const runBusy = async (key: string, fn: () => Promise<void>) => {
    setBusyAction(key);
    try {
      await fn();
    } finally {
      setBusyAction(null);
    }
  };

  const filteredJobs = jobs.filter((j) => {
    if (logFilter === 'failed') return j.status === 'failed';
    if (logFilter === 'cashier') return j.target === 'cashier';
    if (logFilter === 'kitchen') return j.target === 'kitchen';
    if (logFilter === 'test') return j.target === 'test';
    return true;
  });

  const handleRetryFailedOrderJob = async (job: PrintJobRecord) => {
    const order = posDb.getOrders().find((o) => o.id === job.invoiceId);
    if (!order) {
      showToast('لم يتم العثور على سجل الطلب الأصلي لإعادة الطباعة', 'warning');
      return;
    }
    const scope = job.target === 'kitchen' ? 'kitchen' : 'cashier';
    const res = await printManager.reprintOrder(order, draft, scope, {
      userId: currentUser?.id,
      userName: currentUser?.name,
    });
    const ok = scope === 'kitchen' ? res.kitchenOk : res.cashierOk;
    if (ok) {
      showToast(`نجحت إعادة محاولة طباعة الطلب ${order.orderNumber}`, 'success');
    } else {
      showToast(res.detailedErrors?.[0] || 'لا تزال الطباعة متعذرة', 'warning');
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-[#F8F5F0] space-y-5" dir="rtl">
      {/* Top Action Header */}
      <div className="bg-white rounded-3xl p-5 border border-[#E8DFD5] shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-[#8B1E1E] text-white flex items-center justify-center shadow-sm shrink-0">
            <Wrench className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-black text-[#231610]">
              إدارة وتشخيص الطابعات الحرارية (Admin Diagnostics)
            </h1>
            <p className="text-xs text-[#6F4E37] mt-0.5">
              فحص مستقل لطابعة الكاشير (USB) وطابعة المطبخ (LAN TCP:9100)، ضبط البروتوكولات، والوصول لسجلات الأخطاء الفعلية بدون إخفاء الاستثناءات.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isRefreshingPrinters}
            onClick={handleRefreshPrinters}
            className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-[#FAF7F2] hover:bg-[#F5EFE6] border border-[#D7C3A5] text-[#231610] text-xs font-extrabold transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 text-[#8B1E1E] ${isRefreshingPrinters ? 'animate-spin' : ''}`} />
            <span>تحديث طابعات Windows</span>
          </button>
          <button
            type="button"
            onClick={handleSaveConfig}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-black transition-colors shadow-xs cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>حفظ الإعدادات</span>
          </button>
        </div>
      </div>

      {/* Dual Independent Printer Cards */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {/* CARD 1: CASHIER USB PRINTER */}
        <div className="bg-white rounded-3xl border border-[#E8DFD5] shadow-xs overflow-hidden flex flex-col">
          <div className="p-4 sm:p-5 bg-[#FFF8EF] border-b border-[#E8DFD5] flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-2xl bg-[#8B1E1E] text-white flex items-center justify-center shrink-0">
                <Usb className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-sm sm:text-base font-black text-[#231610]">
                  1. طابعة الكاشير — إيصالات العملاء (USB)
                </h2>
                <div className="text-[11px] text-[#6F4E37] font-semibold">
                  الموديل: {cashierModel} • الورق: {rs.paperWidth || '80mm'} • Spooler Win32 RAW
                </div>
              </div>
            </div>

            <span
              className={`px-3 py-1 rounded-full text-xs font-black border ${
                health.cashier.status === 'connected'
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : health.cashier.status === 'offline' || health.cashier.status === 'error'
                  ? 'bg-red-50 text-red-800 border-red-200'
                  : 'bg-gray-100 text-gray-700 border-gray-300'
              }`}
            >
              {health.cashier.status === 'connected'
                ? 'جاهزة / قبلها Spooler'
                : health.cashier.status === 'offline'
                ? 'غير متصلة (Offline)'
                : health.cashier.status === 'error'
                ? 'يوجد خطأ طباعة'
                : 'غير مفحوصة بعد'}
            </span>
          </div>

          <div className="p-4 sm:p-5 space-y-4 flex-1">
            {/* Configuration Inputs */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-[#231610] mb-1">موديل الطابعة</label>
                <input
                  type="text"
                  value={cashierModel}
                  onChange={(e) =>
                    updateDraftFields({ cashierPrinterModel: e.target.value }, { cashierPrinterModel: e.target.value })
                  }
                  className="w-full px-3 py-2 text-xs rounded-xl border border-[#D7C3A5] bg-[#FAF7F2] font-bold"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-[11px] font-bold text-[#231610] mb-1">
                  اسم الطابعة الدقيق في Windows
                </label>
                <input
                  type="text"
                  list="diag-windows-printers"
                  value={cashierPrinterName}
                  onChange={(e) =>
                    updateDraftFields({ receiptPrinterName: e.target.value }, { cashierPrinterUsbName: e.target.value })
                  }
                  placeholder="مثال: Rongta RP350 أو POS80"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-[#D7C3A5] bg-white font-bold"
                />
                <datalist id="diag-windows-printers">
                  {availablePrinters.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </div>
            </div>

            {detectedOsPrinters.length > 0 && (
              <div className="text-[11px] bg-[#FAF7F2] p-2.5 rounded-xl border border-[#E8DFD5]">
                <span className="font-bold text-[#6F4E37] ml-1.5">طابعات Windows المكتشفة:</span>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {detectedOsPrinters.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() =>
                        updateDraftFields({ receiptPrinterName: name }, { cashierPrinterUsbName: name })
                      }
                      className={`px-2 py-0.5 rounded-lg text-[11px] font-bold border cursor-pointer transition-colors ${
                        cashierPrinterName.toLowerCase() === name.toLowerCase()
                          ? 'bg-[#8B1E1E] text-white border-[#8B1E1E]'
                          : 'bg-white text-[#231610] border-[#D7C3A5] hover:bg-[#FFF8EF]'
                      }`}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Mode & Cut Options */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-bold text-[#231610] mb-1">بروتوكول الكاشير</label>
                <select
                  value={printingMode}
                  onChange={(e) =>
                    updateDraftFields({ printingMode: e.target.value as any }, { printingMode: e.target.value as any })
                  }
                  className="w-full px-3 py-2 text-xs rounded-xl border border-[#D7C3A5] bg-white font-bold"
                >
                  <option value="escpos_raw">ESC/POS Raw (GS v 0 عربي نقطي)</option>
                  <option value="windows_driver">Windows Driver (HTML 80mm/58mm)</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-[#231610] mb-1">عرض الرول</label>
                <select
                  value={rs.paperWidth || '80mm'}
                  onChange={(e) =>
                    updateDraftFields(
                      { thermalPaperWidth: e.target.value as '80mm' | '58mm' },
                      { paperWidth: e.target.value as '80mm' | '58mm' }
                    )
                  }
                  className="w-full px-3 py-2 text-xs rounded-xl border border-[#D7C3A5] bg-white font-bold"
                >
                  <option value="80mm">80mm (576 dots — Rongta RP350)</option>
                  <option value="58mm">58mm (384 dots)</option>
                </select>
              </div>
            </div>

            {/* Live Windows Spooler Readout */}
            <div className="p-3 rounded-2xl bg-[#FAF7F2] border border-[#E8DFD5] space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-[#6F4E37]">الاسم الفعلي المطابق في Windows:</span>
                <span className="font-mono font-bold text-[#231610]">
                  {usbCheck?.resolvedPrinter || health.cashier.lastPrinterUsed || 'لم يُفحص بعد'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#6F4E37]">خدمة Print Spooler:</span>
                <span className="font-bold">{usbCheck?.spoolerStatus || 'غير مفحوص'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#6F4E37]">المنفذ / التعريف:</span>
                <span className="font-mono text-[11px]">
                  {usbCheck?.portName || '-'} {usbCheck?.driverName ? `(${usbCheck.driverName})` : ''}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#6F4E37]">آخر نجاح إرسال:</span>
                <span className="font-bold tabular-nums">
                  {health.cashier.lastSuccessfulPrintAt
                    ? new Date(health.cashier.lastSuccessfulPrintAt).toLocaleString('ar-EG')
                    : 'لا يوجد بعد'}
                </span>
              </div>
            </div>

            {/* Diagnostics / Last Error Box */}
            {(usbCheck || lastCashierTest || health.cashier.lastError) && (
              <div
                className={`p-3 rounded-2xl border text-xs space-y-1.5 ${
                  (lastCashierTest ? lastCashierTest.success : usbCheck?.reachable)
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                    : 'bg-red-50 border-red-200 text-red-950'
                }`}
              >
                <div className="font-black flex items-center justify-between gap-2">
                  <span>
                    {lastCashierTest
                      ? lastCashierTest.success
                        ? `✓ نجح الإرسال (${lastCashierTest.bytesSent} بايت)`
                        : `✕ خطأ [${lastCashierTest.errorCode || 'ERROR'}]`
                      : usbCheck
                      ? usbCheck.reachable
                        ? '✓ فحص اتصال USB ناجح'
                        : `✕ تعذر الاتصال [${usbCheck.errorCode || 'USB_ERROR'}]`
                      : `✕ آخر خطأ مسجل [${health.cashier.lastErrorCode || 'ERROR'}]`}
                  </span>
                </div>
                <div className="font-bold">
                  {lastCashierTest?.errorMessage || usbCheck?.details || health.cashier.lastError}
                </div>
                {lastCashierTest?.suggestedFix && (
                  <div className="text-[11px] opacity-90">الحل المقترح: {lastCashierTest.suggestedFix}</div>
                )}
                {(lastCashierTest?.technicalDetails || usbCheck?.technicalDetails) && (
                  <div>
                    <button
                      type="button"
                      onClick={() => setShowUsbTech((s) => !s)}
                      className="text-[11px] font-bold underline flex items-center gap-1 cursor-pointer"
                    >
                      {showUsbTech ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      <span>التفاصيل التقنية للمسؤول</span>
                    </button>
                    {showUsbTech && (
                      <pre className="mt-1.5 p-2 rounded-lg bg-black/5 text-[10px] font-mono whitespace-pre-wrap break-all" dir="ltr">
                        {lastCashierTest?.technicalDetails || usbCheck?.technicalDetails}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 5 Cashier Actions */}
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() =>
                  runBusy('usb-check', async () => {
                    const res = await printerDiagnostics.testCashierUsbConnection(cashierPrinterName);
                    setUsbCheck(res);
                    setLastCashierTest(null);
                    showToast(res.details, res.reachable ? 'success' : 'warning');
                  })
                }
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-[#D7C3A5] hover:bg-[#FAF7F2] text-xs font-extrabold text-[#231610] cursor-pointer disabled:opacity-50"
              >
                <Activity className="w-3.5 h-3.5 text-emerald-700" />
                <span>فحص الاتصال</span>
              </button>

              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() =>
                  runBusy('usb-receipt', async () => {
                    const res = await printManager.printTestReceipt(draft);
                    setLastCashierTest(res);
                    showToast(
                      res.success
                        ? 'تم إرسال فاتورة التجربة إلى طابعة الكاشير'
                        : res.errorMessage || 'فشل إرسال فاتورة التجربة',
                      res.success ? 'success' : 'warning'
                    );
                  })
                }
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#8B1E1E] hover:bg-[#721616] text-white text-xs font-extrabold cursor-pointer disabled:opacity-50"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>طباعة فاتورة تجريبية</span>
              </button>

              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() =>
                  runBusy('usb-arabic', async () => {
                    const res = await printManager.printTestArabicText(draft);
                    setLastCashierTest(res);
                    showToast(
                      res.success ? 'تم إرسال اختبار اللغة العربية والتشكيل' : res.errorMessage || 'فشل اختبار العربية',
                      res.success ? 'success' : 'warning'
                    );
                  })
                }
                className="px-3 py-2 rounded-xl bg-[#FFF8EF] border border-[#D7C3A5] hover:bg-[#F5EFE6] text-xs font-extrabold text-[#8B1E1E] cursor-pointer disabled:opacity-50"
              >
                اختبار العربية
              </button>

              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() =>
                  runBusy('usb-logo', async () => {
                    const res = await printManager.printTestLogo(draft);
                    setLastCashierTest(res);
                    showToast(
                      res.success ? 'تم إرسال اختبار الشعار الأحادي' : res.errorMessage || 'فشل اختبار الشعار',
                      res.success ? 'success' : 'warning'
                    );
                  })
                }
                className="px-3 py-2 rounded-xl bg-[#FFF8EF] border border-[#D7C3A5] hover:bg-[#F5EFE6] text-xs font-extrabold text-[#6F4E37] cursor-pointer disabled:opacity-50"
              >
                اختبار الشعار
              </button>

              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() =>
                  runBusy('usb-diag-report', async () => {
                    const res = await printerDiagnostics.printCashierDiagnosticReport(draft, usbCheck);
                    setLastCashierTest(res);
                    showToast(
                      res.success ? 'تمت طباعة تقرير تشخيص الكاشير' : res.errorMessage || 'تعذرت طباعة التقرير',
                      res.success ? 'success' : 'warning'
                    );
                  })
                }
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#231610] hover:bg-[#3a251c] text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>طباعة تقرير التشخيص</span>
              </button>
            </div>
          </div>
        </div>

        {/* CARD 2: KITCHEN LAN PRINTER */}
        <div className="bg-white rounded-3xl border border-[#E8DFD5] shadow-xs overflow-hidden flex flex-col">
          <div className="p-4 sm:p-5 bg-[#FAF7F2] border-b border-[#E8DFD5] flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-2xl bg-amber-800 text-white flex items-center justify-center shrink-0">
                <Wifi className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-sm sm:text-base font-black text-[#231610]">
                  2. طابعة المطبخ — بون التجهيز (LAN / Ethernet)
                </h2>
                <div className="text-[11px] text-[#6F4E37] font-semibold">
                  الموديل: {kitchenModel} • العنوان: {kitchenIp}:{kitchenPort} • البروتوكول: {kitchenProtocol}
                </div>
              </div>
            </div>

            <span
              className={`px-3 py-1 rounded-full text-xs font-black border ${
                health.kitchen.status === 'connected'
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : health.kitchen.status === 'offline' || health.kitchen.status === 'error'
                  ? 'bg-red-50 text-red-800 border-red-200'
                  : 'bg-gray-100 text-gray-700 border-gray-300'
              }`}
            >
              {health.kitchen.status === 'connected'
                ? 'المنفذ/الطابعة متصلة'
                : health.kitchen.status === 'offline'
                ? 'غير قابلة للوصول'
                : health.kitchen.status === 'error'
                ? 'خطأ إرسال / لغة'
                : 'غير مفحوصة بعد'}
            </span>
          </div>

          <div className="p-4 sm:p-5 space-y-4 flex-1">
            <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-950 font-semibold leading-relaxed">
              ملاحظة تشخيصية: فتح منفذ TCP 9100 يثبت فقط أن الطابعة متصلة على الشبكة، ولا يثبت توافق لغة الطباعة. نفّذ زر <b>«إرسال تذكرة اختبار بالبروتوكول»</b> للتحقق الفعلي من خروج النص على الورق.
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
              <div>
                <label className="block text-[11px] font-bold text-[#231610] mb-1">موديل طابعة المطبخ</label>
                <input
                  type="text"
                  value={kitchenModel}
                  onChange={(e) =>
                    updateDraftFields({ kitchenPrinterModel: e.target.value }, { kitchenPrinterModel: e.target.value })
                  }
                  className="w-full px-3 py-2 text-xs rounded-xl border border-[#D7C3A5] bg-[#FAF7F2] font-bold"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-bold text-[#231610] mb-1">عنوان Static IPv4</label>
                <input
                  type="text"
                  value={kitchenIp}
                  onChange={(e) =>
                    updateDraftFields({ kitchenPrinterIp: e.target.value }, { kitchenPrinterIp: e.target.value })
                  }
                  placeholder="192.168.1.200"
                  dir="ltr"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-[#D7C3A5] bg-white font-mono font-bold text-left"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-[#231610] mb-1">TCP Port</label>
                <input
                  type="number"
                  value={kitchenPort}
                  onChange={(e) => {
                    const v = parseInt(e.target.value) || 9100;
                    updateDraftFields({ kitchenPrinterPort: v }, { kitchenPrinterPort: v });
                  }}
                  dir="ltr"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-[#D7C3A5] bg-white font-mono font-bold text-left"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-bold text-[#231610] mb-1">
                  لغة/بروتوكول طابعة المطبخ (Protocol)
                </label>
                <select
                  value={kitchenProtocol}
                  onChange={(e) => {
                    const p = e.target.value as KitchenLanguageProtocol;
                    updateDraftFields({ kitchenPrinterProtocol: p }, { kitchenPrinterProtocol: p });
                  }}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-[#D7C3A5] bg-white font-bold"
                >
                  <option value="escpos_raster">ESC/POS Raster (GS v 0 — رسم عربي عالي الدقة)</option>
                  <option value="escpos_text">ESC/POS Text (أوامر قص + نص مباشر)</option>
                  <option value="plain_line">Plain Line Text (نصوص سطرية صافية بدون GS v 0)</option>
                  <option value="windows_driver">Windows Driver (عبر تعريف ويندوز لاسم الطابعة)</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-[#231610] mb-1">مهلة الاتصال (ms)</label>
                <input
                  type="number"
                  min={1000}
                  max={15000}
                  step={500}
                  value={kitchenTimeoutMs}
                  onChange={(e) => {
                    const v = Math.max(1000, Math.min(15000, parseInt(e.target.value) || 3500));
                    updateDraftFields({ kitchenConnectTimeoutMs: v }, { kitchenConnectTimeoutMs: v });
                  }}
                  dir="ltr"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-[#D7C3A5] bg-white font-mono font-bold text-left"
                />
              </div>
            </div>

            {kitchenProtocol === 'windows_driver' && (
              <div>
                <label className="block text-[11px] font-bold text-[#231610] mb-1">
                  اسم طابعة المطبخ في Windows
                </label>
                <input
                  type="text"
                  list="diag-windows-printers"
                  value={kitchenPrinterName}
                  onChange={(e) => updateDraftFields({ kitchenPrinterName: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-[#D7C3A5] bg-white font-bold"
                />
              </div>
            )}

            {/* Live Network Telemetry Readout */}
            <div className="p-3 rounded-2xl bg-[#FAF7F2] border border-[#E8DFD5] space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-[#6F4E37]">آخر فحص TCP:</span>
                <span className="font-mono font-bold">
                  {lanCheck
                    ? lanCheck.reachable
                      ? `متاح (${lanCheck.latencyMs ?? 0}ms)`
                      : `فشل (${lanCheck.errorCode || 'UNREACHABLE'})`
                    : 'لم يُفحص بعد'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#6F4E37]">الوجهة:</span>
                <span className="font-mono font-bold" dir="ltr">
                  {kitchenProtocol === 'windows_driver' ? kitchenPrinterName : `${kitchenIp}:${kitchenPort}`}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#6F4E37]">آخر نجاح إرسال:</span>
                <span className="font-bold tabular-nums">
                  {health.kitchen.lastSuccessfulPrintAt
                    ? new Date(health.kitchen.lastSuccessfulPrintAt).toLocaleString('ar-EG')
                    : 'لا يوجد بعد'}
                </span>
              </div>
            </div>

            {/* Kitchen Error / Diagnostic Box */}
            {(lanCheck || lastKitchenTest || health.kitchen.lastError) && (
              <div
                className={`p-3 rounded-2xl border text-xs space-y-1.5 ${
                  (lastKitchenTest ? lastKitchenTest.success : lanCheck?.reachable)
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                    : 'bg-red-50 border-red-200 text-red-950'
                }`}
              >
                <div className="font-black">
                  {lastKitchenTest
                    ? lastKitchenTest.success
                      ? `✓ نجح إرسال التذكرة (${lastKitchenTest.bytesSent} بايت | ${lastKitchenTest.protocol})`
                      : `✕ فشل الإرسال [${lastKitchenTest.errorCode || 'LAN_ERROR'}]`
                    : lanCheck
                    ? lanCheck.reachable
                      ? `✓ منفذ ${lanCheck.ip}:${lanCheck.port} مفتوح (${lanCheck.latencyMs ?? 0}ms)`
                      : `✕ فشل فحص الشبكة [${lanCheck.errorCode || 'LAN_ERROR'}]`
                    : `✕ آخر خطأ مسجل [${health.kitchen.lastErrorCode || 'LAN_ERROR'}]`}
                </div>
                <div className="font-bold">
                  {lastKitchenTest?.errorMessage || lanCheck?.details || health.kitchen.lastError}
                </div>
                {lastKitchenTest?.suggestedFix && (
                  <div className="text-[11px] opacity-90">الحل المقترح: {lastKitchenTest.suggestedFix}</div>
                )}
                {(lastKitchenTest?.technicalDetails || lanCheck?.technicalDetails) && (
                  <div>
                    <button
                      type="button"
                      onClick={() => setShowLanTech((s) => !s)}
                      className="text-[11px] font-bold underline flex items-center gap-1 cursor-pointer"
                    >
                      {showLanTech ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      <span>التفاصيل التقنية للمسؤول</span>
                    </button>
                    {showLanTech && (
                      <pre className="mt-1.5 p-2 rounded-lg bg-black/5 text-[10px] font-mono whitespace-pre-wrap break-all" dir="ltr">
                        {lastKitchenTest?.technicalDetails || lanCheck?.technicalDetails}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 5 Kitchen Actions */}
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() =>
                  runBusy('lan-net', async () => {
                    const res = await printerDiagnostics.testKitchenNetwork(kitchenIp, kitchenPort, kitchenTimeoutMs);
                    setLanCheck(res);
                    setLastKitchenTest(null);
                    showToast(res.details, res.reachable ? 'success' : 'warning');
                  })
                }
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-[#D7C3A5] hover:bg-[#FAF7F2] text-xs font-extrabold text-[#231610] cursor-pointer disabled:opacity-50"
              >
                <Wifi className="w-3.5 h-3.5 text-emerald-700" />
                <span>فحص اتصال الشبكة</span>
              </button>

              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() =>
                  runBusy('lan-port', async () => {
                    const res = await printerDiagnostics.testKitchenTcpPort(kitchenIp, kitchenPort, kitchenTimeoutMs);
                    setLanCheck(res);
                    setLastKitchenTest(null);
                    showToast(res.details, res.reachable ? 'success' : 'warning');
                  })
                }
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-[#D7C3A5] hover:bg-[#FAF7F2] text-xs font-extrabold text-[#231610] cursor-pointer disabled:opacity-50"
              >
                <Activity className="w-3.5 h-3.5 text-amber-700" />
                <span>فحص منفذ TCP 9100</span>
              </button>

              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() =>
                  runBusy('lan-proto-ticket', async () => {
                    const res = await printerDiagnostics.printKitchenProtocolTicket(draft);
                    setLastKitchenTest(res);
                    showToast(
                      res.success
                        ? `تم إرسال تذكرة اختبار (${res.protocol}) إلى المطبخ`
                        : res.errorMessage || 'تعذر إرسال تذكرة الاختبار',
                      res.success ? 'success' : 'warning'
                    );
                  })
                }
                className="px-3 py-2 rounded-xl bg-amber-800 hover:bg-amber-900 text-white text-xs font-extrabold cursor-pointer disabled:opacity-50"
              >
                إرسال تذكرة اختبار بالبروتوكول
              </button>

              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() =>
                  runBusy('lan-kot-test', async () => {
                    const res = await printManager.printTestKitchenTicket(draft);
                    setLastKitchenTest(res);
                    showToast(
                      res.success ? 'تمت طباعة بون المطبخ التجريبي (KOT)' : res.errorMessage || 'فشل بون المطبخ',
                      res.success ? 'success' : 'warning'
                    );
                  })
                }
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#FFF8EF] border border-[#D7C3A5] hover:bg-[#F5EFE6] text-xs font-extrabold text-amber-900 cursor-pointer disabled:opacity-50"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>طباعة بون مطبخ تجريبي</span>
              </button>

              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() =>
                  runBusy('lan-diag-report', async () => {
                    const res = await printerDiagnostics.printKitchenDiagnosticReport(draft, lanCheck);
                    setLastKitchenTest(res);
                    showToast(
                      res.success ? 'تمت طباعة تقرير تشخيص المطبخ' : res.errorMessage || 'تعذرت طباعة التقرير',
                      res.success ? 'success' : 'warning'
                    );
                  })
                }
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#231610] hover:bg-[#3a251c] text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>طباعة تقرير التشخيص</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Persistent Sanitized Print Jobs & Error Logs Table */}
      <div className="bg-white rounded-3xl border border-[#E8DFD5] shadow-xs p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm sm:text-base font-black text-[#231610] flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#8B1E1E]" />
              <span>سجل مهام الطباعة وأخطاء Spooler / TCP (Print Jobs & Error Logs)</span>
            </h3>
            <p className="text-[11px] text-[#6F4E37]">
              يسجل كل عملية إرسال أو إعادة طباعة مع رمز الخطأ الدقيق، البروتوكول، وحجم البيانات المرسلة.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'all', label: `الكل (${jobs.length})` },
                { id: 'failed', label: `فاشلة (${jobs.filter((j) => j.status === 'failed').length})` },
                { id: 'cashier', label: 'الكاشير USB' },
                { id: 'kitchen', label: 'المطبخ LAN' },
                { id: 'test', label: 'اختبارات' },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setLogFilter(f.id)}
                className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold border cursor-pointer transition-colors ${
                  logFilter === f.id
                    ? 'bg-[#8B1E1E] text-white border-[#8B1E1E]'
                    : 'bg-[#FAF7F2] text-[#6F4E37] border-[#E8DFD5] hover:bg-[#FFF8EF]'
                }`}
              >
                {f.label}
              </button>
            ))}

            <button
              type="button"
              onClick={() => {
                const content = printLogger.exportLogsText();
                const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `print-diagnostics-${new Date().toISOString().slice(0, 10)}.txt`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white border border-[#D7C3A5] text-[11px] font-bold text-[#231610] hover:bg-[#FFF8EF] cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>تصدير TXT</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const content = printLogger.exportLogsJson();
                const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `print-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white border border-[#D7C3A5] text-[11px] font-bold text-[#231610] hover:bg-[#FFF8EF] cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>تصدير JSON</span>
            </button>

            {jobs.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  printLogger.clearLogs();
                  showToast('تم مسح سجل مهام الطباعة', 'info');
                }}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-red-50 text-red-700 border border-red-200 text-[11px] font-bold hover:bg-red-100 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>مسح السجل</span>
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto border border-[#E8DFD5] rounded-2xl">
          <table className="w-full text-right text-xs">
            <thead className="bg-[#FAF7F2] text-[#6F4E37] border-b border-[#E8DFD5]">
              <tr>
                <th className="p-2.5 font-extrabold">الوقت والمهمة</th>
                <th className="p-2.5 font-extrabold">الطلب</th>
                <th className="p-2.5 font-extrabold">الطابعة / المنفذ</th>
                <th className="p-2.5 font-extrabold">الاتصال والبروتوكول</th>
                <th className="p-2.5 font-extrabold">الحالة والخطأ</th>
                <th className="p-2.5 font-extrabold text-center">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0E6D8]">
              {filteredJobs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-gray-500">
                    لا توجد مهام طباعة مطابقة للفلتر الحالي.
                  </td>
                </tr>
              ) : (
                filteredJobs.slice(0, 60).map((job) => (
                  <tr key={job.jobId} className="hover:bg-[#FFF8EF]/70">
                    <td className="p-2.5 whitespace-nowrap">
                      <div className="font-bold text-[#231610] tabular-nums">
                        {new Date(job.createdAt).toLocaleTimeString('ar-EG')}
                      </div>
                      <div className="text-[10px] font-mono text-gray-400">{job.jobId}</div>
                    </td>
                    <td className="p-2.5 whitespace-nowrap">
                      <span className="font-black text-[#8B1E1E]">{job.orderNumber}</span>
                      {job.isReprint && (
                        <span className="mr-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 text-[10px] font-bold">
                          إعادة
                        </span>
                      )}
                      {job.retryCount ? (
                        <div className="text-[10px] text-gray-500">محاولة #{job.retryCount}</div>
                      ) : null}
                    </td>
                    <td className="p-2.5">
                      <div className="font-bold text-[#231610]">{job.printerName}</div>
                      <div className="text-[10px] text-gray-500 font-mono">
                        {job.bytesSent} bytes
                      </div>
                    </td>
                    <td className="p-2.5 whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded-lg bg-[#FAF7F2] border border-[#E8DFD5] text-[10px] font-bold">
                        {(job.connectionType || (job.target === 'kitchen' ? 'lan' : 'usb')).toUpperCase()} • {job.protocolMode}
                      </span>
                    </td>
                    <td className="p-2.5">
                      <div className="flex items-center gap-1.5">
                        {job.status === 'failed' ? (
                          <XCircle className="w-4 h-4 text-red-600 shrink-0" />
                        ) : job.status === 'completed' ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        ) : (
                          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                        )}
                        <span className="font-extrabold">
                          {job.spoolerStage === 'physically_verified'
                            ? 'مؤكد ورقياً ✓'
                            : job.spoolerStage === 'accepted_by_spooler'
                            ? 'قبله المنفذ / Spooler'
                            : job.spoolerStage === 'failed'
                            ? `فشل (${job.errorCode || 'ERROR'})`
                            : 'قيد التنفيذ'}
                        </span>
                      </div>
                      {job.errorDetails && (
                        <div className="text-[11px] text-red-700 font-bold mt-0.5 max-w-md">
                          {job.errorDetails}
                        </div>
                      )}
                    </td>
                    <td className="p-2.5 text-center whitespace-nowrap">
                      <div className="flex items-center justify-center gap-1.5">
                        {job.status === 'completed' && job.spoolerStage !== 'physically_verified' && (
                          <button
                            type="button"
                            onClick={() => printJobManager.markPhysicallyVerified(job.jobId)}
                            className="px-2 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-bold hover:bg-emerald-100 cursor-pointer"
                          >
                            تأكيد خروج الورق ✓
                          </button>
                        )}
                        {job.status === 'failed' && job.target !== 'test' && (
                          <button
                            type="button"
                            onClick={() => handleRetryFailedOrderJob(job)}
                            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[#8B1E1E] text-white text-[10px] font-bold hover:bg-[#721616] cursor-pointer"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>إعادة المحاولة</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
