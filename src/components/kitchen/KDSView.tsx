import React, { useState, useEffect } from 'react';
import {
  ChefHat,
  Clock,
  CheckCircle2,
  AlertCircle,
  Check,
  Printer,
  RotateCcw,
  Layers,
  ListChecks,
  Sliders,
  Plus,
  Edit2,
  Trash2,
  Power,
  Eye,
  X,
  RefreshCw,
  Scissors,
  AlertTriangle,
} from 'lucide-react';
import {
  KitchenPrintJobRecord,
  KitchenPrintQueuePriority,
  KitchenStation,
  KitchenStationStatus,
  KitchenTicket,
  Order,
  OrderItem,
  OrderStatus,
} from '../../types';
import { posDb } from '../../services/db';
import { useAuth } from '../../context/AuthContext';
import { useBrand } from '../../context/BrandContext';
import { useToast } from '../../context/ToastContext';
import { sharedKitchenPrintQueue } from '../../printing/core/SharedKitchenPrintQueue';
import {
  createAndDispatchOrderTickets,
  getStationStatusLabelAr,
} from '../../services/kitchenStationService';
import { generateStationKitchenTicketHTML } from '../../printing/templates/KitchenTicketTemplate';

type KitchenSubTab = 'board' | 'queue' | 'stations';

export const KDSView: React.FC = () => {
  const { currentUser } = useAuth();
  const { profile, updateProfile } = useBrand();
  const { showToast } = useToast();

  const canManageStations = currentUser?.role === 'admin' || currentUser?.role === 'manager';

  const [activeSubTab, setActiveSubTab] = useState<KitchenSubTab>('board');
  const [orders, setOrders] = useState<Order[]>(() => posDb.getOrders());
  const [stations, setStations] = useState<KitchenStation[]>(() => posDb.getKitchenStations());
  const [tickets, setTickets] = useState<KitchenTicket[]>(() => posDb.getKitchenTickets());
  const [queueSnapshot, setQueueSnapshot] = useState(() => sharedKitchenPrintQueue.getSnapshot());

  const [stationFilter, setStationFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'active' | 'completed' | 'cancelled' | 'all'>('active');
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [previewTicket, setPreviewTicket] = useState<KitchenTicket | null>(null);
  const [isRetryingQueue, setIsRetryingQueue] = useState(false);

  // Station admin form state
  const [editingStation, setEditingStation] = useState<KitchenStation | null>(null);
  const [stationForm, setStationForm] = useState({
    code: '',
    nameAr: '',
    nameEn: '',
    chefLeadName: '',
    color: '#8B1E1E',
    sortOrder: 5,
    enabled: true,
  });

  useEffect(() => {
    const syncAll = () => {
      setOrders(posDb.getOrders());
      setStations(posDb.getKitchenStations());
      setTickets(posDb.getKitchenTickets());
      setQueueSnapshot(sharedKitchenPrintQueue.getSnapshot());
    };
    const unsubDb = posDb.subscribe(syncAll);
    const unsubQueue = sharedKitchenPrintQueue.subscribe(syncAll);
    return () => {
      unsubDb();
      unsubQueue();
    };
  }, []);

  const getElapsedMinutes = (dateStr: string) => {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    return Math.max(0, Math.floor(diffMs / 60000));
  };

  const toggleItemChecked = (itemId: string) => {
    setCheckedItems((prev) => ({
      ...prev,
      [itemId]: !prev[itemId],
    }));
  };

  // Group order items strictly by resolved kitchen station
  const groupOrderItemsByStation = (order: Order): Array<{
    station: KitchenStation;
    items: OrderItem[];
    status: KitchenStationStatus;
    printStatus: 'pending' | 'printing' | 'completed' | 'failed';
    latestTicket?: KitchenTicket;
  }> => {
    const relevantItems =
      order.status === 'cancelled'
        ? order.items
        : order.items.filter((i) => !i.cancelled && i.status !== 'cancelled');

    const map = new Map<string, { station: KitchenStation; items: OrderItem[] }>();
    relevantItems.forEach((it) => {
      const st = posDb.resolveStationForProductOrItem(it.stationId || it.kitchenStation, it.productId);
      const bucket = map.get(st.id);
      if (bucket) {
        bucket.items.push(it);
      } else {
        map.set(st.id, { station: st, items: [it] });
      }
    });

    const orderTickets = tickets.filter((t) => t.orderId === order.id);

    return Array.from(map.values())
      .sort((a, b) => (a.station.sortOrder || 0) - (b.station.sortOrder || 0))
      .map(({ station, items }) => {
        const stState = order.stationStates?.find((s) => s.stationId === station.id);
        const stationTickets = orderTickets.filter((t) => t.stationId === station.id);
        const latestTicket = stationTickets[0];
        return {
          station,
          items,
          status:
            stState?.status ||
            (order.status === 'cancelled'
              ? 'CANCELLED'
              : order.status === 'ready' || order.status === 'completed'
              ? 'READY'
              : order.status === 'preparing'
              ? 'PREPARING'
              : 'NEW'),
          printStatus: stState?.printStatus || latestTicket?.printStatus || 'pending',
          latestTicket,
        };
      });
  };

  const displayOrders = orders.filter((o) => {
    if (statusFilter === 'active') {
      if (o.status === 'completed' || o.status === 'cancelled' || o.status === 'refunded') return false;
    } else if (statusFilter === 'completed') {
      if (o.status !== 'completed') return false;
    } else if (statusFilter === 'cancelled') {
      if (o.status !== 'cancelled') return false;
    }

    if (stationFilter !== 'all') {
      const groups = groupOrderItemsByStation(o);
      if (!groups.some((g) => g.station.id === stationFilter)) return false;
    }
    return true;
  });

  const activeOrdersCount = orders.filter(
    (o) => o.status === 'preparing' || o.status === 'confirmed' || o.status === 'new' || o.status === 'ready'
  ).length;
  const delayedOrdersCount = orders.filter(
    (o) =>
      (o.status === 'preparing' || o.status === 'confirmed' || o.status === 'new') &&
      getElapsedMinutes(o.createdAt) > 15
  ).length;

  const handleStationStatusChange = (
    orderId: string,
    stationId: string,
    nextStatus: KitchenStationStatus
  ) => {
    const updated = posDb.updateOrderStationStatus(
      orderId,
      stationId,
      nextStatus,
      currentUser?.id || 'kitchen',
      currentUser?.name || 'المطبخ'
    );
    if (updated) {
      const msg =
        updated.overallKitchenStatus === 'READY'
          ? `تم تجهيز جميع محطات الطلب ${updated.orderNumber} وأصبح جاهزاً للتسليم!`
          : `تم تحديث حالة المحطة إلى: ${getStationStatusLabelAr(nextStatus)}`;
      showToast(msg, updated.overallKitchenStatus === 'READY' ? 'success' : 'info');
    }
  };

  const handleOrderComplete = (orderId: string, nextStatus: OrderStatus) => {
    posDb.updateOrderStatus(
      orderId,
      nextStatus,
      currentUser?.id || 'kitchen',
      currentUser?.name || 'الكاشير / المطبخ'
    );
    showToast(
      nextStatus === 'completed' ? 'تم تسجيل تسليم الطلب للعميل بنجاح' : 'تم إعادة فتح الطلب للتحضير',
      'success'
    );
  };

  const handleReprintSingleStation = async (order: Order, stationId: string, ticket?: KitchenTicket) => {
    if (ticket) {
      const res = await sharedKitchenPrintQueue.reprintTicket(
        ticket.id,
        profile,
        { userId: currentUser?.id, userName: currentUser?.name },
        'إعادة طباعة تذكرة محطة من لوحة المتابعة'
      );
      showToast(
        res.success
          ? `تمت إعادة طباعة تذكرة محطة "${ticket.stationNameAr}" للطلب ${order.orderNumber}`
          : `تعذر إعادة الطباعة: ${res.result?.errorMessage || 'تحقق من طابعة المطبخ المشتركة'}`,
        res.success ? 'success' : 'warning'
      );
      return;
    }

    // Order has no split tickets yet -> split and print on shared kitchen printer
    const { tickets: createdTickets, outcome } = await createAndDispatchOrderTickets(order, profile, {
      isReprint: true,
    });
    const matched = createdTickets.find((t) => t.stationId === stationId);
    showToast(
      outcome.allOk
        ? `تم تقسيم الطلب وإرسال تذكرة المحطة${matched ? ` (${matched.stationNameAr})` : ''} للطابعة المشتركة`
        : `تعذر الطباعة على طابعة المطبخ المشتركة`,
      outcome.allOk ? 'success' : 'warning'
    );
  };

  const handleRetryFailedQueue = async (filterOrderId?: string) => {
    setIsRetryingQueue(true);
    try {
      const outcome = await sharedKitchenPrintQueue.retryFailedJobs(profile, filterOrderId);
      if (outcome.totalJobs === 0) {
        showToast('لا توجد مهام فاشلة في طابور الطابعة المشتركة', 'info');
      } else if (outcome.allOk) {
        showToast(`تمت إعادة طباعة ${outcome.completedCount} تذكرة بنجاح عبر الطابعة المشتركة`, 'success');
      } else {
        showToast(
          `نجحت ${outcome.completedCount} وتعذرت ${outcome.failedCount} تذكرة. تأكد من توصيل طابعة المطبخ.`,
          'warning'
        );
      }
    } finally {
      setIsRetryingQueue(false);
    }
  };

  const handleSaveStation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageStations) return;
    if (!stationForm.nameAr.trim() || !stationForm.code.trim()) {
      showToast('يرجى إدخال كود المحطة واسمها بالعربية', 'warning');
      return;
    }

    const cleanCode = stationForm.code
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_]+/g, '_');

    const payload: KitchenStation = {
      id: editingStation ? editingStation.id : cleanCode,
      code: cleanCode,
      nameAr: stationForm.nameAr.trim(),
      nameEn: stationForm.nameEn.trim() || cleanCode,
      chefLeadName: stationForm.chefLeadName.trim() || undefined,
      color: stationForm.color || '#8B1E1E',
      sortOrder: Number(stationForm.sortOrder) || stations.length + 1,
      enabled: stationForm.enabled,
      printerId: 'shared_kitchen_printer',
      createdAt: editingStation?.createdAt || new Date().toISOString(),
    };

    posDb.saveKitchenStation(payload, currentUser?.id, currentUser?.name);
    showToast(
      editingStation ? `تم تحديث محطة "${payload.nameAr}"` : `تمت إضافة محطة "${payload.nameAr}" بنجاح`,
      'success'
    );
    setEditingStation(null);
    setStationForm({
      code: '',
      nameAr: '',
      nameEn: '',
      chefLeadName: '',
      color: '#8B1E1E',
      sortOrder: stations.length + 2,
      enabled: true,
    });
  };

  const startEditStation = (st: KitchenStation) => {
    setEditingStation(st);
    setStationForm({
      code: st.code,
      nameAr: st.nameAr,
      nameEn: st.nameEn,
      chefLeadName: st.chefLeadName || '',
      color: st.color || '#8B1E1E',
      sortOrder: st.sortOrder || 1,
      enabled: st.enabled !== false,
    });
  };

  const handleToggleStation = (st: KitchenStation) => {
    if (!canManageStations) return;
    const res = posDb.toggleKitchenStation(st.id, !st.enabled, currentUser?.id, currentUser?.name);
    if (res && res.enabled === st.enabled && st.enabled) {
      showToast('يجب إبقاء محطة واحدة مفعلة على الأقل لتوزيع تذاكر المطبخ', 'warning');
    } else {
      showToast(
        !st.enabled ? `تم تفعيل محطة "${st.nameAr}"` : `تم تعطيل محطة "${st.nameAr}"`,
        'info'
      );
    }
  };

  const handleDeleteStation = (st: KitchenStation) => {
    if (!canManageStations) return;
    const ok = posDb.deleteKitchenStation(st.id, currentUser?.id, currentUser?.name);
    if (!ok) {
      showToast('لا يمكن حذف آخر محطة مفعلة في النظام', 'warning');
    } else {
      showToast(`تم حذف محطة "${st.nameAr}" (تم الحفاظ على بيانات الطلبات التاريخية)`, 'success');
    }
  };

  const getTicketTypeLabelAr = (type: KitchenTicket['ticketType']) => {
    if (type === 'CANCELLATION') return 'إلغاء';
    if (type === 'MODIFICATION') return 'تعديل';
    return 'طلب جديد';
  };

  const getTicketTypeBadgeClass = (type: KitchenTicket['ticketType']) => {
    if (type === 'CANCELLATION') return 'bg-red-900/80 text-red-100 border-red-600';
    if (type === 'MODIFICATION') return 'bg-amber-900/80 text-amber-100 border-amber-600';
    return 'bg-emerald-900/70 text-emerald-100 border-emerald-700';
  };

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-4rem)] bg-[#1A120E] text-white overflow-hidden">
      {/* Header Controls */}
      <div className="p-3 bg-[#241711] border-b border-[#3E2723] flex flex-wrap items-center justify-between gap-3 select-none">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <ChefHat className="w-6 h-6 text-[#E64A19]" />
            <div>
              <h2 className="font-extrabold text-sm text-white">
                متابعة محطات المطبخ والطابعة الحرارية المشتركة
              </h2>
              <span className="text-[10px] text-gray-400">
                توزيع تلقائي للتذاكر على {stations.filter((s) => s.enabled).length} محطات طهي عبر طابعة مطبخ واحدة مشتركة (LAN {profile.kitchenPrinterIp || '192.168.1.200'}:{profile.kitchenPrinterPort || 9100})
              </span>
            </div>
          </div>

          <div className="h-6 w-px bg-[#3E2723] hidden sm:block" />

          {/* Quick Metrics */}
          <div className="flex items-center gap-2 text-xs">
            <div className="bg-[#331E15] px-2.5 py-1 rounded-lg border border-[#4E2E20] flex items-center gap-1.5">
              <span className="text-gray-400">طلبات نشطة:</span>
              <span className="font-bold text-amber-400 tabular-nums">{activeOrdersCount}</span>
            </div>
            {delayedOrdersCount > 0 && (
              <div className="bg-red-950/80 px-2.5 py-1 rounded-lg border border-red-800 text-red-300 flex items-center gap-1.5 animate-pulse">
                <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                <span>متأخر (&gt;15د):</span>
                <span className="font-bold tabular-nums">{delayedOrdersCount}</span>
              </div>
            )}
            {queueSnapshot.failedCount > 0 && (
              <button
                type="button"
                onClick={() => setActiveSubTab('queue')}
                className="bg-red-900/90 hover:bg-red-800 px-2.5 py-1 rounded-lg border border-red-500 text-white flex items-center gap-1.5 font-bold cursor-pointer"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-amber-300" />
                <span>فشل طباعة ({queueSnapshot.failedCount})</span>
              </button>
            )}
          </div>
        </div>

        {/* Sub-Tabs Switcher */}
        <div className="flex items-center gap-1 p-1 bg-[#140D0A] rounded-xl border border-[#3E2723] text-xs">
          <button
            type="button"
            onClick={() => setActiveSubTab('board')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
              activeSubTab === 'board' ? 'bg-[#8B1E1E] text-white shadow-xs' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>لوحة المحطات ({displayOrders.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('queue')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
              activeSubTab === 'queue' ? 'bg-[#8B1E1E] text-white shadow-xs' : 'text-gray-400 hover:text-white'
            }`}
          >
            <ListChecks className="w-3.5 h-3.5" />
            <span>طابور الطابعة المشتركة</span>
            {(queueSnapshot.pendingCount > 0 || queueSnapshot.failedCount > 0) && (
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
                  queueSnapshot.failedCount > 0 ? 'bg-red-600 text-white' : 'bg-amber-400 text-black'
                }`}
              >
                {queueSnapshot.failedCount > 0 ? queueSnapshot.failedCount : queueSnapshot.pendingCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('stations')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
              activeSubTab === 'stations' ? 'bg-[#8B1E1E] text-white shadow-xs' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>إدارة المحطات ({stations.length})</span>
          </button>
        </div>
      </div>

      {/* ================= TAB 1: STATION BOARD ================= */}
      {activeSubTab === 'board' && (
        <>
          {/* Filter Bar */}
          <div className="px-4 py-2.5 bg-[#201510] border-b border-[#3E2723] flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => setStationFilter('all')}
                className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                  stationFilter === 'all'
                    ? 'bg-[#8B1E1E] text-white shadow-xs'
                    : 'bg-[#140D0A] text-gray-400 hover:text-white border border-[#3E2723]'
                }`}
              >
                جميع المحطات
              </button>
              {stations.map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setStationFilter(st.id)}
                  className={`px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5 cursor-pointer border ${
                    stationFilter === st.id
                      ? 'text-white shadow-xs'
                      : 'bg-[#140D0A] text-gray-300 hover:text-white border-[#3E2723]'
                  }`}
                  style={
                    stationFilter === st.id
                      ? { backgroundColor: st.color || '#8B1E1E', borderColor: st.color || '#8B1E1E' }
                      : undefined
                  }
                >
                  <span>{st.nameAr}</span>
                  {!st.enabled && <span className="text-[9px] opacity-70">(معطلة)</span>}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 p-1 bg-[#140D0A] rounded-xl border border-[#3E2723]">
              {(
                [
                  { id: 'active', label: 'النشطة' },
                  { id: 'completed', label: 'المكتملة' },
                  { id: 'cancelled', label: 'الملغاة' },
                  { id: 'all', label: 'الكل' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={`px-2.5 py-1 rounded-lg font-bold cursor-pointer ${
                    statusFilter === tab.id ? 'bg-[#3E2723] text-white' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Orders Grid */}
          <div className="flex-1 overflow-y-auto p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {displayOrders.map((order) => {
                const elapsed = getElapsedMinutes(order.createdAt);
                const isDelayed = elapsed > 15 && order.status !== 'completed' && order.status !== 'cancelled';
                const isUrgent = elapsed > 20 && order.status !== 'completed' && order.status !== 'cancelled';

                const stationGroups = groupOrderItemsByStation(order);
                const visibleGroups =
                  stationFilter === 'all'
                    ? stationGroups
                    : stationGroups.filter((g) => g.station.id === stationFilter);

                const overallStatus =
                  order.overallKitchenStatus ||
                  posDb.computeOverallKitchenStatus(
                    stationGroups.map((g) => ({
                      stationId: g.station.id,
                      stationCode: g.station.code,
                      stationNameAr: g.station.nameAr,
                      stationNameEn: g.station.nameEn,
                      status: g.status,
                      printStatus: g.printStatus,
                      updatedAt: order.updatedAt || order.createdAt,
                    }))
                  );

                const readyStationsCount = stationGroups.filter((g) => g.status === 'READY').length;
                const activeStationsCount = stationGroups.filter((g) => g.status !== 'CANCELLED').length;

                return (
                  <div
                    key={order.id}
                    className={`rounded-2xl border flex flex-col justify-between overflow-hidden shadow-lg transition-all ${
                      order.status === 'cancelled'
                        ? 'bg-[#231214] border-red-800/80 opacity-90'
                        : isUrgent
                        ? 'bg-[#2A1111] border-red-600 ring-2 ring-red-500/40'
                        : isDelayed
                        ? 'bg-[#2E1E13] border-amber-600'
                        : 'bg-[#231710] border-[#3E2723]'
                    }`}
                  >
                    {/* Card Header */}
                    <div
                      className={`p-3 flex items-center justify-between text-xs font-bold border-b ${
                        order.status === 'cancelled'
                          ? 'bg-red-950/90 border-red-800 text-red-200'
                          : isUrgent
                          ? 'bg-red-900/60 border-red-700 text-white'
                          : isDelayed
                          ? 'bg-amber-900/60 border-amber-700 text-amber-200'
                          : 'bg-[#2C1D15] border-[#3E2723] text-gray-200'
                      }`}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-base font-black tracking-wide text-white">
                          {order.orderNumber}
                        </span>
                        <span className="text-[10px] bg-black/40 px-1.5 py-0.5 rounded">
                          {order.type === 'dine_in'
                            ? `صالات${order.tableNumber ? ` (${order.tableNumber})` : ''}`
                            : order.type === 'takeaway'
                            ? 'سفري'
                            : order.type === 'delivery'
                            ? 'توصيل'
                            : 'استلام'}
                        </span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded font-black ${
                            overallStatus === 'READY'
                              ? 'bg-emerald-700 text-white'
                              : overallStatus === 'CANCELLED'
                              ? 'bg-red-700 text-white'
                              : overallStatus === 'PREPARING'
                              ? 'bg-amber-700 text-white'
                              : 'bg-gray-700 text-gray-100'
                          }`}
                        >
                          {getStationStatusLabelAr(overallStatus)} ({readyStationsCount}/{activeStationsCount})
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 text-xs tabular-nums shrink-0">
                        <Clock className="w-3.5 h-3.5" />
                        <span className="font-extrabold">{elapsed} د</span>
                      </div>
                    </div>

                    {/* Meta Info */}
                    <div className="px-3 py-1.5 bg-black/20 text-[11px] flex items-center justify-between text-gray-300 border-b border-[#3E2723]">
                      <span className="truncate">
                        {order.tableNumber
                          ? `طاولة: ${order.tableNumber}`
                          : order.customerName || 'عميل مباشر'}
                      </span>
                      <span className="text-[10px] text-gray-400">
                        {new Date(order.createdAt).toLocaleTimeString('ar-EG', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>

                    {/* Per-Station Split Sections */}
                    <div className="p-3 flex-1 overflow-y-auto space-y-3 max-h-[420px]">
                      {visibleGroups.map((grp) => (
                        <div
                          key={grp.station.id}
                          className="rounded-xl border border-[#4A3124] bg-[#1A110C] overflow-hidden"
                        >
                          {/* Station Sub-header */}
                          <div
                            className="px-2.5 py-2 flex flex-wrap items-center justify-between gap-1.5 border-b border-[#3E2723]"
                            style={{ backgroundColor: `${grp.station.color || '#8B1E1E'}24` }}
                          >
                            <div className="flex items-center gap-1.5">
                              <span
                                className="w-2.5 h-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: grp.station.color || '#E64A19' }}
                              />
                              <span className="font-black text-xs text-white">{grp.station.nameAr}</span>
                              {grp.latestTicket && (
                                <span className="text-[10px] font-mono bg-black/40 px-1.5 py-0.5 rounded text-amber-200">
                                  {grp.latestTicket.sequenceLabel}
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-1">
                              <span
                                className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                                  grp.printStatus === 'completed'
                                    ? 'bg-emerald-900/70 text-emerald-200'
                                    : grp.printStatus === 'failed'
                                    ? 'bg-red-900/80 text-red-200'
                                    : 'bg-amber-900/70 text-amber-200'
                                }`}
                              >
                                {grp.printStatus === 'completed'
                                  ? 'مطبوعة ✓'
                                  : grp.printStatus === 'failed'
                                  ? 'فشل الطباعة'
                                  : grp.printStatus === 'printing'
                                  ? 'جاري...'
                                  : 'معلقة'}
                              </span>

                              {grp.latestTicket && (
                                <button
                                  type="button"
                                  onClick={() => setPreviewTicket(grp.latestTicket!)}
                                  className="p-1 rounded bg-black/40 hover:bg-black/70 text-gray-200 cursor-pointer"
                                  title="معاينة التذكرة الحرارية لهذه المحطة"
                                >
                                  <Eye className="w-3 h-3" />
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() =>
                                  handleReprintSingleStation(order, grp.station.id, grp.latestTicket)
                                }
                                className="p-1 rounded bg-amber-800 hover:bg-amber-700 text-white cursor-pointer"
                                title={`إعادة طباعة تذكرة محطة ${grp.station.nameAr} فقط`}
                              >
                                <Printer className="w-3 h-3" />
                              </button>
                            </div>
                          </div>

                          {/* Items for THIS station ONLY */}
                          <div className="p-2 space-y-1.5">
                            {grp.items.map((item) => {
                              const isChecked = checkedItems[item.id] || item.status === 'ready';
                              return (
                                <div
                                  key={item.id}
                                  onClick={() => toggleItemChecked(item.id)}
                                  className={`p-1.5 rounded-lg border transition-all cursor-pointer flex items-start gap-2 ${
                                    item.cancelled || item.status === 'cancelled'
                                      ? 'bg-red-950/40 border-red-800/50 text-red-300 line-through'
                                      : isChecked
                                      ? 'bg-emerald-950/35 border-emerald-800/50 text-gray-400'
                                      : 'bg-[#261913] border-[#3E2723] text-white'
                                  }`}
                                >
                                  <div
                                    className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 mt-0.5 ${
                                      isChecked
                                        ? 'bg-emerald-600 border-emerald-500 text-white'
                                        : 'border-gray-500 bg-black/30'
                                    }`}
                                  >
                                    {isChecked && <Check className="w-3 h-3 stroke-[3]" />}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between text-xs font-bold gap-2">
                                      <span className="truncate">
                                        {item.itemType === 'offer' ? `🔥 [عرض] ${item.productNameAr}` : item.productNameAr}
                                      </span>
                                      <span className="text-amber-400 font-black tabular-nums shrink-0">
                                        {item.quantity}x
                                      </span>
                                    </div>
                                    {item.itemType === 'offer' && item.offerComponents && item.offerComponents.length > 0 && (
                                      <div className="text-[10px] text-[#FCD34D] font-bold mt-0.5 space-y-0.5">
                                        {item.offerComponents.map((comp) => (
                                          <div key={comp.productId}>
                                            • {comp.productNameAr} × {Number((comp.quantity * item.quantity).toFixed(2))}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                    {item.selectedModifiers && item.selectedModifiers.length > 0 && (
                                      <div className="text-[10px] text-amber-300/90 mt-0.5">
                                        + {item.selectedModifiers.map((m) => m.nameAr).join('، ')}
                                      </div>
                                    )}
                                    {item.notes && (
                                      <div className="text-[10px] text-yellow-300 italic mt-0.5">
                                        ملاحظة: {item.notes}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          {/* Station Status Action Row */}
                          {order.status !== 'cancelled' && order.status !== 'completed' && (
                            <div className="px-2 py-1.5 bg-black/25 border-t border-[#3E2723] flex items-center gap-1 text-[10px]">
                              {(
                                [
                                  { id: 'PRINTED', label: 'طُبعت' },
                                  { id: 'PREPARING', label: 'قيد التحضير' },
                                  { id: 'READY', label: 'جاهز ✓' },
                                ] as const
                              ).map((btn) => (
                                <button
                                  key={btn.id}
                                  type="button"
                                  onClick={() =>
                                    handleStationStatusChange(order.id, grp.station.id, btn.id)
                                  }
                                  className={`flex-1 py-1 rounded-md font-bold transition-colors cursor-pointer ${
                                    grp.status === btn.id
                                      ? btn.id === 'READY'
                                        ? 'bg-emerald-600 text-white'
                                        : btn.id === 'PREPARING'
                                        ? 'bg-[#E64A19] text-white'
                                        : 'bg-purple-700 text-white'
                                      : 'bg-[#2C1D15] text-gray-300 hover:bg-[#3E2723]'
                                  }`}
                                >
                                  {btn.label}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {order.notes && (
                      <div className="px-3 py-1.5 bg-red-950/40 text-[10px] text-red-200 border-t border-[#3E2723]">
                        ملاحظات الطلب: {order.notes}
                      </div>
                    )}

                    {/* Card Footer Action */}
                    <div className="p-2.5 bg-[#1C120D] border-t border-[#3E2723] flex items-center gap-2">
                      {order.status !== 'completed' && order.status !== 'cancelled' && (
                        <>
                          {overallStatus === 'READY' ? (
                            <button
                              type="button"
                              onClick={() => handleOrderComplete(order.id, 'completed')}
                              className="w-full py-2 bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-black rounded-xl transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                              <CheckCircle2 className="w-4 h-4" />
                              <span>تم تسليم الطلب بالكامل للعميل</span>
                            </button>
                          ) : (
                            <div className="w-full flex items-center justify-between gap-2 text-[11px] text-amber-200/90 px-1">
                              <span>بانتظار جاهزية جميع المحطات ({readyStationsCount}/{activeStationsCount})</span>
                              {order.kitchenPrintStatus !== 'printed' && (
                                <button
                                  type="button"
                                  onClick={() => createAndDispatchOrderTickets(order, profile)}
                                  className="px-2.5 py-1 rounded-lg bg-amber-700 hover:bg-amber-600 text-white font-bold flex items-center gap-1 cursor-pointer"
                                >
                                  <Printer className="w-3 h-3" />
                                  <span>طباعة الكل</span>
                                </button>
                              )}
                            </div>
                          )}
                        </>
                      )}

                      {order.status === 'completed' && (
                        <button
                          type="button"
                          onClick={() => handleOrderComplete(order.id, 'preparing')}
                          className="w-full py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>إعادة فتح الطلب</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {displayOrders.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center p-12 text-gray-400">
                <ChefHat className="w-16 h-16 text-[#3E2723] mb-3 stroke-[1.2]" />
                <h3 className="font-bold text-base text-gray-200">
                  لا توجد طلبات مطابقة في لوحة المحطات حالياً
                </h3>
                <p className="text-xs text-gray-500 mt-1">
                  سيتم تقسيم أي طلب جديد تلقائياً حسب محطة كل صنف وإرساله لطابور طابعة المطبخ المشتركة.
                </p>
              </div>
            )}
          </div>
        </>
      )}

      {/* ================= TAB 2: SHARED PRINTER QUEUE & TICKETS ================= */}
      {activeSubTab === 'queue' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Summary & Policy Bar */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Queue Status Card */}
            <div className="bg-[#241711] border border-[#3E2723] rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-extrabold text-sm text-white flex items-center gap-2">
                  <Printer className="w-4 h-4 text-amber-400" />
                  <span>حالة الطابعة المشتركة</span>
                </h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-black/40 border border-[#4E2E20] text-amber-300 font-mono">
                  {profile.kitchenPrinterIp || '192.168.1.200'}:{profile.kitchenPrinterPort || 9100}
                </span>
              </div>

              <div className="grid grid-cols-4 gap-2 text-center text-xs">
                <div className="bg-[#1A110C] p-2 rounded-xl border border-[#3E2723]">
                  <div className="text-amber-400 font-black text-base tabular-nums">
                    {queueSnapshot.pendingCount}
                  </div>
                  <div className="text-[10px] text-gray-400">معلقة</div>
                </div>
                <div className="bg-[#1A110C] p-2 rounded-xl border border-[#3E2723]">
                  <div className="text-blue-400 font-black text-base tabular-nums">
                    {queueSnapshot.printingCount}
                  </div>
                  <div className="text-[10px] text-gray-400">تُطبع</div>
                </div>
                <div className="bg-[#1A110C] p-2 rounded-xl border border-[#3E2723]">
                  <div className="text-emerald-400 font-black text-base tabular-nums">
                    {queueSnapshot.completedCount}
                  </div>
                  <div className="text-[10px] text-gray-400">مكتملة</div>
                </div>
                <div className="bg-[#1A110C] p-2 rounded-xl border border-[#3E2723]">
                  <div className="text-red-400 font-black text-base tabular-nums">
                    {queueSnapshot.failedCount}
                  </div>
                  <div className="text-[10px] text-gray-400">فاشلة</div>
                </div>
              </div>

              <button
                type="button"
                disabled={isRetryingQueue || queueSnapshot.failedCount === 0}
                onClick={() => handleRetryFailedQueue()}
                className="w-full py-2 rounded-xl bg-amber-700 hover:bg-amber-600 disabled:opacity-40 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRetryingQueue ? 'animate-spin' : ''}`} />
                <span>إعادة محاولة طباعة المهام الفاشلة ({queueSnapshot.failedCount})</span>
              </button>
            </div>

            {/* Priority & Hardware Controls */}
            <div className="lg:col-span-2 bg-[#241711] border border-[#3E2723] rounded-2xl p-4 space-y-3 text-xs">
              <h3 className="font-extrabold text-sm text-white">
                سياسة الطابور المتسلسل والقص الآلي للطابعة المشتركة
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-gray-300 mb-1">
                    أولوية التنفيذ عند تعدد التذاكر:
                  </label>
                  <select
                    value={profile.kitchenQueuePriority || 'cancellations_and_mods_first'}
                    onChange={(e) => {
                      const val = e.target.value as KitchenPrintQueuePriority;
                      updateProfile({ kitchenQueuePriority: val });
                      showToast('تم تحديث سياسة أولوية طابور المطبخ', 'success');
                    }}
                    className="w-full px-3 py-2 rounded-xl bg-[#140D0A] border border-[#4E2E20] text-white font-bold text-xs"
                  >
                    <option value="cancellations_and_mods_first">
                      الإلغاءات أولاً ← التعديلات ← الطلبات الجديدة
                    </option>
                    <option value="cancellations_only">الإلغاءات أولاً ثم الترتيب الزمني</option>
                    <option value="fifo_strict">الترتيب الزمني الصارم (FIFO)</option>
                  </select>
                </div>

                <div className="space-y-2 pt-1">
                  <label className="flex items-center gap-2 cursor-pointer text-gray-200 font-bold">
                    <input
                      type="checkbox"
                      checked={profile.kitchenGroupOrderTickets !== false}
                      onChange={(e) => {
                        updateProfile({ kitchenGroupOrderTickets: e.target.checked });
                        showToast('تم تحديث إعداد تجميع تذاكر الطلب', 'info');
                      }}
                      className="rounded text-[#8B1E1E]"
                    />
                    <span>عدم تداخل تذاكر طلبين معاً (Batch Contiguity)</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer text-gray-200 font-bold">
                    <input
                      type="checkbox"
                      checked={(profile.receiptSettings?.kitchenAutoCut ?? profile.kitchenAutoCut) !== false}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        updateProfile({
                          kitchenAutoCut: checked,
                          receiptSettings: profile.receiptSettings
                            ? { ...profile.receiptSettings, kitchenAutoCut: checked }
                            : undefined,
                        });
                        showToast(
                          checked ? 'تم تفعيل أمر القص التلقائي (GS V)' : 'تم تعطيل القص التلقائي (فواصل وتغذية ورق فقط)',
                          'info'
                        );
                      }}
                      className="rounded text-[#8B1E1E]"
                    />
                    <Scissors className="w-3.5 h-3.5 text-amber-400" />
                    <span>تفعيل القص التلقائي (GS V) بين تذاكر المحطات</span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* Jobs Queue Table */}
          <div className="bg-[#241711] border border-[#3E2723] rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[#3E2723] flex items-center justify-between">
              <h3 className="font-extrabold text-sm text-white">
                سجل مهام طابور الطابعة المشتركة ({queueSnapshot.jobs.length})
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-[#1A110C] text-gray-300 border-b border-[#3E2723]">
                  <tr>
                    <th className="p-3">رقم الطلب</th>
                    <th className="p-3">المحطة</th>
                    <th className="p-3">نوع التذكرة</th>
                    <th className="p-3">التسلسل</th>
                    <th className="p-3">الحالة</th>
                    <th className="p-3">المحاولات</th>
                    <th className="p-3">الوقت</th>
                    <th className="p-3">التفاصيل / الخطأ</th>
                    <th className="p-3 text-center">إجراء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#332018]">
                  {queueSnapshot.jobs.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="p-8 text-center text-gray-400">
                        لا توجد مهام مسجلة في طابور المطبخ بعد.
                      </td>
                    </tr>
                  ) : (
                    queueSnapshot.jobs.slice(0, 60).map((job: KitchenPrintJobRecord) => {
                      const ticket = tickets.find((t) => t.id === job.ticketId);
                      return (
                        <tr key={job.jobId} className="hover:bg-[#2C1D15]">
                          <td className="p-3 font-black text-amber-300">{job.orderNumber}</td>
                          <td className="p-3 font-bold text-white">{job.stationNameAr}</td>
                          <td className="p-3">
                            <span
                              className={`px-2 py-0.5 rounded border text-[10px] font-bold ${getTicketTypeBadgeClass(
                                job.ticketType
                              )}`}
                            >
                              {getTicketTypeLabelAr(job.ticketType)}
                            </span>
                          </td>
                          <td className="p-3 font-mono text-gray-300">{job.sequenceLabel}</td>
                          <td className="p-3">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                                job.status === 'completed'
                                  ? 'bg-emerald-900/80 text-emerald-200'
                                  : job.status === 'failed'
                                  ? 'bg-red-900/90 text-red-200'
                                  : job.status === 'printing'
                                  ? 'bg-blue-900/80 text-blue-200'
                                  : 'bg-amber-900/80 text-amber-200'
                              }`}
                            >
                              {job.status === 'completed'
                                ? 'مكتمل'
                                : job.status === 'failed'
                                ? 'فشل'
                                : job.status === 'printing'
                                ? 'جاري الطباعة'
                                : 'قيد الانتظار'}
                            </span>
                          </td>
                          <td className="p-3 tabular-nums text-gray-300">{job.retryCount}</td>
                          <td className="p-3 text-gray-400 text-[11px] tabular-nums">
                            {new Date(job.createdAt).toLocaleTimeString('ar-EG')}
                          </td>
                          <td className="p-3 text-[11px] text-red-300 max-w-[220px] truncate">
                            {job.errorMessage || '—'}
                          </td>
                          <td className="p-3">
                            <div className="flex items-center justify-center gap-1.5">
                              {ticket && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => setPreviewTicket(ticket)}
                                    className="p-1.5 rounded-lg bg-[#140D0A] hover:bg-black text-gray-200 cursor-pointer"
                                    title="معاينة التذكرة"
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      const res = await sharedKitchenPrintQueue.reprintTicket(
                                        ticket.id,
                                        profile,
                                        { userId: currentUser?.id, userName: currentUser?.name },
                                        'إعادة طباعة من جدول الطابور'
                                      );
                                      showToast(
                                        res.success ? 'تمت إعادة الطباعة بنجاح' : 'تعذر إعادة الطباعة',
                                        res.success ? 'success' : 'warning'
                                      );
                                    }}
                                    className="p-1.5 rounded-lg bg-amber-800 hover:bg-amber-700 text-white cursor-pointer"
                                    title="إعادة طباعة هذه التذكرة فقط"
                                  >
                                    <Printer className="w-3.5 h-3.5" />
                                  </button>
                                </>
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
      )}

      {/* ================= TAB 3: STATIONS MANAGEMENT ================= */}
      {activeSubTab === 'stations' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="bg-[#241711] border border-[#3E2723] rounded-2xl p-4 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div>
              <h3 className="font-extrabold text-sm text-white">
                محطات تحضير المطبخ المرتبطة بالطابعة المشتركة
              </h3>
              <p className="text-gray-400 mt-0.5">
                ترتبط كافة المحطات بطابعة المطبخ الوحيدة (shared_kitchen_printer)، وتُطبع تذكرة منفصلة لكل محطة عند احتواء الطلب على أصنافها.
              </p>
            </div>
            {!canManageStations && (
              <span className="px-3 py-1 rounded-xl bg-amber-900/50 border border-amber-700 text-amber-200 font-bold">
                وضع عرض فقط — التعديل متاح للمدير فقط
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Form for Admin / Manager */}
            {canManageStations && (
              <form
                onSubmit={handleSaveStation}
                className="bg-[#241711] border border-[#3E2723] rounded-2xl p-4 space-y-3 text-xs h-fit"
              >
                <h4 className="font-extrabold text-sm text-amber-300 flex items-center gap-1.5">
                  <Plus className="w-4 h-4" />
                  <span>{editingStation ? `تعديل محطة: ${editingStation.nameAr}` : 'إضافة محطة جديدة'}</span>
                </h4>

                <div>
                  <label className="block font-bold text-gray-300 mb-1">كود المحطة (إنجليزي) *</label>
                  <input
                    type="text"
                    required
                    disabled={!!editingStation}
                    value={stationForm.code}
                    onChange={(e) => setStationForm({ ...stationForm, code: e.target.value })}
                    placeholder="مثال: SHAWARMA_STATION"
                    dir="ltr"
                    className="w-full px-3 py-2 rounded-xl bg-[#140D0A] border border-[#4E2E20] text-white font-mono text-left disabled:opacity-60"
                  />
                </div>

                <div>
                  <label className="block font-bold text-gray-300 mb-1">اسم المحطة بالعربية *</label>
                  <input
                    type="text"
                    required
                    value={stationForm.nameAr}
                    onChange={(e) => setStationForm({ ...stationForm, nameAr: e.target.value })}
                    placeholder="مثال: الشاورما"
                    className="w-full px-3 py-2 rounded-xl bg-[#140D0A] border border-[#4E2E20] text-white"
                  />
                </div>

                <div>
                  <label className="block font-bold text-gray-300 mb-1">اسم المحطة بالإنجليزية</label>
                  <input
                    type="text"
                    value={stationForm.nameEn}
                    onChange={(e) => setStationForm({ ...stationForm, nameEn: e.target.value })}
                    placeholder="Shawarma Station"
                    dir="ltr"
                    className="w-full px-3 py-2 rounded-xl bg-[#140D0A] border border-[#4E2E20] text-white text-left"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-bold text-gray-300 mb-1">الترتيب</label>
                    <input
                      type="number"
                      min={1}
                      value={stationForm.sortOrder}
                      onChange={(e) =>
                        setStationForm({ ...stationForm, sortOrder: parseInt(e.target.value) || 1 })
                      }
                      className="w-full px-3 py-2 rounded-xl bg-[#140D0A] border border-[#4E2E20] text-white text-center tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-gray-300 mb-1">اللون التمييزي</label>
                    <input
                      type="color"
                      value={stationForm.color}
                      onChange={(e) => setStationForm({ ...stationForm, color: e.target.value })}
                      className="w-full h-9 rounded-xl bg-[#140D0A] border border-[#4E2E20] cursor-pointer"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-gray-300 mb-1">مسؤول المحطة (اختياري)</label>
                  <input
                    type="text"
                    value={stationForm.chefLeadName}
                    onChange={(e) => setStationForm({ ...stationForm, chefLeadName: e.target.value })}
                    placeholder="اسم الشيف المسؤول"
                    className="w-full px-3 py-2 rounded-xl bg-[#140D0A] border border-[#4E2E20] text-white"
                  />
                </div>

                <label className="flex items-center gap-2 cursor-pointer text-gray-200 font-bold">
                  <input
                    type="checkbox"
                    checked={stationForm.enabled}
                    onChange={(e) => setStationForm({ ...stationForm, enabled: e.target.checked })}
                  />
                  <span>المحطة مفعلة وتستقبل تذاكر الطباعة</span>
                </label>

                <div className="flex items-center gap-2 pt-2">
                  {editingStation && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingStation(null);
                        setStationForm({
                          code: '',
                          nameAr: '',
                          nameEn: '',
                          chefLeadName: '',
                          color: '#8B1E1E',
                          sortOrder: stations.length + 1,
                          enabled: true,
                        });
                      }}
                      className="flex-1 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 font-bold cursor-pointer"
                    >
                      إلغاء
                    </button>
                  )}
                  <button
                    type="submit"
                    className="flex-1 py-2 rounded-xl bg-[#8B1E1E] hover:bg-[#721616] text-white font-black cursor-pointer"
                  >
                    {editingStation ? 'حفظ التعديلات' : 'إضافة المحطة'}
                  </button>
                </div>
              </form>
            )}

            {/* Stations List */}
            <div
              className={`${
                canManageStations ? 'lg:col-span-2' : 'lg:col-span-3'
              } grid grid-cols-1 sm:grid-cols-2 gap-3 h-fit`}
            >
              {stations.map((st) => (
                <div
                  key={st.id}
                  className={`p-4 rounded-2xl border flex flex-col justify-between gap-3 ${
                    st.enabled
                      ? 'bg-[#241711] border-[#3E2723]'
                      : 'bg-[#19110D] border-gray-800 opacity-70'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center font-black text-white text-sm shrink-0"
                        style={{ backgroundColor: st.color || '#8B1E1E' }}
                      >
                        {st.sortOrder}
                      </div>
                      <div>
                        <div className="font-black text-sm text-white">{st.nameAr}</div>
                        <div className="text-[11px] font-mono text-amber-300">{st.code}</div>
                        {st.chefLeadName && (
                          <div className="text-[10px] text-gray-400">الشيف: {st.chefLeadName}</div>
                        )}
                      </div>
                    </div>

                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                        st.enabled
                          ? 'bg-emerald-900/70 text-emerald-200 border border-emerald-700'
                          : 'bg-gray-800 text-gray-400 border border-gray-700'
                      }`}
                    >
                      {st.enabled ? 'مفعلة' : 'معطلة'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-gray-400 border-t border-[#3E2723] pt-2">
                    <span>الطابعة: طابعة المطبخ المشتركة</span>
                    {canManageStations && (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleToggleStation(st)}
                          className={`p-1.5 rounded-lg cursor-pointer ${
                            st.enabled
                              ? 'bg-amber-900/60 text-amber-200 hover:bg-amber-800'
                              : 'bg-emerald-900/60 text-emerald-200 hover:bg-emerald-800'
                          }`}
                          title={st.enabled ? 'تعطيل المحطة' : 'تفعيل المحطة'}
                        >
                          <Power className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => startEditStation(st)}
                          className="p-1.5 rounded-lg bg-[#140D0A] text-gray-200 hover:bg-black cursor-pointer"
                          title="تعديل"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteStation(st)}
                          className="p-1.5 rounded-lg bg-red-950/80 text-red-300 hover:bg-red-800 cursor-pointer"
                          title="حذف المحطة"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ================= STATION TICKET THERMAL PREVIEW MODAL ================= */}
      {previewTicket && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#F8F5F0] text-[#231610] rounded-3xl max-w-md w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl border border-[#D7C3A5]">
            <div className="p-4 bg-[#231610] text-white flex items-center justify-between">
              <div>
                <h3 className="font-black text-sm">
                  معاينة تذكرة محطة: {previewTicket.stationNameAr} ({previewTicket.sequenceLabel})
                </h3>
                <div className="text-[11px] text-amber-300">
                  الطلب {previewTicket.orderNumber} — {getTicketTypeLabelAr(previewTicket.ticketType)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPreviewTicket(null)}
                className="p-1.5 rounded-lg hover:bg-white/10 text-gray-300 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 flex justify-center bg-gray-200">
              <div
                className="bg-white shadow-md p-2 border border-gray-300"
                dangerouslySetInnerHTML={{
                  __html: generateStationKitchenTicketHTML(previewTicket, profile),
                }}
              />
            </div>

            <div className="p-3 bg-white border-t border-[#E8DFD5] flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPreviewTicket(null)}
                className="flex-1 py-2 rounded-xl border border-gray-300 text-xs font-bold text-gray-700 hover:bg-gray-100 cursor-pointer"
              >
                إغلاق
              </button>
              <button
                type="button"
                onClick={async () => {
                  const res = await sharedKitchenPrintQueue.reprintTicket(
                    previewTicket.id,
                    profile,
                    { userId: currentUser?.id, userName: currentUser?.name },
                    'إعادة طباعة من نافذة المعاينة'
                  );
                  showToast(
                    res.success
                      ? `تم إرسال تذكرة ${previewTicket.stationNameAr} للطابعة المشتركة`
                      : 'تعذر الطباعة على طابعة المطبخ المشتركة',
                    res.success ? 'success' : 'warning'
                  );
                }}
                className="flex-1 py-2 rounded-xl bg-[#8B1E1E] hover:bg-[#721616] text-white text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>طباعة هذه التذكرة الآن</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
