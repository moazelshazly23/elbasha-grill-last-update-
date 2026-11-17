import React, { useState, useEffect, useMemo } from 'react';
import {
  TrendingUp,
  DollarSign,
  ShoppingBag,
  FileSpreadsheet,
  Award,
  CreditCard,
  Banknote,
  Smartphone,
  PieChart,
  Calendar,
  Printer,
  FileText,
  Download,
  Eye,
  CheckCircle2,
  Filter,
  Receipt,
  Loader2,
  FileCheck,
  Sparkles,
  Mail,
  Clock,
  Flame,
} from 'lucide-react';
import { Order, Product, Expense, SpecialOffer, OfferSaleRecord } from '../../types';
import { posDb } from '../../services/db';
import { useBrand } from '../../context/BrandContext';
import { FinancialReportModal, ReportDocType } from './FinancialReportModal';
import { EmailReportSchedulerModal } from './EmailReportSchedulerModal';
import { InteractiveSalesTrendsChart } from './InteractiveSalesTrendsChart';
import { reportSchedulerService } from '../../services/reportSchedulerService';
import { computeOffersAnalytics } from '../../services/specialOffersService';
import {
  downloadFinancialReportPDF,
  downloadSalesReportPDF,
  triggerFinancialReportPrint,
  triggerSalesReportPrint,
  FinancialReportData,
} from '../../utils/financialReportPDF';

type PeriodFilter = 'all' | 'today' | 'yesterday' | 'last7' | 'thisMonth';

export const ReportsView: React.FC = () => {
  const { profile } = useBrand();
  const [orders, setOrders] = useState<Order[]>(() => posDb.getOrders());
  const [products, setProducts] = useState<Product[]>(() => posDb.getProducts());
  const [expenses, setExpenses] = useState<Expense[]>(() => posDb.getExpenses());
  const [offers, setOffers] = useState<SpecialOffer[]>(() => posDb.getOffers());
  const [offerSales, setOfferSales] = useState<OfferSaleRecord[]>(() => posDb.getOfferSales());

  // Period Filter State
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodFilter>('all');
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [reportModalType, setReportModalType] = useState<ReportDocType>('financial');
  const [isExportingFinancialPDF, setIsExportingFinancialPDF] = useState(false);
  const [isExportingSalesPDF, setIsExportingSalesPDF] = useState(false);
  const [isEmailSchedulerOpen, setIsEmailSchedulerOpen] = useState(false);
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    // Initial check and subscribe
    reportSchedulerService.checkAndRunDueSchedules(profile);
    const scheduleInterval = setInterval(() => {
      reportSchedulerService.checkAndRunDueSchedules(profile);
    }, 60000);

    const unsubscribe = posDb.subscribe(() => {
      setOrders(posDb.getOrders());
      setProducts(posDb.getProducts());
      setExpenses(posDb.getExpenses());
      setOffers(posDb.getOffers());
      setOfferSales(posDb.getOfferSales());
    });
    return () => {
      clearInterval(scheduleInterval);
      unsubscribe();
    };
  }, [profile]);

  // Filter orders by chosen period
  const { filteredOrders, periodLabel } = useMemo(() => {
    const now = new Date();

    const formatDateStr = (d: Date): string => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    const todayStr = formatDateStr(now);

    if (selectedPeriod === 'all') {
      return { filteredOrders: orders, periodLabel: 'كافة الفترات المسجلة' };
    }

    if (selectedPeriod === 'today') {
      const filtered = orders.filter((o) => formatDateStr(new Date(o.createdAt)) === todayStr);
      return { filteredOrders: filtered, periodLabel: `اليوم (${todayStr})` };
    }

    if (selectedPeriod === 'yesterday') {
      const yDate = new Date();
      yDate.setDate(yDate.getDate() - 1);
      const yStr = formatDateStr(yDate);
      const filtered = orders.filter((o) => formatDateStr(new Date(o.createdAt)) === yStr);
      return { filteredOrders: filtered, periodLabel: `أمس (${yStr})` };
    }

    if (selectedPeriod === 'last7') {
      const past = new Date();
      past.setDate(past.getDate() - 6);
      past.setHours(0, 0, 0, 0);
      const filtered = orders.filter((o) => new Date(o.createdAt).getTime() >= past.getTime());
      return { filteredOrders: filtered, periodLabel: 'آخر 7 أيام' };
    }

    if (selectedPeriod === 'thisMonth') {
      const y = now.getFullYear();
      const m = now.getMonth();
      const filtered = orders.filter((o) => {
        const d = new Date(o.createdAt);
        return d.getFullYear() === y && d.getMonth() === m;
      });
      const monthName = now.toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' });
      return { filteredOrders: filtered, periodLabel: `شهر ${monthName}` };
    }

    return { filteredOrders: orders, periodLabel: 'كافة الفترات' };
  }, [orders, selectedPeriod]);

  // Exclude cancelled orders from revenue, COGS, payment totals, and item counts
  const activeOrders = useMemo(
    () => filteredOrders.filter((o) => o.status !== 'cancelled'),
    [filteredOrders]
  );

  const cancelledCount = filteredOrders.length - activeOrders.length;
  const totalRefundedAmount = activeOrders.reduce(
    (acc, o) => acc + (o.refundedAmount || 0),
    0
  );

  // Financial aggregates on active orders (subtracting refunded amounts)
  const totalRevenue = activeOrders.reduce(
    (acc, o) => acc + Math.max(0, o.total - (o.refundedAmount || 0)),
    0
  );
  const totalSubtotal = activeOrders.reduce(
    (acc, o) => acc + Math.max(0, o.subtotal - (o.refundedAmount || 0)),
    0
  );
  const averageTicket =
    activeOrders.length > 0 ? (totalRevenue / activeOrders.length).toFixed(2) : '0';

  // Cost & Profit estimate (for non-cancelled, non-fully-refunded orders)
  const totalCostEstimate = activeOrders.reduce((acc, o) => {
    if (o.status === 'refunded' && (o.refundedAmount || 0) >= o.total) return acc;
    const orderCost = o.items.reduce(
      (itemAcc, item) => itemAcc + (item.costPrice || 0) * item.quantity,
      0
    );
    return acc + orderCost;
  }, 0);

  const grossProfitEstimate = totalSubtotal - totalCostEstimate;

  // Breakdown by Type
  const dineInCount = activeOrders.filter((o) => o.type === 'dine_in').length;
  const takeawayCount = activeOrders.filter((o) => o.type === 'takeaway').length;
  const deliveryCount = activeOrders.filter((o) => o.type === 'delivery').length;
  const pickupCount = activeOrders.filter((o) => o.type === 'pickup').length;

  // Breakdown by Payment (net of refunds)
  let cashTotal = 0;
  let cardTotal = 0;
  let instapayTotal = 0;

  activeOrders.forEach((o) => {
    const netRatio =
      o.total > 0 ? Math.max(0, o.total - (o.refundedAmount || 0)) / o.total : 1;
    o.payments.forEach((p) => {
      const effective = p.amount * netRatio;
      if (p.method === 'cash') cashTotal += effective;
      else if (p.method === 'card') cardTotal += effective;
      else if (p.method === 'instapay') instapayTotal += effective;
    });
  });

  // Top Selling Items
  const itemMap: Record<string, { name: string; count: number; revenue: number }> = {};
  activeOrders.forEach((o) => {
    if (o.status === 'refunded' && (o.refundedAmount || 0) >= o.total) return;
    o.items.forEach((item) => {
      if (!itemMap[item.productId]) {
        itemMap[item.productId] = { name: item.productNameAr, count: 0, revenue: 0 };
      }
      itemMap[item.productId].count += item.quantity;
      itemMap[item.productId].revenue += item.itemTotal;
    });
  });

  const topItems = Object.values(itemMap)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  const offersAnalytics = useMemo(
    () => computeOffersAnalytics(filteredOrders, offers, offerSales),
    [filteredOrders, offers, offerSales]
  );

  // 1. Direct Download: Financial Summary Report as PDF Document
  const handleDownloadFinancialPDF = async () => {
    setIsExportingFinancialPDF(true);
    setActionSuccessMsg(null);
    try {
      const reportData: FinancialReportData = {
        profile,
        orders: activeOrders,
        expenses,
        periodLabel,
        generatedBy: 'مدير الفرع / الإدارة المالية',
      };
      await downloadFinancialReportPDF(reportData);
      setActionSuccessMsg('تم تنزيل مستند الملخص المالي كملف PDF بنجاح!');
      setTimeout(() => setActionSuccessMsg(null), 4500);
    } catch (err) {
      console.error('Failed to export financial summary PDF:', err);
    } finally {
      setIsExportingFinancialPDF(false);
    }
  };

  // 2. Direct Download: Detailed Sales Data Report as PDF Document
  const handleDownloadSalesPDF = async () => {
    setIsExportingSalesPDF(true);
    setActionSuccessMsg(null);
    try {
      const reportData: FinancialReportData = {
        profile,
        orders: activeOrders,
        expenses,
        periodLabel,
        generatedBy: 'مسؤول نقطة البيع / الكاشير',
      };
      await downloadSalesReportPDF(reportData);
      setActionSuccessMsg('تم تنزيل تقرير حركة وبيانات المبيعات كملف PDF بنجاح!');
      setTimeout(() => setActionSuccessMsg(null), 4500);
    } catch (err) {
      console.error('Failed to export sales data PDF:', err);
    } finally {
      setIsExportingSalesPDF(false);
    }
  };

  // 3. Open Preview Modal for specific document
  const handleOpenPreviewModal = (docType: ReportDocType) => {
    setReportModalType(docType);
    setIsReportModalOpen(true);
  };

  // 4. CSV Export
  const exportSalesCSV = () => {
    const headers = [
      'رقم الطلب',
      'النوع',
      'الحالة',
      'الكاشير',
      'المجموع الفرعي',
      'الخصم',
      'المسترد',
      'صافي الإجمالي',
      'التاريخ',
    ];
    const rows = activeOrders.map((o) => [
      o.orderNumber,
      o.type,
      o.status,
      o.cashierName,
      o.subtotal,
      o.discountAmount,
      o.refundedAmount || 0,
      Math.max(0, o.total - (o.refundedAmount || 0)),
      o.createdAt,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,\uFEFF' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute(
      'download',
      `sales_report_${selectedPeriod}_${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-4rem)] overflow-hidden bg-[#F8F5F0]">
      {/* Top Header */}
      <div className="p-4 bg-white border-b border-[#E8DFD5] space-y-3 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-[#FFF8EF] border border-[#D7C3A5] text-[#8B1E1E] flex items-center justify-center shadow-2xs">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-extrabold text-[#231610]">
                  مركز التقارير والتحليلات وتصدير مستندات PDF
                </h2>
                <span className="px-2 py-0.5 rounded-full bg-[#FFF8EF] border border-[#D7C3A5] text-[#8B1E1E] text-[10px] font-extrabold">
                  {periodLabel}
                </span>
              </div>
              <span className="text-xs text-[#7A6455]">
                توليد وتنزيل تقارير PDF المعتمدة للملخصات المالية، حركات المبيعات، ومطابقة الصندوق
              </span>
            </div>
          </div>

          {/* Action Export Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Direct Financial Summary PDF Download Button */}
            <button
              onClick={handleDownloadFinancialPDF}
              disabled={isExportingFinancialPDF}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#8B1E1E] text-white text-xs font-black hover:bg-[#721616] transition-all shadow-xs disabled:opacity-50 cursor-pointer"
              title="تنزيل الملخص المالي التنفيذي بصيغة PDF فوراً"
            >
              {isExportingFinancialPDF ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>جاري إنشاء PDF...</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>تحميل الملخص المالي (PDF)</span>
                </>
              )}
            </button>

            {/* Direct Sales Data PDF Download Button */}
            <button
              onClick={handleDownloadSalesPDF}
              disabled={isExportingSalesPDF}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#8B1E1E] bg-[#FFF8EF] text-[#8B1E1E] text-xs font-black hover:bg-[#FBECE1] transition-all shadow-2xs disabled:opacity-50 cursor-pointer"
              title="تنزيل كشف حركة المبيعات وتفاصيل الفواتير بصيغة PDF"
            >
              {isExportingSalesPDF ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-[#8B1E1E]" />
                  <span>جاري إنشاء PDF...</span>
                </>
              ) : (
                <>
                  <Receipt className="w-4 h-4 text-[#8B1E1E]" />
                  <span>تحميل بيانات المبيعات (PDF)</span>
                </>
              )}
            </button>

            {/* Email Report Scheduler Button */}
            <button
              onClick={() => setIsEmailSchedulerOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-sky-300 bg-sky-50 text-sky-900 text-xs font-bold hover:bg-sky-100 transition-colors shadow-2xs cursor-pointer"
              title="جدولة إرسال التقارير اليومية والأسبوعية للمدير عبر البريد الإلكتروني"
            >
              <Mail className="w-4 h-4 text-sky-700" />
              <span>جدولة البريد للمدير</span>
            </button>

            {/* Preview Modal Button */}
            <button
              onClick={() => handleOpenPreviewModal('financial')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#D7C3A5] bg-[#FAF7F2] text-[#6F4E37] text-xs font-bold hover:bg-[#F0E8DD] transition-colors shadow-2xs cursor-pointer"
              title="معاينة نماذج التقارير الرسمية قبل الطباعة أو الحفظ"
            >
              <Eye className="w-4 h-4 text-[#8B1E1E]" />
              <span>معاينة وطباعة A4</span>
            </button>

            {/* CSV Export Button */}
            <button
              onClick={exportSalesCSV}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#D7C3A5] bg-[#FFF8EF] text-[#6F4E37] text-xs font-bold hover:bg-[#F5EFE6] transition-colors shadow-2xs cursor-pointer"
              title="تصدير جدول البيانات إلى Excel / CSV"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
              <span>CSV</span>
            </button>
          </div>
        </div>

        {/* Period Selector Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#F0E8DD]">
          <div className="flex items-center gap-1 bg-[#F5EFE6] p-1 rounded-xl border border-[#E8DFD5] text-xs">
            <span className="px-2 text-[11px] font-bold text-[#7A6455] flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-[#8B1E1E]" />
              <span>فترة التقرير:</span>
            </span>
            <button
              onClick={() => setSelectedPeriod('all')}
              className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                selectedPeriod === 'all'
                  ? 'bg-[#8B1E1E] text-white shadow-xs'
                  : 'text-[#3E2723] hover:bg-[#EAE0D2]'
              }`}
            >
              الكل
            </button>
            <button
              onClick={() => setSelectedPeriod('today')}
              className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                selectedPeriod === 'today'
                  ? 'bg-[#8B1E1E] text-white shadow-xs'
                  : 'text-[#3E2723] hover:bg-[#EAE0D2]'
              }`}
            >
              اليوم
            </button>
            <button
              onClick={() => setSelectedPeriod('yesterday')}
              className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                selectedPeriod === 'yesterday'
                  ? 'bg-[#8B1E1E] text-white shadow-xs'
                  : 'text-[#3E2723] hover:bg-[#EAE0D2]'
              }`}
            >
              أمس
            </button>
            <button
              onClick={() => setSelectedPeriod('last7')}
              className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                selectedPeriod === 'last7'
                  ? 'bg-[#8B1E1E] text-white shadow-xs'
                  : 'text-[#3E2723] hover:bg-[#EAE0D2]'
              }`}
            >
              آخر 7 أيام
            </button>
            <button
              onClick={() => setSelectedPeriod('thisMonth')}
              className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                selectedPeriod === 'thisMonth'
                  ? 'bg-[#8B1E1E] text-white shadow-xs'
                  : 'text-[#3E2723] hover:bg-[#EAE0D2]'
              }`}
            >
              هذا الشهر
            </button>
          </div>

          <div className="text-xs text-[#7A6455] flex items-center gap-2">
            <span>
              عدد العمليات المحتسبة:{' '}
              <strong className="text-[#8B1E1E] font-black">{filteredOrders.length}</strong> طلب
            </span>
          </div>
        </div>

        {/* Action feedback banner */}
        {actionSuccessMsg && (
          <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-800 flex items-center justify-between animate-in fade-in">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>{actionSuccessMsg}</span>
            </div>
            <button
              onClick={() => setActionSuccessMsg(null)}
              className="text-emerald-900 hover:text-emerald-950 font-black text-xs cursor-pointer"
            >
              إغلاق
            </button>
          </div>
        )}
      </div>

      {/* Analytics Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* PDF Quick Download Showcase Banner */}
        <div className="bg-linear-to-l from-[#FFF8EF] via-white to-[#FBF8F3] border border-[#D7C3A5] p-3.5 sm:p-4 rounded-2xl shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#8B1E1E] text-white flex items-center justify-center shrink-0 shadow-xs">
              <FileCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-sm text-[#231610]">
                  تصدير المستندات الرسمية القابلة للتنزيل (PDF Download)
                </span>
                <span className="text-[10px] bg-emerald-100 text-emerald-900 px-2 py-0.5 rounded-md font-bold">
                  جاهز للتحميل
                </span>
              </div>
              <p className="text-xs text-[#7A6455] mt-0.5">
                يمكنك تحميل تقرير الملخص المالي وقائمة الدخل أو بيان تفاصيل المبيعات بصيغة PDF فورية معتمدة للفرع ({periodLabel})
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <button
              onClick={handleDownloadFinancialPDF}
              disabled={isExportingFinancialPDF}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#8B1E1E] text-white text-xs font-black hover:bg-[#721616] transition-all shadow-xs disabled:opacity-50 cursor-pointer"
            >
              {isExportingFinancialPDF ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              <span>تحميل الملخص المالي (PDF)</span>
            </button>

            <button
              onClick={handleDownloadSalesPDF}
              disabled={isExportingSalesPDF}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#D7C3A5] bg-white text-[#8B1E1E] text-xs font-black hover:bg-[#FFF8EF] transition-all shadow-2xs disabled:opacity-50 cursor-pointer"
            >
              {isExportingSalesPDF ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#8B1E1E]" />
              ) : (
                <Receipt className="w-3.5 h-3.5" />
              )}
              <span>تحميل بيانات المبيعات (PDF)</span>
            </button>

            <button
              onClick={() => setIsEmailSchedulerOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-sky-300 bg-sky-50 text-sky-900 text-xs font-bold hover:bg-sky-100 transition-all shadow-2xs cursor-pointer"
              title="جدولة إرسال التقارير اليومية والأسبوعية للمدير عبر البريد الإلكتروني"
            >
              <Mail className="w-3.5 h-3.5 text-sky-700" />
              <span>جدولة البريد للمدير</span>
            </button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-white p-4 rounded-2xl border border-[#E8DFD5] shadow-xs">
            <span className="text-xs text-[#7A6455] font-semibold">صافي المبيعات المحققة</span>
            <div className="text-2xl font-black text-[#8B1E1E] tabular-nums mt-1">
              {totalRevenue.toLocaleString('ar-EG', { minimumFractionDigits: 2 })} {profile.currency}
            </div>
            <span className="text-[10px] text-gray-500 mt-1 block">صافي الإيراد (بدون ضرائب إضافية)</span>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-[#E8DFD5] shadow-xs">
            <span className="text-xs text-[#7A6455] font-semibold">تقدير هامش الربح الإجمالي</span>
            <div className="text-2xl font-black text-emerald-700 tabular-nums mt-1">
              +{grossProfitEstimate.toLocaleString('ar-EG', { minimumFractionDigits: 2 })}{' '}
              {profile.currency}
            </div>
            <span className="text-[10px] text-emerald-800 mt-1 block font-bold">
              بعد خصم تكلفة المواد الخام
            </span>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-[#E8DFD5] shadow-xs">
            <span className="text-xs text-[#7A6455] font-semibold">عدد الفواتير النشطة</span>
            <div className="text-2xl font-black text-[#231610] tabular-nums mt-1">
              {activeOrders.length} طلب
            </div>
            <span className="text-[10px] text-gray-500 mt-1 block">
              متوسط الفاتورة: {averageTicket} {profile.currency}
            </span>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-[#E8DFD5] shadow-xs">
            <span className="text-xs text-[#7A6455] font-semibold">
              المرتجعات والطلبات الملغية
            </span>
            <div className="text-2xl font-black text-[#B8860B] tabular-nums mt-1">
              {totalRefundedAmount.toFixed(2)} {profile.currency}
            </div>
            <span className="text-[10px] text-gray-500 mt-1 block">
              الطلبات الملغية المستبعدة: {cancelledCount} طلب
            </span>
          </div>
        </div>

        {/* Interactive Recharts Sales Trends & Staff Performance Comparison Chart */}
        <InteractiveSalesTrendsChart orders={orders.filter((o) => o.status !== 'cancelled')} profile={profile} />

        {/* Charts and Breakdown Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Payment Methods Breakdown */}
          <div className="bg-white p-4 rounded-2xl border border-[#E8DFD5] shadow-xs space-y-3">
            <h3 className="font-extrabold text-sm text-[#231610] flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-[#8B1E1E]" />
              <span>تحصيل طرق الدفع (Cash & Digital)</span>
            </h3>

            <div className="space-y-3 pt-2">
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Banknote className="w-5 h-5 text-emerald-700" />
                  <div>
                    <span className="font-bold text-xs text-emerald-950">
                      المدفوعات النقدية (Cash)
                    </span>
                    <span className="text-[10px] text-emerald-800 block">في درج الكاشير</span>
                  </div>
                </div>
                <span className="font-black text-sm text-emerald-900 tabular-nums">
                  {cashTotal.toLocaleString('ar-EG', { minimumFractionDigits: 2 })}{' '}
                  {profile.currency}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CreditCard className="w-5 h-5 text-blue-700" />
                  <div>
                    <span className="font-bold text-xs text-blue-950">
                      بطاقات بنكية (Visa / POS)
                    </span>
                    <span className="text-[10px] text-blue-800 block">حساب البنك</span>
                  </div>
                </div>
                <span className="font-black text-sm text-blue-900 tabular-nums">
                  {cardTotal.toLocaleString('ar-EG', { minimumFractionDigits: 2 })}{' '}
                  {profile.currency}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-purple-50 border border-purple-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Smartphone className="w-5 h-5 text-purple-700" />
                  <div>
                    <span className="font-bold text-xs text-purple-950">
                      إنستاباي ومحافظ إلكترونية (InstaPay)
                    </span>
                    <span className="text-[10px] text-purple-800 block">دفع لحظي</span>
                  </div>
                </div>
                <span className="font-black text-sm text-purple-900 tabular-nums">
                  {instapayTotal.toLocaleString('ar-EG', { minimumFractionDigits: 2 })}{' '}
                  {profile.currency}
                </span>
              </div>
            </div>
          </div>

          {/* Top Selling Dishes */}
          <div className="bg-white p-4 rounded-2xl border border-[#E8DFD5] shadow-xs space-y-3">
            <h3 className="font-extrabold text-sm text-[#231610] flex items-center gap-2">
              <Award className="w-4 h-4 text-[#B8860B]" />
              <span>الأصناف الأكثر مبيعاً وإيراداً</span>
            </h3>

            <div className="space-y-2 pt-2">
              {topItems.map((item, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-2.5 bg-[#FFF8EF] rounded-xl border border-[#D7C3A5]"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#8B1E1E] text-white flex items-center justify-center text-[10px] font-black">
                      {index + 1}
                    </span>
                    <span className="font-bold text-xs text-[#231610]">{item.name}</span>
                  </div>
                  <span className="font-black text-xs text-[#8B1E1E] tabular-nums">
                    {item.count} وجبة •{' '}
                    {item.revenue.toLocaleString('ar-EG', { minimumFractionDigits: 2 })}{' '}
                    {profile.currency}
                  </span>
                </div>
              ))}

              {topItems.length === 0 && (
                <div className="text-center py-8 text-xs text-gray-400">
                  لا توجد مبيعات مسجلة في هذه الفترة لحساب الأكثر طلباً.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Special Offers Sales & Discounts Analytics */}
        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-[#C59A3F]/50 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#F0E8DD] pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-[#140E0B] text-[#FCD34D] flex items-center justify-center border border-[#C59A3F]/50">
                <Flame className="w-4 h-4 text-[#E11D48]" />
              </div>
              <div>
                <h3 className="font-extrabold text-sm text-[#140E0B]">
                  تحليلات وتقارير مبيعات العروض الخاصة (🔥 العروض)
                </h3>
                <span className="text-[11px] text-[#7A6455]">
                  مبيعات العروض، الخصومات الممنوحة للعملاء، ومقارنة حصة العروض مقابل الأصناف الفردية ({periodLabel})
                </span>
              </div>
            </div>
            <span className="px-2.5 py-1 rounded-lg bg-[#FFF8EF] border border-[#D7C3A5] text-xs font-black text-[#8B1E1E] font-num">
              حصة العروض: {offersAnalytics.offerSharePercent}%
            </span>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl bg-[#FBF9F6] border border-[#E5DACB]">
              <span className="text-[11px] font-semibold text-[#7A6455]">عدد العروض المباعة</span>
              <div className="text-xl font-black text-[#140E0B] font-num mt-0.5">
                {offersAnalytics.totalOfferUnitsSold} <span className="text-xs font-bold">عرض</span>
              </div>
            </div>
            <div className="p-3 rounded-xl bg-[#FFF8EF] border border-[#C59A3F]/50">
              <span className="text-[11px] font-semibold text-[#8B1E1E]">إيرادات العروض</span>
              <div className="text-xl font-black text-[#8B1E1E] font-num mt-0.5">
                {offersAnalytics.totalOfferRevenue.toLocaleString('ar-EG', { minimumFractionDigits: 2 })}{' '}
                <span className="text-xs font-bold">{profile.currency}</span>
              </div>
            </div>
            <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200">
              <span className="text-[11px] font-semibold text-emerald-800">إجمالي توفير العملاء</span>
              <div className="text-xl font-black text-emerald-700 font-num mt-0.5">
                {offersAnalytics.totalSavingsGranted.toLocaleString('ar-EG', { minimumFractionDigits: 2 })}{' '}
                <span className="text-xs font-bold">{profile.currency}</span>
              </div>
            </div>
            <div className="p-3 rounded-xl bg-[#FBF9F6] border border-[#E5DACB]">
              <span className="text-[11px] font-semibold text-[#7A6455]">إيرادات الأصناف العادية</span>
              <div className="text-xl font-black text-[#231610] font-num mt-0.5">
                {offersAnalytics.totalRegularRevenue.toLocaleString('ar-EG', { minimumFractionDigits: 2 })}{' '}
                <span className="text-xs font-bold">{profile.currency}</span>
              </div>
            </div>
          </div>

          {/* Offers vs Regular Comparison Bar */}
          <div className="p-3 rounded-xl bg-[#FBF9F6] border border-[#E5DACB] space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-[#3E2723]">
              <span>مقارنة مبيعات العروض مقابل الأصناف العادية</span>
              <span className="font-num text-[#8B1E1E]">
                العروض {offersAnalytics.offerSharePercent}% • العادية {(100 - offersAnalytics.offerSharePercent).toFixed(1)}%
              </span>
            </div>
            <div className="w-full h-3 rounded-full bg-[#E5DACB] overflow-hidden flex">
              <div
                className="h-full bg-gradient-to-l from-[#8B1E1E] to-[#C59A3F] transition-all"
                style={{ width: `${Math.min(100, Math.max(0, offersAnalytics.offerSharePercent))}%` }}
              />
            </div>
          </div>

          {/* Per-Offer Sales Table */}
          {offersAnalytics.perOfferRows.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[#E5DACB] text-[#7A6455] text-[11px]">
                    <th className="py-2 px-2 font-bold">اسم العرض</th>
                    <th className="py-2 px-2 font-bold">الحالة</th>
                    <th className="py-2 px-2 font-bold">مرات البيع</th>
                    <th className="py-2 px-2 font-bold">صافي الإيراد</th>
                    <th className="py-2 px-2 font-bold">القيمة الأصلية</th>
                    <th className="py-2 px-2 font-bold">إجمالي الخصم/التوفير</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0E8DD]">
                  {offersAnalytics.perOfferRows.map((row) => (
                    <tr key={row.offerId} className="hover:bg-[#FFF8EF]/60">
                      <td className="py-2 px-2 font-bold text-[#140E0B]">{row.offerName}</td>
                      <td className="py-2 px-2">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            row.status === 'active'
                              ? 'bg-emerald-100 text-emerald-800'
                              : row.status === 'paused'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {row.status === 'active'
                            ? 'نشط'
                            : row.status === 'paused'
                            ? 'متوقف'
                            : 'منتهي'}
                        </span>
                      </td>
                      <td className="py-2 px-2 font-black font-num text-[#231610]">{row.timesSold}</td>
                      <td className="py-2 px-2 font-black font-num text-[#8B1E1E]">
                        {row.revenue.toFixed(2)} {profile.currency}
                      </td>
                      <td className="py-2 px-2 font-semibold font-num text-gray-500">
                        {row.originalValue.toFixed(2)} {profile.currency}
                      </td>
                      <td className="py-2 px-2 font-bold font-num text-emerald-700">
                        {row.totalSavings.toFixed(2)} {profile.currency}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-6 text-xs text-[#7A6455]">
              لا توجد عروض مسجلة أو مبيعات عروض في الفترة المحددة.
            </div>
          )}
        </div>

        {/* Order Types distribution */}
        <div className="bg-white p-4 rounded-2xl border border-[#E8DFD5] shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-extrabold text-sm text-[#231610]">توزيع قنوات الطلبات</h3>
            <button
              onClick={handleDownloadSalesPDF}
              disabled={isExportingSalesPDF}
              className="text-xs text-[#8B1E1E] font-bold hover:underline flex items-center gap-1 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>تصدير حركة الطلبات كـ PDF</span>
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div className="p-3 bg-[#FFF8EF] rounded-xl border border-[#D7C3A5]">
              <span className="text-xs text-[#7A6455]">صالات وداخلي</span>
              <div className="font-black text-lg text-[#8B1E1E] tabular-nums">{dineInCount}</div>
            </div>
            <div className="p-3 bg-[#FFF8EF] rounded-xl border border-[#D7C3A5]">
              <span className="text-xs text-[#7A6455]">سفري وتيك أواي</span>
              <div className="font-black text-lg text-[#8B1E1E] tabular-nums">{takeawayCount}</div>
            </div>
            <div className="p-3 bg-[#FFF8EF] rounded-xl border border-[#D7C3A5]">
              <span className="text-xs text-[#7A6455]">توصيل منازل</span>
              <div className="font-black text-lg text-[#8B1E1E] tabular-nums">{deliveryCount}</div>
            </div>
            <div className="p-3 bg-[#FFF8EF] rounded-xl border border-[#D7C3A5]">
              <span className="text-xs text-[#7A6455]">استلام مسبق</span>
              <div className="font-black text-lg text-[#8B1E1E] tabular-nums">{pickupCount}</div>
            </div>
          </div>
        </div>
      </div>

      {/* PDF Export & Documentation Preview Modal */}
      <FinancialReportModal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        orders={activeOrders}
        expenses={expenses}
        profile={profile}
        periodLabel={periodLabel}
        initialType={reportModalType}
      />

      {/* Email Report Scheduler Modal */}
      <EmailReportSchedulerModal
        isOpen={isEmailSchedulerOpen}
        onClose={() => setIsEmailSchedulerOpen(false)}
        profile={profile}
        orders={activeOrders}
        expenses={expenses}
        periodLabel={periodLabel}
      />
    </div>
  );
};
