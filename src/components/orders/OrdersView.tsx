import React, { useState, useEffect } from 'react';
import {
  Receipt,
  Search,
  Printer,
  Eye,
  CheckCircle2,
  Clock,
  XCircle,
  FileSpreadsheet,
  Calendar,
  User,
  Phone,
  Store,
  DollarSign,
  Percent,
  X,
  CreditCard,
  Banknote,
  UtensilsCrossed,
  Trash2,
  CheckCircle,
  ChefHat,
  AlertTriangle,
  RotateCcw,
  Edit3,
  Plus,
  Minus,
  History,
  Ban,
  RefreshCw,
} from 'lucide-react';
import {
  KitchenStationStatus,
  KitchenTicket,
  Order,
  OrderItem,
  Product,
} from '../../types';
import { posDb } from '../../services/db';
import { useBrand } from '../../context/BrandContext';
import { usePOS } from '../../context/POSContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { ConfirmModal } from '../common/ConfirmModal';
import { OrderFilterBar, DatePreset } from './OrderFilterBar';
import { sharedKitchenPrintQueue } from '../../printing/core/SharedKitchenPrintQueue';
import {
  cancelOrderOrItemWithKitchenWorkflow,
  createAndDispatchOrderTickets,
  getStationStatusLabelAr,
  modifyOrderWithKitchenDiff,
} from '../../services/kitchenStationService';
import { generateStationKitchenTicketHTML } from '../../printing/templates/KitchenTicketTemplate';
import { calculateLineItemTotal } from '../../utils/currency';

export const OrdersView: React.FC = () => {
  const { profile } = useBrand();
  const { viewReceiptForOrder } = usePOS();
  const { hasPermission, currentUser } = useAuth();
  const { showToast } = useToast();

  const [orders, setOrders] = useState<Order[]>(() => posDb.getOrders());
  const [products, setProducts] = useState<Product[]>(() => posDb.getProducts());
  const [searchTerm, setSearchTerm] = useState('');
  const [orderIdFilter, setOrderIdFilter] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [paymentMethodFilter, setPaymentMethodFilter] = useState<'all' | 'cash' | 'card' | 'other'>('all');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<'all' | 'unpaid' | 'paid'>('all');
  const [deletingOrder, setDeletingOrder] = useState<{ id: string; orderNumber: string } | null>(null);
  const [payingCodOrder, setPayingCodOrder] = useState<Order | null>(null);
  const [refundingOrder, setRefundingOrder] = useState<Order | null>(null);
  const [refundAmount, setRefundAmount] = useState<number>(0);
  const [refundReason, setRefundReason] = useState<string>('مرتجع بناءً على طلب العميل');
  const [refundRestock, setRefundRestock] = useState<boolean>(true);

  // Date range filter state
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // Detailed View Modal
  const [selectedOrderDetails, setSelectedOrderDetails] = useState<Order | null>(null);

  // Multi-Station Kitchen Modals State
  const [viewingTicketsOrder, setViewingTicketsOrder] = useState<Order | null>(null);
  const [previewTicketHtml, setPreviewTicketHtml] = useState<KitchenTicket | null>(null);

  const [modifyingOrder, setModifyingOrder] = useState<Order | null>(null);
  const [editItems, setEditItems] = useState<OrderItem[]>([]);
  const [editOrderNotes, setEditOrderNotes] = useState('');
  const [modReason, setModReason] = useState('');
  const [modWarningStations, setModWarningStations] = useState<string[] | null>(null);
  const [approvePreparingEdit, setApprovePreparingEdit] = useState(false);
  const [restockUnusedOnMod, setRestockUnusedOnMod] = useState(false);
  const [modAddProductId, setModAddProductId] = useState('');
  const [isSubmittingMod, setIsSubmittingMod] = useState(false);

  const [cancellingTarget, setCancellingTarget] = useState<{
    order: Order;
    scope: 'item' | 'order';
    item?: OrderItem;
  } | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelRestockIfPreparing, setCancelRestockIfPreparing] = useState(false);
  const [isSubmittingCancel, setIsSubmittingCancel] = useState(false);

  useEffect(() => {
    const syncState = () => {
      const nextOrders = posDb.getOrders();
      setOrders(nextOrders);
      setProducts(posDb.getProducts());
      setSelectedOrderDetails((prev) =>
        prev ? nextOrders.find((o) => o.id === prev.id) || prev : null
      );
    };
    const unsubscribeDb = posDb.subscribe(syncState);
    const unsubscribeQueue = sharedKitchenPrintQueue.subscribe(syncState);
    return () => {
      unsubscribeDb();
      unsubscribeQueue();
    };
  }, []);

  const openModifyModal = (order: Order) => {
    setModifyingOrder(order);
    setEditItems(
      order.items
        .filter((it) => !it.cancelled && it.status !== 'cancelled')
        .map((it) => ({ ...it }))
    );
    setEditOrderNotes(order.notes || '');
    setModReason('');
    setModWarningStations(null);
    setApprovePreparingEdit(false);
    setRestockUnusedOnMod(false);
    const avail = products.filter((p) => p.available);
    setModAddProductId(avail[0]?.id || '');
  };

  const handleSubmitModification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modifyingOrder) return;
    if (!modReason.trim()) {
      showToast('يرجى إدخال سبب التعديل الإلزامي', 'warning');
      return;
    }

    setIsSubmittingMod(true);
    try {
      const res = await modifyOrderWithKitchenDiff({
        orderId: modifyingOrder.id,
        nextItems: editItems,
        orderNotes: editOrderNotes,
        reason: modReason.trim(),
        employeeId: currentUser?.id || 'cashier',
        employeeName: currentUser?.name || 'الكاشير',
        approvePreparingEdit,
        restockUnusedIngredients: restockUnusedOnMod,
        profile,
      });

      if (res.requiresApproval) {
        setModWarningStations(res.warningStations || ['محطة قيد التحضير']);
        showToast(res.message, 'warning');
        return;
      }

      if (!res.success) {
        showToast(res.message, 'warning');
        return;
      }

      if (res.order) {
        setSelectedOrderDetails(res.order);
      }
      setModifyingOrder(null);
      showToast(res.message, 'success');

      if (res.printOutcomePromise) {
        const printOutcome = await res.printOutcomePromise;
        if (!printOutcome.allOk) {
          showToast(
            `تم حفظ تعديل الطلب ولكن تعذرت طباعة ${printOutcome.failedCount} تذكرة محطة على طابعة المطبخ المشتركة`,
            'warning'
          );
        }
      }
    } finally {
      setIsSubmittingMod(false);
    }
  };

  const openCancelModal = (order: Order, scope: 'item' | 'order', item?: OrderItem) => {
    setCancellingTarget({ order, scope, item });
    setCancelReason('');
    setCancelRestockIfPreparing(false);
  };

  const handleConfirmKitchenCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancellingTarget) return;
    if (!cancelReason.trim()) {
      showToast('يرجى إدخال سبب الإلغاء الإلزامي', 'warning');
      return;
    }
    setIsSubmittingCancel(true);
    try {
      const res = await cancelOrderOrItemWithKitchenWorkflow({
        orderId: cancellingTarget.order.id,
        scope: cancellingTarget.scope,
        orderItemId: cancellingTarget.item?.id,
        reason: cancelReason.trim(),
        employeeId: currentUser?.id || 'cashier',
        employeeName: currentUser?.name || 'الكاشير',
        restockIfPreparing: cancelRestockIfPreparing,
        profile,
      });
      if (!res.success) {
        showToast(res.message, 'warning');
        return;
      }
      if (res.order) {
        setSelectedOrderDetails(res.order);
      }
      setCancellingTarget(null);
      showToast(res.message, 'success');
      if (res.printOutcomePromise) {
        const outcome = await res.printOutcomePromise;
        if (!outcome.allOk) {
          showToast(
            'تم تسجيل الإلغاء في النظام ولكن تعذر إرسال تذكرة الإلغاء لطابعة المطبخ المشتركة',
            'warning'
          );
        }
      }
    } finally {
      setIsSubmittingCancel(false);
    }
  };

  const handleConfirmCodPayment = () => {
    if (!payingCodOrder) return;
    const updated = posDb.recordOrderPayment(
      payingCodOrder.id,
      'cash',
      payingCodOrder.total,
      currentUser?.id || 'cashier',
      currentUser?.name || 'الكاشير'
    );
    if (updated) {
      showToast(`تم تحصيل سداد الطلب ${payingCodOrder.orderNumber} بمبلغ ${payingCodOrder.total} ${profile.currency} وإيداعه بالوردية الحالية`, 'success');
    }
    setPayingCodOrder(null);
  };

  const openRefundModal = (order: Order) => {
    setRefundingOrder(order);
    setRefundAmount(order.total);
    setRefundReason('مرتجع بناءً على طلب العميل');
    setRefundRestock(true);
  };

  const handleConfirmRefund = () => {
    if (!refundingOrder) return;
    const res = posDb.refundOrder({
      orderId: refundingOrder.id,
      amount: refundAmount,
      reason: refundReason,
      method: refundingOrder.payments?.[0]?.method || 'cash',
      userId: currentUser?.id || 'admin',
      userName: currentUser?.name || 'المدير العام',
      restockInventory: refundRestock,
    });
    if (res.success && res.order) {
      showToast(res.message, 'success');
      if (selectedOrderDetails?.id === res.order.id) {
        setSelectedOrderDetails(res.order);
      }
      setRefundingOrder(null);
    } else {
      showToast(res.message, 'warning');
    }
  };

  // Helper date formatting YYYY-MM-DD
  const formatDateStr = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  // Handle Preset selection
  const handleSelectDatePreset = (preset: DatePreset) => {
    setDatePreset(preset);
    const now = new Date();

    if (preset === 'all') {
      setStartDate('');
      setEndDate('');
    } else if (preset === 'today') {
      const todayStr = formatDateStr(now);
      setStartDate(todayStr);
      setEndDate(todayStr);
    } else if (preset === 'yesterday') {
      const yDate = new Date();
      yDate.setDate(yDate.getDate() - 1);
      const yStr = formatDateStr(yDate);
      setStartDate(yStr);
      setEndDate(yStr);
    } else if (preset === 'last7') {
      const past = new Date();
      past.setDate(past.getDate() - 6);
      setStartDate(formatDateStr(past));
      setEndDate(formatDateStr(now));
    } else if (preset === 'thisMonth') {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      setStartDate(formatDateStr(first));
      setEndDate(formatDateStr(now));
    }
  };

  const handleCustomDateChange = (start: string, end: string) => {
    setDatePreset('custom');
    setStartDate(start);
    setEndDate(end);
  };

  const handleResetFilters = () => {
    setSearchTerm('');
    setOrderIdFilter('');
    setCustomerFilter('');
    setStatusFilter('all');
    setPaymentMethodFilter('all');
    setPaymentStatusFilter('all');
    setDatePreset('all');
    setStartDate('');
    setEndDate('');
  };

  const handleDeleteOrder = (orderId: string, orderNumber: string) => {
    setDeletingOrder({ id: orderId, orderNumber });
  };

  const handleConfirmDeleteOrder = () => {
    if (!deletingOrder) return;
    const { id, orderNumber } = deletingOrder;
    posDb.deleteOrder(id, currentUser?.id, currentUser?.name);
    if (selectedOrderDetails?.id === id) {
      setSelectedOrderDetails(null);
    }
    setDeletingOrder(null);
    showToast(`تم حذف الطلب رقم "${orderNumber}" نهائياً من قاعدة البيانات`, 'success');
  };

  const handleUpdateOrderStatus = (orderId: string, newStatus: Order['status']) => {
    posDb.updateOrderStatus(orderId, newStatus, currentUser?.id, currentUser?.name);
    if (selectedOrderDetails && selectedOrderDetails.id === orderId) {
      setSelectedOrderDetails((prev) => (prev ? { ...prev, status: newStatus } : null));
    }
    const statusLabels: Record<Order['status'], string> = {
      new: 'جديد',
      confirmed: 'مؤكد',
      preparing: 'قيد التحضير',
      ready: 'جاهز للتسليم',
      completed: 'مكتمل ومسلم',
      cancelled: 'ملغي',
      refunded: 'مسترد / مرتجع',
    };
    showToast(`تم تغيير حالة الطلب إلى: ${statusLabels[newStatus]}`, 'success');
  };

  // Determine if any filter is active
  const isFiltered =
    searchTerm.trim() !== '' ||
    orderIdFilter.trim() !== '' ||
    customerFilter.trim() !== '' ||
    statusFilter !== 'all' ||
    paymentMethodFilter !== 'all' ||
    paymentStatusFilter !== 'all' ||
    startDate !== '' ||
    endDate !== '' ||
    datePreset !== 'all';

  // Filtered orders calculation
  const filteredOrders = orders.filter((o) => {
    // 1. Status Filter
    if (statusFilter !== 'all' && o.status !== statusFilter) return false;

    // 2. Payment Status Filter (unpaid COD vs paid)
    if (paymentStatusFilter !== 'all') {
      const isUnpaid = o.paymentStatus === 'unpaid';
      if (paymentStatusFilter === 'unpaid' && !isUnpaid) return false;
      if (paymentStatusFilter === 'paid' && isUnpaid) return false;
    }

    // 4. Specific Order ID Filter
    if (orderIdFilter.trim() !== '') {
      const q = orderIdFilter.trim().toLowerCase().replace(/^#/, '');
      const matchNum = o.orderNumber?.toLowerCase().includes(q);
      const matchId = o.id?.toLowerCase().includes(q);
      const matchExt = o.externalOrderId?.toLowerCase().includes(q);
      if (!matchNum && !matchId && !matchExt) return false;
    }

    // 5. Specific Customer Name / Phone Filter
    if (customerFilter.trim() !== '') {
      const q = customerFilter.trim().toLowerCase();
      const matchCust = o.customerName?.toLowerCase().includes(q);
      const matchPhone = o.customerPhone?.includes(q);
      if (!matchCust && !matchPhone) return false;
    }

    // 6. General Search Query (Order Number, ID, Customer Name, Phone, Table, Cashier, Item Names)
    if (searchTerm.trim() !== '') {
      const q = searchTerm.toLowerCase();
      const matchNum = o.orderNumber?.toLowerCase().includes(q);
      const matchId = o.id?.toLowerCase().includes(q);
      const matchExt = o.externalOrderId?.toLowerCase().includes(q);
      const matchCust = o.customerName?.toLowerCase().includes(q);
      const matchPhone = o.customerPhone?.includes(q);
      const matchTable = o.tableNumber?.toLowerCase().includes(q);
      const matchCashier = o.cashierName?.toLowerCase().includes(q);
      const matchItem = o.items?.some(
        (i) =>
          i.productNameAr?.toLowerCase().includes(q) ||
          (i.productNameEn && i.productNameEn.toLowerCase().includes(q))
      );

      if (!matchNum && !matchId && !matchExt && !matchCust && !matchPhone && !matchTable && !matchCashier && !matchItem) {
        return false;
      }
    }

    // 7. Payment Method Filter
    if (paymentMethodFilter !== 'all') {
      const hasMatchingPayment = o.payments?.some((p) => {
        if (paymentMethodFilter === 'cash') return p.method === 'cash';
        if (paymentMethodFilter === 'card') return p.method === 'card';
        if (paymentMethodFilter === 'other') return p.method !== 'cash' && p.method !== 'card';
        return true;
      });
      if (!hasMatchingPayment) return false;
    }

    // 8. Date Range Filter (Payment Date / Order Creation Date)
    if (startDate || endDate) {
      const orderDate = new Date(o.createdAt).getTime();

      if (startDate) {
        const startTimestamp = new Date(`${startDate}T00:00:00`).getTime();
        if (orderDate < startTimestamp) return false;
      }

      if (endDate) {
        const endTimestamp = new Date(`${endDate}T23:59:59.999`).getTime();
        if (orderDate > endTimestamp) return false;
      }
    }

    return true;
  });

  // Calculate net filtered revenue (excluding cancelled orders & subtracting refunds)
  const filteredRevenue = filteredOrders.reduce((sum, o) => {
    if (o.status === 'cancelled') return sum;
    return sum + Math.max(0, (o.total || 0) - (o.refundedAmount || 0));
  }, 0);

  const getStatusBadge = (status: Order['status'], order?: Order) => {
    let badge = null;
    switch (status) {
      case 'new':
        badge = (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-blue-800 border border-blue-200">
            جديد
          </span>
        );
        break;
      case 'confirmed':
        badge = (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-purple-50 text-purple-800 border border-purple-200">
            مؤكد
          </span>
        );
        break;
      case 'preparing':
        badge = (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200 animate-pulse">
            قيد التحضير
          </span>
        );
        break;
      case 'ready':
        badge = (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
            جاهز للتسليم
          </span>
        );
        break;
      case 'completed':
        badge = (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-gray-100 text-gray-800 border border-gray-200">
            مكتمل ومسلم
          </span>
        );
        break;
      case 'cancelled':
        badge = (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-red-50 text-red-800 border border-red-200">
            ملغي
          </span>
        );
        break;
      case 'refunded':
        badge = (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-orange-50 text-orange-800 border border-orange-300">
            مسترد / مرتجع
          </span>
        );
        break;
    }

    if (!order) return badge;

    return (
      <div className="flex flex-col gap-1 items-start">
        {badge}
        {order.stationStates && order.stationStates.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {order.stationStates.map((st) => (
              <span
                key={st.stationId}
                className={`inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                  st.status === 'READY'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : st.status === 'PREPARING'
                    ? 'bg-amber-50 text-amber-800 border-amber-200'
                    : st.status === 'CANCELLED'
                    ? 'bg-red-50 text-red-800 border-red-200'
                    : 'bg-gray-50 text-gray-700 border-gray-200'
                }`}
              >
                {st.stationNameAr}: {getStationStatusLabelAr(st.status)}
              </span>
            ))}
          </div>
        )}
        {order.kitchenPrintStatus === 'printed' ? (
          <span
            className="inline-flex items-center gap-1 text-[9.5px] text-emerald-800 font-bold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200"
            title={`تمت طباعة بون المطبخ: ${order.kitchenPrintedAt ? new Date(order.kitchenPrintedAt).toLocaleTimeString('ar-EG') : ''}`}
          >
            <ChefHat className="w-2.5 h-2.5 text-emerald-600" />
            <span>المطبخ: مطبوع</span>
          </span>
        ) : order.kitchenPrintStatus === 'failed' ? (
          <span
            className="inline-flex items-center gap-1 text-[9.5px] text-red-800 font-bold bg-red-50 px-1.5 py-0.5 rounded border border-red-200"
            title={order.kitchenPrintError || 'تعذر إرسال بون المطبخ'}
          >
            <AlertTriangle className="w-2.5 h-2.5 text-red-600" />
            <span>المطبخ: تعذر</span>
          </span>
        ) : status === 'confirmed' ? (
          <span
            className="inline-flex items-center gap-1 text-[9.5px] text-amber-800 font-bold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 animate-pulse"
            title="بانتظار خدمة الطباعة التلقائية"
          >
            <Clock className="w-2.5 h-2.5 text-amber-600" />
            <span>بانتظار الطابعة</span>
          </span>
        ) : null}
      </div>
    );
  };

  const getOrderTypeName = (type: Order['type']) => {
    switch (type) {
      case 'dine_in':
        return 'صالات';
      case 'takeaway':
        return 'سفري';
      case 'delivery':
        return 'توصيل';
      case 'pickup':
        return 'استلام';
    }
  };

  const exportCSV = () => {
    const headers = [
      'رقم الطلب',
      'النوع',
      'الطاولة / العميل',
      'رقم هاتف العميل',
      'الكاشير',
      'الإجمالي',
      'المبلغ المسترد',
      'طرق الدفع',
      'الحالة',
      'تاريخ المعاملة',
    ];
    const rows = filteredOrders.map((o) => [
      o.orderNumber,
      getOrderTypeName(o.type),
      o.tableNumber || o.customerName || 'عام',
      o.customerPhone || '---',
      o.cashierName || '---',
      o.total,
      o.refundedAmount || 0,
      o.payments.map((p) => p.method).join(' + '),
      o.status,
      new Date(o.createdAt).toLocaleString('ar-EG'),
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,\uFEFF' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute(
      'download',
      `orders_report_${startDate || 'all'}_to_${endDate || 'all'}.csv`
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
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-[#231610]">
                سجل الطلبات والفواتير السابقة
              </h2>
              <span className="text-xs text-[#7A6455]">
                البحث المتقدم برقم المعاملة، اسم العميل، وتصفية التواريخ وطرق الدفع
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={exportCSV}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#D7C3A5] bg-[#FFF8EF] text-[#6F4E37] text-xs font-bold hover:bg-[#F5EFE6] transition-colors shadow-2xs"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
              <span>تصدير النتائج (Excel / CSV)</span>
            </button>
          </div>
        </div>

        {/* Payment Status Filter Tabs */}
        <div className="flex flex-wrap items-center justify-end gap-2 pt-1 border-t border-[#F0E6D8] text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-[#7A6455] font-bold text-[11px]">حالة السداد:</span>
            <div className="inline-flex rounded-lg bg-[#F5EFE6] p-0.5 border border-[#E5DACB]">
              <button
                onClick={() => setPaymentStatusFilter('all')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all ${
                  paymentStatusFilter === 'all' ? 'bg-[#8B1E1E] text-white shadow-2xs' : 'text-[#6F4E37] hover:text-[#231610]'
                }`}
              >
                الكل
              </button>
              <button
                onClick={() => setPaymentStatusFilter('unpaid')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold transition-all ${
                  paymentStatusFilter === 'unpaid' ? 'bg-amber-600 text-white shadow-2xs' : 'text-amber-800 hover:text-amber-950'
                }`}
              >
                <span>غير مدفوع (COD)</span>
              </button>
              <button
                onClick={() => setPaymentStatusFilter('paid')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all ${
                  paymentStatusFilter === 'paid' ? 'bg-[#8B1E1E] text-white shadow-2xs' : 'text-[#6F4E37] hover:text-[#231610]'
                }`}
              >
                مدفوع
              </button>
            </div>
          </div>
        </div>

        {/* Enhanced Search and Date-Range Filter Component */}
        <OrderFilterBar
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          orderIdFilter={orderIdFilter}
          onOrderIdFilterChange={setOrderIdFilter}
          customerFilter={customerFilter}
          onCustomerFilterChange={setCustomerFilter}
          startDate={startDate}
          endDate={endDate}
          datePreset={datePreset}
          onSelectDatePreset={handleSelectDatePreset}
          onCustomDateChange={handleCustomDateChange}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          paymentMethodFilter={paymentMethodFilter}
          onPaymentMethodFilterChange={setPaymentMethodFilter}
          onResetFilters={handleResetFilters}
          isFiltered={isFiltered}
          totalOrdersCount={orders.length}
          filteredOrdersCount={filteredOrders.length}
          filteredRevenue={filteredRevenue}
          currency={profile.currency}
        />
      </div>

      {/* Orders Table Container */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="bg-white rounded-2xl border border-[#E8DFD5] shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-[#F5EFE6] text-[#3E2723] font-bold border-b border-[#E8DFD5] sticky top-0 z-10">
                <tr>
                  <th className="p-3">رقم الطلب (Order ID)</th>
                  <th className="p-3">نوع الطلب</th>
                  <th className="p-3">العميل / الطاولة</th>
                  <th className="p-3">الأصناف المطلوبة</th>
                  <th className="p-3">الكاشير</th>
                  <th className="p-3">طريقة الدفع</th>
                  <th className="p-3">الإجمالي</th>
                  <th className="p-3">الحالة</th>
                  <th className="p-3">تاريخ ووقت المعاملة</th>
                  <th className="p-3 text-center">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F5EFE6]">
                {filteredOrders.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="p-12 text-center text-gray-500">
                      <div className="flex flex-col items-center justify-center gap-2.5">
                        <div className="w-12 h-12 rounded-2xl bg-[#FFF8EF] border border-[#D7C3A5] flex items-center justify-center text-[#8B1E1E]">
                          <Search className="w-6 h-6" />
                        </div>
                        <p className="font-bold text-sm text-[#231610]">
                          لا توجد معاملات مطابقة لمعايير البحث والتاريخ المحددة
                        </p>
                        <p className="text-xs text-gray-500 max-w-md">
                          جرب تغيير نطاق التاريخ، أو مسح نص البحث برقم الفاتورة واسم العميل للعثور على المعاملات.
                        </p>
                        {isFiltered && (
                          <button
                            onClick={handleResetFilters}
                            className="mt-2 px-4 py-2 rounded-xl bg-[#8B1E1E] text-white text-xs font-black shadow-xs hover:bg-[#721616] transition-colors"
                          >
                            إلغاء كافة الفلاتر وعرض الكل
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredOrders.map((order) => {
                    const itemCount = order.items.reduce((acc, i) => acc + i.quantity, 0);

                    return (
                      <tr key={order.id} className="hover:bg-[#FFF8EF] transition-colors">
                        {/* 1. Order ID */}
                        <td className="p-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <button
                              onClick={() => setSelectedOrderDetails(order)}
                              className="font-extrabold text-[#8B1E1E] hover:underline flex items-center gap-1 text-xs sm:text-sm"
                            >
                              <span>{order.orderNumber}</span>
                            </button>
                          </div>
                          <div className="text-[10px] text-gray-400 font-mono truncate max-w-[120px]">
                            {order.externalOrderId ? `Ext: ${order.externalOrderId}` : order.id}
                          </div>
                        </td>

                        {/* 2. Type */}
                        <td className="p-3">
                          <span className="font-bold text-[#3E2723] px-2 py-0.5 rounded-lg bg-gray-100 text-[11px]">
                            {getOrderTypeName(order.type)}
                          </span>
                        </td>

                        {/* 3. Customer / Table */}
                        <td className="p-3 font-semibold text-[#231610]">
                          {order.tableNumber ? (
                            <span className="font-extrabold text-[#8B1E1E]">
                              {order.tableNumber}
                            </span>
                          ) : order.customerName ? (
                            <div>
                              <div className="font-bold">{order.customerName}</div>
                              {order.customerPhone && (
                                <span className="text-[10px] text-gray-500 font-mono">
                                  {order.customerPhone}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-gray-400">زبون عام</span>
                          )}
                        </td>

                        {/* 4. Items summary */}
                        <td className="p-3 text-[#5C4033]">
                          <span className="font-extrabold text-[#231610] tabular-nums">
                            {itemCount}
                          </span>{' '}
                          عنصر
                          <div className="text-[10px] text-gray-500 truncate max-w-[150px]">
                            {order.items.map((i) => i.productNameAr).join('، ')}
                          </div>
                        </td>

                        {/* 5. Cashier */}
                        <td className="p-3 text-gray-700 font-medium">
                          {order.cashierName || 'الكاشير'}
                        </td>

                        {/* 6. Payment methods */}
                        <td className="p-3">
                          {order.paymentStatus === 'unpaid' ? (
                            <div className="space-y-0.5">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-black">
                                <Banknote className="w-3 h-3 text-amber-700" />
                                <span>غير مدفوع (COD)</span>
                              </span>
                              <div className="text-[10px] text-gray-500 font-bold">
                                دفع عند الاستلام
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 flex-wrap">
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                                <CheckCircle className="w-2.5 h-2.5 text-emerald-700" />
                                <span>تم السداد</span>
                              </span>
                              {order.payments && order.payments.length > 0 ? (
                                order.payments.map((p, pIdx) => (
                                  <span
                                    key={pIdx}
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-gray-100 text-[10px] font-bold text-gray-700"
                                  >
                                    {p.method === 'cash' ? (
                                      <Banknote className="w-3 h-3 text-emerald-600" />
                                    ) : p.method === 'card' ? (
                                      <CreditCard className="w-3 h-3 text-blue-600" />
                                    ) : null}
                                    <span>{p.method === 'cash' ? 'نقدي' : p.method === 'card' ? 'بطاقة' : 'إلكتروني'}</span>
                                  </span>
                                ))
                              ) : (
                                <span className="text-gray-400 text-[10px]">نقدي</span>
                              )}
                            </div>
                          )}
                        </td>

                        {/* 7. Total */}
                        <td className="p-3">
                          <div className="font-black text-[#8B1E1E] text-xs sm:text-sm tabular-nums">
                            {order.total.toFixed(2)} {profile.currency}
                          </div>
                        </td>

                        {/* 8. Status */}
                        <td className="p-3">{getStatusBadge(order.status, order)}</td>

                        {/* 9. Date & Time */}
                        <td className="p-3 text-gray-600 text-[11px] tabular-nums whitespace-nowrap">
                          <div className="font-bold text-[#231610]">
                            {new Date(order.createdAt).toLocaleDateString('ar-EG', {
                              year: 'numeric',
                              month: 'numeric',
                              day: 'numeric',
                            })}
                          </div>
                          <div className="text-[10px] text-gray-500">
                            {new Date(order.createdAt).toLocaleTimeString('ar-EG', {
                              hour: '2-digit',
                              minute: '2-digit',
                              hour12: true,
                            })}
                          </div>
                        </td>

                        {/* 10. Actions */}
                        <td className="p-3 text-center">
                          <div className="flex items-center justify-center gap-1.5 flex-wrap">
                            {order.paymentStatus === 'unpaid' && (
                              <button
                                onClick={() => setPayingCodOrder(order)}
                                className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors flex items-center gap-1 text-[11px] font-black shadow-2xs"
                                title="تحصيل قيمة الطلب نقداً للمندوب"
                              >
                                <CheckCircle className="w-3.5 h-3.5" />
                                <span>تحصيل</span>
                              </button>
                            )}
                            <button
                              onClick={() => setSelectedOrderDetails(order)}
                              className="p-1.5 rounded-lg bg-[#F5EFE6] text-[#6F4E37] hover:bg-[#8B1E1E] hover:text-white transition-colors"
                              title="عرض تفاصيل الطلب كاملة"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => viewReceiptForOrder(order)}
                              className={`p-1.5 rounded-lg transition-colors relative ${
                                order.printStatus === 'failed'
                                  ? 'bg-red-50 text-red-600 border border-red-300 hover:bg-red-600 hover:text-white'
                                  : 'bg-[#F5EFE6] text-[#8B1E1E] hover:bg-[#8B1E1E] hover:text-white'
                              }`}
                              title={order.printStatus === 'failed' ? 'فشلت الطباعة - اضغط لإعادة المحاولة' : 'طباعة الفاتورة الحرارية (80mm)'}
                            >
                              <Printer className="w-3.5 h-3.5" />
                              {order.printStatus === 'failed' && (
                                <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-600" />
                              )}
                            </button>
                            {(hasPermission('admin') || hasPermission('manager') || currentUser?.role === 'manager') &&
                              order.status !== 'cancelled' &&
                              order.status !== 'refunded' && (
                                <button
                                  onClick={() => openRefundModal(order)}
                                  className="p-1.5 rounded-lg bg-orange-50 text-orange-700 hover:bg-orange-600 hover:text-white transition-colors"
                                  title="استرداد / مرتجع الطلب"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                </button>
                              )}
                            {hasPermission('admin') && (
                              <button
                                onClick={() => handleDeleteOrder(order.id, order.orderNumber)}
                                className="p-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-600 hover:text-white transition-colors"
                                title="حذف الطلب نهائياً"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Transaction Details Modal */}
      {selectedOrderDetails && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-5 sm:p-6 max-w-lg w-full space-y-4 shadow-2xl border border-[#E8DFD5] max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-[#F0E8DD]">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-[#FFF8EF] border border-[#D7C3A5] text-[#8B1E1E] flex items-center justify-center">
                  <Receipt className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-base text-[#231610]">
                    تفاصيل المعاملة: {selectedOrderDetails.orderNumber}
                  </h3>
                  <div className="text-xs text-gray-500">
                    {new Date(selectedOrderDetails.createdAt).toLocaleString('ar-EG')}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setSelectedOrderDetails(null)}
                className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-xl transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Meta Info Grid */}
            <div className="grid grid-cols-2 gap-2 text-xs bg-[#FBF9F6] p-3 rounded-2xl border border-[#E8DFD5]">
              <div>
                <span className="text-gray-500">نوع الطلب: </span>
                <span className="font-extrabold text-[#231610]">
                  {getOrderTypeName(selectedOrderDetails.type)}
                </span>
              </div>
              <div>
                <span className="text-gray-500">الكاشير: </span>
                <span className="font-bold text-[#231610]">
                  {selectedOrderDetails.cashierName || 'غير محدد'}
                </span>
              </div>
              <div>
                <span className="text-gray-500">العميل / الطاولة: </span>
                <span className="font-bold text-[#8B1E1E]">
                  {selectedOrderDetails.tableNumber || selectedOrderDetails.customerName || 'عام'}
                </span>
              </div>
              <div>
                <span className="text-gray-500">الحالة: </span>
                <span>{getStatusBadge(selectedOrderDetails.status)}</span>
              </div>
            </div>

            {/* Items Breakdown */}
            <div className="space-y-2">
              <h4 className="text-xs font-black text-[#231610] flex items-center gap-1.5">
                <UtensilsCrossed className="w-4 h-4 text-[#8B1E1E]" />
                <span>قائمة الوجبات والأصناف المطلوبة</span>
              </h4>
              <div className="border border-[#E8DFD5] rounded-2xl overflow-hidden divide-y divide-[#F5EFE6] text-xs">
                {selectedOrderDetails.items.map((item, idx) => {
                  const st = posDb.resolveStationForProductOrItem(
                    item.stationId || item.kitchenStation,
                    item.productId
                  );
                  const isCancelledItem = Boolean(item.cancelled || item.status === 'cancelled');
                  return (
                    <div
                      key={idx}
                      className={`p-2.5 flex items-center justify-between gap-2 ${
                        isCancelledItem ? 'bg-red-50/70 opacity-75' : ''
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {item.itemType === 'offer' && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#140E0B] text-[#FCD34D] border border-[#C59A3F]/60 font-black">
                              عرض
                            </span>
                          )}
                          <span
                            className={`font-extrabold text-[#231610] ${
                              isCancelledItem ? 'line-through text-red-700' : ''
                            }`}
                          >
                            {item.quantity} × {item.productNameAr}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#FFF8EF] border border-[#D7C3A5] text-[#6F4E37] font-bold">
                            {item.itemType === 'offer' ? 'متعدد المحطات' : st.nameAr}
                          </span>
                          {isCancelledItem && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-800 font-black">
                              ملغي {item.cancelReason ? `(${item.cancelReason})` : ''}
                            </span>
                          )}
                        </div>
                        {item.itemType === 'offer' && item.offerComponents && item.offerComponents.length > 0 && (
                          <div className="text-[10.5px] text-[#5C4033] mt-1 pr-2 border-r-2 border-[#C59A3F]/60 space-y-0.5">
                            {item.offerComponents.map((comp) => (
                              <div key={comp.productId}>
                                • {comp.productNameAr} × {Number((comp.quantity * item.quantity).toFixed(2))}
                              </div>
                            ))}
                          </div>
                        )}
                        {item.selectedModifiers && item.selectedModifiers.length > 0 && (
                          <div className="text-[11px] text-[#7A6455]">
                            {item.selectedModifiers.map((m) => m.nameAr).join('، ')}
                          </div>
                        )}
                        {item.notes && (
                          <div className="text-[10px] text-amber-800 italic">
                            ملاحظة: {item.notes}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="font-black text-[#8B1E1E] tabular-nums">
                          {item.itemTotal.toFixed(2)} {profile.currency}
                        </div>
                        {!isCancelledItem &&
                          selectedOrderDetails.status !== 'cancelled' &&
                          selectedOrderDetails.status !== 'refunded' && (
                            <button
                              type="button"
                              onClick={() => openCancelModal(selectedOrderDetails, 'item', item)}
                              className="px-2 py-1 rounded-lg bg-red-50 hover:bg-red-600 text-red-700 hover:text-white border border-red-200 text-[10px] font-bold transition-colors cursor-pointer"
                              title="إلغاء هذا الصنف وإشعار محطته"
                            >
                              إلغاء صنف
                            </button>
                          )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Financial Summary */}
            <div className="p-3 bg-[#FFF8EF] rounded-2xl border border-[#D7C3A5] space-y-1.5 text-xs">
              <div className="flex justify-between text-gray-600">
                <span>المجموع الفرعي:</span>
                <span className="font-bold tabular-nums">
                  {selectedOrderDetails.subtotal.toFixed(2)} {profile.currency}
                </span>
              </div>
              {selectedOrderDetails.discountAmount > 0 && (
                <div className="flex justify-between text-red-600">
                  <span>الخصم الممنوح:</span>
                  <span className="font-bold tabular-nums">
                    -{selectedOrderDetails.discountAmount.toFixed(2)} {profile.currency}
                  </span>
                </div>
              )}
              <div className="flex justify-between font-black text-sm text-[#8B1E1E] pt-1.5 border-t border-[#D7C3A5]/60">
                <span>الإجمالي النهائي:</span>
                <span className="tabular-nums">
                  {selectedOrderDetails.total.toFixed(2)} {profile.currency}
                </span>
              </div>
            </div>

            {/* Multi-Station Kitchen Progress & Single-Station Reprints */}
            <div className="p-3 bg-[#FAF7F2] rounded-2xl border border-[#D7C3A5] space-y-2.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 font-black text-[#231610]">
                  <ChefHat className="w-4 h-4 text-[#8B1E1E]" />
                  <span>حالة محطات المطبخ وتذاكر الطابعة المشتركة</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setViewingTicketsOrder(selectedOrderDetails)}
                    className="px-2.5 py-1 rounded-lg bg-white border border-[#D7C3A5] text-[#231610] hover:bg-[#FFF8EF] font-bold text-[11px] flex items-center gap-1 cursor-pointer"
                  >
                    <Eye className="w-3 h-3 text-[#8B1E1E]" />
                    <span>عرض التذاكر</span>
                  </button>
                  {selectedOrderDetails.kitchenPrintStatus === 'failed' && (
                    <button
                      type="button"
                      onClick={async () => {
                        const outcome = await sharedKitchenPrintQueue.retryFailedJobs(
                          profile,
                          selectedOrderDetails.id
                        );
                        showToast(
                          outcome.allOk
                            ? 'تمت إعادة طباعة التذاكر المعلقة بنجاح'
                            : 'تعذرت إعادة الطباعة — تحقق من اتصال طابعة المطبخ',
                          outcome.allOk ? 'success' : 'warning'
                        );
                      }}
                      className="px-2.5 py-1 rounded-lg bg-amber-700 hover:bg-amber-800 text-white font-bold text-[11px] flex items-center gap-1 cursor-pointer"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>إعادة محاولة الفاشل</span>
                    </button>
                  )}
                </div>
              </div>

              {selectedOrderDetails.stationStates && selectedOrderDetails.stationStates.length > 0 ? (
                <div className="space-y-2">
                  {selectedOrderDetails.stationStates.map((st) => {
                    const latestTicket = posDb
                      .getKitchenTickets({ orderId: selectedOrderDetails.id, stationId: st.stationId })
                      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

                    return (
                      <div
                        key={st.stationId}
                        className="p-2 bg-white rounded-xl border border-[#E8DFD5] flex flex-wrap items-center justify-between gap-2"
                      >
                        <div>
                          <div className="font-extrabold text-[#231610] flex items-center gap-1.5">
                            <span>{st.stationNameAr}</span>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-black ${
                                st.status === 'READY'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : st.status === 'PREPARING'
                                  ? 'bg-amber-100 text-amber-900'
                                  : st.status === 'CANCELLED'
                                  ? 'bg-red-100 text-red-800'
                                  : 'bg-gray-100 text-gray-800'
                              }`}
                            >
                              {getStationStatusLabelAr(st.status)}
                            </span>
                          </div>
                          <div className="text-[10px] text-gray-500">
                            الطباعة:{' '}
                            {st.printStatus === 'completed'
                              ? 'تمت بنجاح ✓'
                              : st.printStatus === 'failed'
                              ? 'فشلت ⚠'
                              : 'معلقة'}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-1">
                          {selectedOrderDetails.status !== 'cancelled' &&
                            st.status !== 'CANCELLED' && (
                              <>
                                {(['PRINTED', 'PREPARING', 'READY'] as KitchenStationStatus[]).map(
                                  (targetSt) => (
                                    <button
                                      key={targetSt}
                                      type="button"
                                      onClick={() =>
                                        posDb.updateOrderStationStatus(
                                          selectedOrderDetails.id,
                                          st.stationId,
                                          targetSt,
                                          currentUser?.id || 'cashier',
                                          currentUser?.name || 'الكاشير'
                                        )
                                      }
                                      className={`px-2 py-1 rounded-lg text-[10px] font-bold border cursor-pointer ${
                                        st.status === targetSt
                                          ? 'bg-[#8B1E1E] text-white border-[#8B1E1E]'
                                          : 'bg-gray-50 text-gray-700 border-gray-200 hover:border-[#8B1E1E]'
                                      }`}
                                    >
                                      {getStationStatusLabelAr(targetSt)}
                                    </button>
                                  )
                                )}
                              </>
                            )}
                          {latestTicket && (
                            <button
                              type="button"
                              onClick={async () => {
                                const res = await sharedKitchenPrintQueue.reprintTicket(
                                  latestTicket.id,
                                  profile,
                                  { userId: currentUser?.id, userName: currentUser?.name },
                                  `إعادة طباعة محطة ${st.stationNameAr}`
                                );
                                showToast(
                                  res.success
                                    ? `تمت إعادة طباعة تذكرة محطة ${st.stationNameAr}`
                                    : 'تعذر طباعة تذكرة المحطة على الطابعة المشتركة',
                                  res.success ? 'success' : 'warning'
                                );
                              }}
                              className="px-2 py-1 rounded-lg bg-amber-800 hover:bg-amber-900 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                              title={`إعادة طباعة تذكرة ${st.stationNameAr} فقط`}
                            >
                              <Printer className="w-3 h-3" />
                              <span>إعادة طباعة</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-[11px] text-gray-600 flex items-center justify-between gap-2">
                  <span>لم يتم تقسيم هذا الطلب على المحطات بعد.</span>
                  <button
                    type="button"
                    onClick={async () => {
                      const { outcome } = await createAndDispatchOrderTickets(
                        selectedOrderDetails,
                        profile
                      );
                      showToast(
                        outcome.allOk
                          ? 'تم تقسيم الطلب وإرسال تذاكر المحطات للطابعة المشتركة'
                          : 'تم تقسيم الطلب ولكن تعذرت الطباعة',
                        outcome.allOk ? 'success' : 'warning'
                      );
                    }}
                    className="px-2.5 py-1 rounded-lg bg-amber-800 text-white font-bold text-[11px] cursor-pointer"
                  >
                    تقسيم وطباعة المحطات
                  </button>
                </div>
              )}
            </div>

            {/* Order Kitchen Audit History (Mods / Cancellations / Reprints) */}
            {(() => {
              const mods = posDb.getKitchenModifications(selectedOrderDetails.id);
              const cancels = posDb.getOrderCancellations(selectedOrderDetails.id);
              const reprints = posDb.getKitchenReprints(selectedOrderDetails.id);
              if (mods.length === 0 && cancels.length === 0 && reprints.length === 0) return null;
              return (
                <div className="p-3 bg-gray-50 rounded-2xl border border-gray-200 space-y-1.5 text-[11px]">
                  <div className="font-black text-[#231610] flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5 text-[#8B1E1E]" />
                    <span>سجل حركات المطبخ (التعديلات / الإلغاءات / إعادة الطباعة)</span>
                  </div>
                  <div className="space-y-1 max-h-28 overflow-y-auto">
                    {mods.map((m) => (
                      <div key={m.id} className="text-amber-900 bg-amber-50 px-2 py-1 rounded-lg border border-amber-200">
                        <b>تعديل ({m.employeeName}):</b> {m.reason} — {m.diffs.length} تغيير
                      </div>
                    ))}
                    {cancels.map((c) => (
                      <div key={c.id} className="text-red-900 bg-red-50 px-2 py-1 rounded-lg border border-red-200">
                        <b>إلغاء {c.scope === 'item' ? `صنف (${c.productNameAr})` : 'طلب كامل'} ({c.employeeName}):</b>{' '}
                        {c.reason}
                      </div>
                    ))}
                    {reprints.map((r) => (
                      <div key={r.id} className="text-gray-700 bg-white px-2 py-1 rounded-lg border border-gray-200">
                        <b>إعادة طباعة {r.stationNameAr} ({r.employeeName}):</b>{' '}
                        {r.success ? 'ناجحة' : 'فشلت'}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Status quick actions */}
            <div className="p-3 bg-gray-50 rounded-2xl border border-gray-200 space-y-2">
              <div className="text-xs font-bold text-gray-700 flex items-center justify-between">
                <span>تحديث حالة الطلب:</span>
                <span className="text-[11px] text-gray-500">تحويل الحالة إلى &quot;مؤكد&quot; يطبع تذاكر المحطات تلقائياً</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 text-xs">
                {(['confirmed', 'preparing', 'ready', 'completed', 'cancelled'] as Order['status'][]).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() =>
                      st === 'cancelled'
                        ? openCancelModal(selectedOrderDetails, 'order')
                        : handleUpdateOrderStatus(selectedOrderDetails.id, st)
                    }
                    className={`py-1.5 px-2 rounded-xl text-center font-bold text-[11px] transition-all border ${
                      selectedOrderDetails.status === st
                        ? 'bg-[#8B1E1E] text-white border-[#8B1E1E] shadow-2xs'
                        : 'bg-white text-gray-700 border-gray-300 hover:border-[#8B1E1E]'
                    }`}
                  >
                    {st === 'confirmed'
                      ? 'مؤكد (تجهيز)'
                      : st === 'preparing'
                      ? 'قيد التحضير'
                      : st === 'ready'
                      ? 'جاهز'
                      : st === 'completed'
                      ? 'مكتمل'
                      : 'إلغاء الطلب'}
                  </button>
                ))}
              </div>
            </div>

            {/* Kitchen Print Ticket Status & Actions */}
            <div className="p-3 bg-amber-50/70 rounded-2xl border border-amber-200 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <ChefHat className="w-4 h-4 text-amber-800" />
                <div>
                  <div className="font-bold text-amber-950">طابعة المطبخ المشتركة:</div>
                  <div className="text-[11px] text-amber-800">
                    {selectedOrderDetails.kitchenPrintStatus === 'printed'
                      ? `تمت الطباعة بنجاح ${selectedOrderDetails.kitchenPrintedAt ? `(${new Date(selectedOrderDetails.kitchenPrintedAt).toLocaleTimeString('ar-EG')})` : ''}`
                      : selectedOrderDetails.kitchenPrintStatus === 'failed'
                      ? `فشل أمر الطباعة: ${selectedOrderDetails.kitchenPrintError || 'خطأ بالطابعة'}`
                      : selectedOrderDetails.status === 'confirmed'
                      ? 'جاري إرسال تذاكر المحطات للطابعة المشتركة'
                      : 'سيتم إرسال التذاكر فور تأكيد الطلب'}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={async () => {
                    const { printManager } = await import('../../printing/core/PrintManager');
                    const res = await printManager.reprintOrder(selectedOrderDetails, profile, 'kitchen', {
                      userId: currentUser?.id,
                      userName: currentUser?.name,
                    });
                    if (res.kitchenOk) {
                      showToast('تمت إعادة طباعة تذاكر المطبخ بنجاح', 'success');
                      setSelectedOrderDetails((prev) =>
                        prev ? { ...prev, kitchenPrintStatus: 'printed', kitchenPrintedAt: new Date().toISOString(), kitchenPrintError: undefined } : null
                      );
                    } else {
                      const errText = res.detailedErrors?.[0] || 'تعذر إرسال التذاكر إلى طابعة المطبخ';
                      showToast(errText, 'error');
                      setSelectedOrderDetails((prev) =>
                        prev ? { ...prev, kitchenPrintStatus: 'failed', kitchenPrintError: errText } : null
                      );
                    }
                  }}
                  className="px-3 py-1.5 rounded-xl bg-amber-800 hover:bg-amber-900 text-white font-bold text-xs flex items-center gap-1 transition-colors shadow-2xs cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>كل تذاكر المطبخ</span>
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const { printManager } = await import('../../printing/core/PrintManager');
                    const res = await printManager.reprintOrder(selectedOrderDetails, profile, 'both', {
                      userId: currentUser?.id,
                      userName: currentUser?.name,
                    });
                    if (res.cashierOk && res.kitchenOk) {
                      showToast('تمت إعادة طباعة الفاتورة وتذاكر المطبخ معاً بنجاح', 'success');
                      setSelectedOrderDetails((prev) =>
                        prev ? { ...prev, printStatus: 'printed', kitchenPrintStatus: 'printed', kitchenPrintedAt: new Date().toISOString() } : null
                      );
                    } else {
                      showToast(res.detailedErrors?.join(' | ') || `تعذر الطباعة: ${res.errors.join(' و ')}`, 'error');
                    }
                  }}
                  className="px-3 py-1.5 rounded-xl bg-[#231610] hover:bg-[#3a251c] text-white font-bold text-xs flex items-center gap-1 transition-colors shadow-2xs cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>إعادة طباعة الاثنين</span>
                </button>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-2 pt-2">
              {selectedOrderDetails.status !== 'cancelled' &&
                selectedOrderDetails.status !== 'refunded' && (
                  <>
                    <button
                      type="button"
                      onClick={() => openModifyModal(selectedOrderDetails)}
                      className="px-3 py-2.5 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 text-xs font-bold transition-colors flex items-center justify-center gap-1 cursor-pointer"
                      title="تعديل أصناف الطلب وإرسال فروقات المحطات المتأثرة فقط"
                    >
                      <Edit3 className="w-4 h-4" />
                      <span>تعديل الطلب</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => openCancelModal(selectedOrderDetails, 'order')}
                      className="px-3 py-2.5 rounded-xl border border-red-300 bg-red-50 text-red-700 hover:bg-red-100 text-xs font-bold transition-colors flex items-center justify-center gap-1 cursor-pointer"
                      title="إلغاء الطلب مع حفظ السجل وإشعار المحطات"
                    >
                      <Ban className="w-4 h-4" />
                      <span>إلغاء الطلب</span>
                    </button>
                  </>
                )}
              {(hasPermission('admin') || hasPermission('manager') || currentUser?.role === 'manager') &&
                selectedOrderDetails.status !== 'cancelled' &&
                selectedOrderDetails.status !== 'refunded' && (
                  <button
                    type="button"
                    onClick={() => openRefundModal(selectedOrderDetails)}
                    className="px-3 py-2.5 rounded-xl border border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100 text-xs font-bold transition-colors flex items-center justify-center gap-1"
                    title="استرداد ومرتجع"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>مرتجع</span>
                  </button>
                )}
              {hasPermission('admin') && (
                <button
                  type="button"
                  onClick={() =>
                    handleDeleteOrder(selectedOrderDetails.id, selectedOrderDetails.orderNumber)
                  }
                  className="px-3 py-2.5 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 text-xs font-bold transition-colors flex items-center justify-center gap-1"
                  title="حذف هذا الطلب"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>حذف</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setSelectedOrderDetails(null)}
                className="flex-1 py-2.5 rounded-xl border border-[#D7C3A5] text-[#6F4E37] text-xs font-bold hover:bg-gray-50 transition-colors"
              >
                إغلاق
              </button>
              <button
                type="button"
                onClick={() => {
                  viewReceiptForOrder(selectedOrderDetails);
                  setSelectedOrderDetails(null);
                }}
                className="flex-1 py-2.5 rounded-xl bg-[#8B1E1E] text-white text-xs font-black hover:bg-[#721616] transition-colors shadow-xs flex items-center justify-center gap-1.5"
              >
                <Printer className="w-4 h-4" />
                <span>طباعة الفاتورة</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Delete Order Modal */}
      <ConfirmModal
        isOpen={!!deletingOrder}
        title="تأكيد حذف الطلب"
        message="هل أنت متأكد من حذف هذا الطلب نهائياً من قاعدة البيانات؟ تنبيه: هذه العملية ستلغي المعاملة من سجل المبيعات."
        itemName={deletingOrder ? `طلب رقم: ${deletingOrder.orderNumber}` : undefined}
        confirmText="حذف الطلب نهائياً"
        onConfirm={handleConfirmDeleteOrder}
        onClose={() => setDeletingOrder(null)}
      />

      {/* Confirm COD Payment Collection Modal */}
      {payingCodOrder && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-[#D7C3A5] space-y-4 text-right">
            <div className="flex items-center gap-3 border-b border-[#F0E6D8] pb-3">
              <div className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center">
                <CheckCircle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-black text-base text-[#231610]">
                  تحصيل سداد طلب توصيل (COD)
                </h3>
                <span className="text-xs text-gray-500">
                  تسجيل استلام النقدية من مندوب التوصيل
                </span>
              </div>
            </div>

            <div className="bg-[#FFF8EF] p-3.5 rounded-2xl border border-[#E5DACB] space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-500">رقم الطلب:</span>
                <span className="font-black text-[#8B1E1E]">{payingCodOrder.orderNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">العميل:</span>
                <span className="font-bold">{payingCodOrder.customerName || 'عميل توصيل'}</span>
              </div>
              {payingCodOrder.customerPhone && (
                <div className="flex justify-between">
                  <span className="text-gray-500">الهاتف:</span>
                  <span className="font-mono">{payingCodOrder.customerPhone}</span>
                </div>
              )}
              {payingCodOrder.deliveryAddress && (
                <div className="flex justify-between">
                  <span className="text-gray-500">العنوان:</span>
                  <span className="font-bold text-gray-700">{payingCodOrder.deliveryAddress}</span>
                </div>
              )}
              <div className="border-t border-[#D7C3A5] pt-2 flex justify-between items-center text-sm font-black text-[#231610]">
                <span>المبلغ المطلوب تحصيله:</span>
                <span className="text-[#8B1E1E] text-base font-black">
                  {payingCodOrder.total.toFixed(2)} {profile.currency}
                </span>
              </div>
            </div>

            <div className="text-[11px] text-gray-600 bg-gray-50 p-2.5 rounded-xl border border-gray-200">
              ℹ️ سيتم تحويل حالة الطلب إلى <b>مدفوع بالكامل</b> وإيداع مبلغ <b>{payingCodOrder.total.toFixed(2)} {profile.currency}</b> في مبيعات الوردية النشطة وصندوق النقدية.
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPayingCodOrder(null)}
                className="flex-1 py-2.5 rounded-xl border border-gray-300 text-gray-700 font-bold text-xs hover:bg-gray-100 transition-colors"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleConfirmCodPayment}
                className="flex-1 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-black text-xs transition-colors shadow-xs flex items-center justify-center gap-1.5"
              >
                <CheckCircle className="w-4 h-4" />
                <span>تأكيد التحصيل نقداً</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Refund / Return Order Modal */}
      {refundingOrder && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-[#D7C3A5] space-y-4 text-right">
            <div className="flex items-center justify-between border-b border-[#F0E6D8] pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-orange-100 text-orange-800 flex items-center justify-center">
                  <RotateCcw className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-base text-[#231610]">
                    استرداد ومرتجع فاتورة ({refundingOrder.orderNumber})
                  </h3>
                  <span className="text-xs text-gray-500">
                    عكس المبيعات من الوردية وإعادة الخامات للمخزون
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRefundingOrder(null)}
                className="p-1 text-gray-400 hover:text-gray-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-[#231610] mb-1">
                  مبلغ الاسترداد ({profile.currency}) — الحد الأقصى {refundingOrder.total.toFixed(2)}:
                </label>
                <input
                  type="number"
                  step="0.5"
                  min={0.5}
                  max={refundingOrder.total}
                  value={refundAmount}
                  onChange={(e) =>
                    setRefundAmount(Math.min(refundingOrder.total, Math.max(0, parseFloat(e.target.value) || 0)))
                  }
                  className="w-full px-3 py-2 rounded-xl border border-[#D7C3A5] font-black text-left tabular-nums"
                  dir="ltr"
                />
              </div>

              <div>
                <label className="block font-bold text-[#231610] mb-1">سبب الاسترداد / المرتجع:</label>
                <input
                  type="text"
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[#D7C3A5]"
                />
              </div>

              <label className="flex items-center gap-2 p-2.5 rounded-xl bg-[#FFF8EF] border border-[#D7C3A5] cursor-pointer font-bold text-[#231610]">
                <input
                  type="checkbox"
                  checked={refundRestock}
                  onChange={(e) => setRefundRestock(e.target.checked)}
                  className="rounded text-[#8B1E1E]"
                />
                <span>إرجاع كميات الخامات المخصومة إلى المخزون تلقائياً</span>
              </label>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRefundingOrder(null)}
                className="flex-1 py-2.5 rounded-xl border border-gray-300 text-gray-700 font-bold text-xs hover:bg-gray-100"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleConfirmRefund}
                className="flex-1 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-black text-xs shadow-xs flex items-center justify-center gap-1.5"
              >
                <RotateCcw className="w-4 h-4" />
                <span>تأكيد الاسترداد</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Station Tickets Viewer & Single-Station Reprint Modal */}
      {viewingTicketsOrder && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl border border-[#D7C3A5]">
            <div className="p-4 bg-[#231610] text-white flex items-center justify-between">
              <div>
                <h3 className="font-black text-sm">
                  تذاكر محطات المطبخ للطلب: {viewingTicketsOrder.orderNumber}
                </h3>
                <p className="text-[11px] text-amber-300">
                  تُطبع التذاكر متسلسلة عبر طابعة المطبخ المشتركة
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setViewingTicketsOrder(null);
                  setPreviewTicketHtml(null);
                }}
                className="p-1 text-gray-300 hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="space-y-2">
                {posDb.getKitchenTickets({ orderId: viewingTicketsOrder.id }).length === 0 ? (
                  <div className="p-6 text-center bg-gray-50 rounded-2xl border border-dashed border-gray-300 text-gray-500">
                    لا توجد تذاكر محطات صادرة لهذا الطلب بعد.
                  </div>
                ) : (
                  posDb
                    .getKitchenTickets({ orderId: viewingTicketsOrder.id })
                    .map((tk) => (
                      <div
                        key={tk.id}
                        className={`p-3 rounded-2xl border space-y-2 cursor-pointer transition-all ${
                          previewTicketHtml?.id === tk.id
                            ? 'border-[#8B1E1E] bg-[#FFF8EF]'
                            : 'border-[#E8DFD5] bg-white hover:bg-[#FAF7F2]'
                        }`}
                        onClick={() => setPreviewTicketHtml(tk)}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-black text-[#231610]">
                            {tk.stationNameAr} ({tk.sequenceLabel})
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-black ${
                              tk.ticketType === 'CANCELLATION'
                                ? 'bg-red-100 text-red-800'
                                : tk.ticketType === 'MODIFICATION'
                                ? 'bg-amber-100 text-amber-900'
                                : 'bg-emerald-100 text-emerald-800'
                            }`}
                          >
                            {tk.ticketType === 'CANCELLATION'
                              ? 'إلغاء'
                              : tk.ticketType === 'MODIFICATION'
                              ? 'تعديل'
                              : 'جديد'}
                          </span>
                        </div>
                        <div className="text-[11px] text-gray-600">
                          {tk.items.map((it) => `${it.productNameAr} (${it.quantity}x)`).join(' • ')}
                        </div>
                        <div className="flex items-center justify-between pt-1 border-t border-gray-100">
                          <span className="text-[10px] text-gray-500">
                            الحالة: {tk.printStatus === 'completed' ? 'مطبوعة ✓' : tk.printStatus === 'failed' ? 'فشل ⚠' : 'معلقة'}
                            {tk.reprintCount > 0 ? ` • إعادة: ${tk.reprintCount}` : ''}
                          </span>
                          <button
                            type="button"
                            onClick={async (e) => {
                              e.stopPropagation();
                              const res = await sharedKitchenPrintQueue.reprintTicket(
                                tk.id,
                                profile,
                                { userId: currentUser?.id, userName: currentUser?.name },
                                'إعادة طباعة من سجل الطلبات'
                              );
                              showToast(
                                res.success
                                  ? `تمت إعادة طباعة تذكرة ${tk.stationNameAr}`
                                  : 'تعذر الطباعة على طابعة المطبخ المشتركة',
                                res.success ? 'success' : 'warning'
                              );
                            }}
                            className="px-2.5 py-1 rounded-lg bg-amber-800 hover:bg-amber-900 text-white font-bold text-[10px] flex items-center gap-1 cursor-pointer"
                          >
                            <Printer className="w-3 h-3" />
                            <span>إعادة طباعة</span>
                          </button>
                        </div>
                      </div>
                    ))
                )}
              </div>

              <div className="bg-gray-100 rounded-2xl p-3 border border-gray-200 flex items-start justify-center overflow-y-auto max-h-[420px]">
                {previewTicketHtml ? (
                  <div
                    className="bg-white shadow p-2 border border-gray-300"
                    dangerouslySetInnerHTML={{
                      __html: generateStationKitchenTicketHTML(previewTicketHtml, profile),
                    }}
                  />
                ) : (
                  <div className="text-center text-gray-400 my-auto text-xs">
                    اختر أي تذكرة من القائمة لمعاينة شكلها الحراري 80mm
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Incremental Order Modification Modal (Affected Stations Diff Only) */}
      {modifyingOrder && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleSubmitModification}
            className="bg-white rounded-3xl max-w-xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl border border-[#D7C3A5] text-right"
          >
            <div className="p-4 bg-[#FFF8EF] border-b border-[#E8DFD5] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-[#8B1E1E]" />
                <div>
                  <h3 className="font-black text-sm text-[#231610]">
                    تعديل الطلب {modifyingOrder.orderNumber} (إرسال الفروقات فقط)
                  </h3>
                  <p className="text-[11px] text-[#7A6455]">
                    يتم طباعة تذاكر التعديل للمحطات المتأثرة بالتغيير فقط وتحديث المخزون بالصافي
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModifyingOrder(null)}
                className="p-1 text-gray-400 hover:text-gray-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
              {modWarningStations && (
                <div className="p-3 rounded-2xl bg-red-50 border-2 border-red-300 space-y-2 text-red-900">
                  <div className="font-black flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-red-600" />
                    <span>
                      تحذير: المحطات ({modWarningStations.join('، ')}) بدأت التحضير أو أصبحت جاهزة بالفعل!
                    </span>
                  </div>
                  <label className="flex items-center gap-2 font-bold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={approvePreparingEdit}
                      onChange={(e) => setApprovePreparingEdit(e.target.checked)}
                    />
                    <span>أؤكد الموافقة على تعديل هذه الأصناف وإشعار المطبخ فوراً</span>
                  </label>
                  <label className="flex items-center gap-2 font-bold cursor-pointer text-gray-800">
                    <input
                      type="checkbox"
                      checked={restockUnusedOnMod}
                      onChange={(e) => setRestockUnusedOnMod(e.target.checked)}
                    />
                    <span>إرجاع خامات الأصناف المخفضة/الملغاة للمخزون (لم تُطهَ بعد)</span>
                  </label>
                </div>
              )}

              {/* Editable Current Items */}
              <div className="space-y-1.5">
                <label className="font-black text-[#231610] block">الأصناف الحالية:</label>
                {editItems.map((it, idx) => {
                  const st = posDb.resolveStationForProductOrItem(
                    it.stationId || it.kitchenStation,
                    it.productId
                  );
                  return (
                    <div
                      key={it.id}
                      className="p-2.5 rounded-xl bg-[#FAF7F2] border border-[#E8DFD5] flex flex-wrap items-center justify-between gap-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-extrabold text-[#231610]">{it.productNameAr}</div>
                        <div className="text-[10px] text-[#6F4E37]">محطة: {st.nameAr}</div>
                        <input
                          type="text"
                          value={it.notes || ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            setEditItems((prev) =>
                              prev.map((row, rIdx) => (rIdx === idx ? { ...row, notes: val } : row))
                            );
                          }}
                          placeholder="ملاحظة الصنف..."
                          className="mt-1 w-full px-2 py-1 text-[11px] rounded-lg border border-[#D7C3A5] bg-white"
                        />
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setEditItems((prev) =>
                              prev
                                .map((row, rIdx) =>
                                  rIdx === idx
                                    ? {
                                        ...row,
                                        quantity: Math.max(0, row.quantity - 1),
                                        itemTotal: calculateLineItemTotal(
                                          row.unitPrice,
                                          0,
                                          Math.max(0, row.quantity - 1)
                                        ),
                                      }
                                    : row
                                )
                                .filter((row) => row.quantity > 0)
                            );
                          }}
                          className="w-6 h-6 rounded-lg bg-white border border-[#D7C3A5] flex items-center justify-center font-bold text-[#8B1E1E]"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="font-black w-6 text-center tabular-nums">{it.quantity}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setEditItems((prev) =>
                              prev.map((row, rIdx) =>
                                rIdx === idx
                                  ? {
                                      ...row,
                                      quantity: row.quantity + 1,
                                      itemTotal: calculateLineItemTotal(
                                        row.unitPrice,
                                        0,
                                        row.quantity + 1
                                      ),
                                    }
                                  : row
                              )
                            );
                          }}
                          className="w-6 h-6 rounded-lg bg-white border border-[#D7C3A5] flex items-center justify-center font-bold text-[#8B1E1E]"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setEditItems((prev) => prev.filter((_, rIdx) => rIdx !== idx))
                          }
                          className="p-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100"
                          title="إزالة الصنف"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Add Item Bar */}
              <div className="p-2.5 rounded-xl bg-[#FFF8EF] border border-[#D7C3A5] flex items-center gap-2">
                <select
                  value={modAddProductId}
                  onChange={(e) => setModAddProductId(e.target.value)}
                  className="flex-1 px-2.5 py-1.5 rounded-lg border border-[#D7C3A5] bg-white font-bold text-xs"
                >
                  {products
                    .filter((p) => p.available)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nameAr} ({p.price} {profile.currency})
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    const prod = products.find((p) => p.id === modAddProductId);
                    if (!prod) return;
                    const st = posDb.resolveStationForProductOrItem(
                      prod.stationId || prod.kitchenStation,
                      prod.id
                    );
                    setEditItems((prev) => [
                      ...prev,
                      {
                        id: `mod-it-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                        productId: prod.id,
                        productNameAr: prod.nameAr,
                        productNameEn: prod.nameEn,
                        unitPrice: prod.price,
                        costPrice: prod.costPrice,
                        quantity: 1,
                        selectedModifiers: [],
                        itemTotal: prod.price,
                        kitchenStation: st.id,
                        stationId: st.id,
                        status: 'pending',
                      },
                    ]);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-[#8B1E1E] text-white font-bold text-xs flex items-center gap-1 cursor-pointer shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>إضافة صنف</span>
                </button>
              </div>

              <div>
                <label className="block font-bold text-[#231610] mb-1">ملاحظات الطلب العامة:</label>
                <input
                  type="text"
                  value={editOrderNotes}
                  onChange={(e) => setEditOrderNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[#D7C3A5]"
                />
              </div>

              <div>
                <label className="block font-black text-[#8B1E1E] mb-1">
                  سبب التعديل (إلزامي لتوثيق السجل) *
                </label>
                <input
                  type="text"
                  required
                  value={modReason}
                  onChange={(e) => setModReason(e.target.value)}
                  placeholder="مثال: طلب العميل زيادة صنف أو تعديل الكمية..."
                  className="w-full px-3 py-2 rounded-xl border border-[#D7C3A5]"
                />
              </div>
            </div>

            <div className="p-4 bg-[#FAF7F2] border-t border-[#E8DFD5] flex items-center gap-2">
              <button
                type="button"
                onClick={() => setModifyingOrder(null)}
                className="flex-1 py-2.5 rounded-xl border border-gray-300 text-gray-700 font-bold text-xs hover:bg-gray-100"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={isSubmittingMod || editItems.length === 0}
                className="flex-1 py-2.5 rounded-xl bg-[#8B1E1E] hover:bg-[#721616] disabled:opacity-50 text-white font-black text-xs shadow-xs"
              >
                {isSubmittingMod ? 'جاري التنفيذ...' : 'حفظ التعديل وإرسال تذاكر الفروقات'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Cancel Single Item OR Full Order Modal */}
      {cancellingTarget && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleConfirmKitchenCancel}
            className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-red-200 space-y-4 text-right"
          >
            <div className="flex items-center justify-between border-b border-red-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-red-100 text-red-700 flex items-center justify-center">
                  <Ban className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-sm text-[#231610]">
                    {cancellingTarget.scope === 'item'
                      ? `إلغاء صنف: ${cancellingTarget.item?.productNameAr}`
                      : `إلغاء الطلب بالكامل: ${cancellingTarget.order.orderNumber}`}
                  </h3>
                  <span className="text-[11px] text-gray-500">
                    يُحفظ الطلب في قاعدة البيانات وتُرسل تذكرة إلغاء للمحطات المعنية فقط
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCancellingTarget(null)}
                className="p-1 text-gray-400 hover:text-gray-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-black text-[#8B1E1E] mb-1">
                  سبب الإلغاء (إلزامي) *
                </label>
                <div className="flex flex-wrap gap-1 mb-1.5">
                  {['تغيير رأي العميل', 'نفاد المكونات', 'خطأ إدخال الكاشير', 'تأخير التحضير'].map(
                    (preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setCancelReason(preset)}
                        className="px-2 py-0.5 rounded-lg bg-red-50 text-red-800 border border-red-200 text-[10px] font-bold hover:bg-red-100 cursor-pointer"
                      >
                        {preset}
                      </button>
                    )
                  )}
                </div>
                <input
                  type="text"
                  required
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="اكتب سبب الإلغاء بوضوح..."
                  className="w-full px-3 py-2 rounded-xl border border-[#D7C3A5]"
                />
              </div>

              <label className="flex items-center gap-2 p-2.5 rounded-xl bg-[#FFF8EF] border border-[#D7C3A5] cursor-pointer font-bold text-[#231610]">
                <input
                  type="checkbox"
                  checked={cancelRestockIfPreparing}
                  onChange={(e) => setCancelRestockIfPreparing(e.target.checked)}
                  className="rounded text-[#8B1E1E]"
                />
                <span>
                  إرجاع كميات الخامات للمخزون حتى لو بدأ التحضير (اتركه غير محدد لتسجيله كهالك تحضير)
                </span>
              </label>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setCancellingTarget(null)}
                className="flex-1 py-2.5 rounded-xl border border-gray-300 text-gray-700 font-bold text-xs hover:bg-gray-100"
              >
                تراجع
              </button>
              <button
                type="submit"
                disabled={isSubmittingCancel}
                className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-black text-xs shadow-xs flex items-center justify-center gap-1.5"
              >
                <Ban className="w-4 h-4" />
                <span>{isSubmittingCancel ? 'جاري الإلغاء...' : 'تأكيد الإلغاء وإشعار المطبخ'}</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
