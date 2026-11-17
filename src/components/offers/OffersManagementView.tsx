import React, { useState, useEffect, useMemo } from 'react';
import {
  Flame,
  Plus,
  Search,
  Edit3,
  Trash2,
  Copy,
  PauseCircle,
  PlayCircle,
  ArrowUp,
  ArrowDown,
  X,
  Check,
  Image as ImageIcon,
  Upload,
  Calendar,
  Clock,
  Tag,
  AlertCircle,
  PackagePlus,
  Minus,
  Sparkles,
  CheckCircle2,
  Percent,
} from 'lucide-react';
import {
  OfferComponent,
  OfferStatus,
  Product,
  SpecialOffer,
  OfferSaleRecord,
} from '../../types';
import { posDb } from '../../services/db';
import { useAuth } from '../../context/AuthContext';
import { useBrand } from '../../context/BrandContext';
import { useToast } from '../../context/ToastContext';
import { ConfirmModal } from '../common/ConfirmModal';
import {
  computeOfferOriginalPrice,
  computeOfferSavings,
  getComputedOfferStatus,
  validateOfferPricing,
} from '../../services/specialOffersService';
import { roundCurrency, roundQty } from '../../utils/currency';

const WEEKDAYS_AR: { day: number; label: string }[] = [
  { day: 6, label: 'السبت' },
  { day: 0, label: 'الأحد' },
  { day: 1, label: 'الإثنين' },
  { day: 2, label: 'الثلاثاء' },
  { day: 3, label: 'الأربعاء' },
  { day: 4, label: 'الخميس' },
  { day: 5, label: 'الجمعة' },
];

type StatusFilter = 'all' | 'active' | 'paused' | 'expired';

export const OffersManagementView: React.FC = () => {
  const { currentUser } = useAuth();
  const { profile } = useBrand();
  const { showToast } = useToast();

  const [offers, setOffers] = useState<SpecialOffer[]>(() => posDb.getOffers());
  const [products, setProducts] = useState<Product[]>(() =>
    posDb.getProducts({ includeArchived: false })
  );
  const [offerSales, setOfferSales] = useState<OfferSaleRecord[]>(() => posDb.getOfferSales());

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingOfferId, setEditingOfferId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SpecialOffer | null>(null);

  // Form State
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [components, setComponents] = useState<OfferComponent[]>([]);
  const [useCustomOriginalPrice, setUseCustomOriginalPrice] = useState(false);
  const [customOriginalPriceInput, setCustomOriginalPriceInput] = useState('');
  const [offerPriceInput, setOfferPriceInput] = useState('');
  const [status, setStatus] = useState<OfferStatus>('active');
  const [sortOrderInput, setSortOrderInput] = useState('1');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [validDays, setValidDays] = useState<number[]>([]);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [maxTotalRedemptionsInput, setMaxTotalRedemptionsInput] = useState('');
  const [maxPerOrderInput, setMaxPerOrderInput] = useState('');

  // Product Picker Search inside Modal
  const [productSearch, setProductSearch] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => {
      setOffers(posDb.getOffers());
      setProducts(posDb.getProducts({ includeArchived: false }));
      setOfferSales(posDb.getOfferSales());
    };
    sync();
    return posDb.subscribe(sync);
  }, []);

  const productsMap = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products]
  );

  const calculatedOriginalPrice = useMemo(
    () => computeOfferOriginalPrice(components, productsMap),
    [components, productsMap]
  );

  const effectiveOriginalPrice = useMemo(() => {
    if (useCustomOriginalPrice) {
      const parsed = parseFloat(customOriginalPriceInput);
      return Number.isFinite(parsed) && parsed > 0 ? roundCurrency(parsed) : 0;
    }
    return calculatedOriginalPrice;
  }, [useCustomOriginalPrice, customOriginalPriceInput, calculatedOriginalPrice]);

  const parsedOfferPrice = useMemo(() => {
    const val = parseFloat(offerPriceInput);
    return Number.isFinite(val) ? roundCurrency(val) : 0;
  }, [offerPriceInput]);

  const livePricingCheck = useMemo(
    () => validateOfferPricing(effectiveOriginalPrice, parsedOfferPrice),
    [effectiveOriginalPrice, parsedOfferPrice]
  );

  const liveSavings = useMemo(
    () => computeOfferSavings(effectiveOriginalPrice, parsedOfferPrice),
    [effectiveOriginalPrice, parsedOfferPrice]
  );

  // KPI metrics
  const kpiStats = useMemo(() => {
    const activeCount = offers.filter((o) => getComputedOfferStatus(o) === 'active').length;
    const activeSales = offerSales.filter((s) => s.status === 'active');
    const totalSoldCount = activeSales.reduce((sum, s) => sum + (Number(s.quantity) || 0), 0);
    const totalSavings = activeSales.reduce((sum, s) => sum + (Number(s.totalSavings) || 0), 0);
    return {
      totalOffers: offers.length,
      activeCount,
      totalSoldCount,
      totalSavings: roundCurrency(totalSavings),
    };
  }, [offers, offerSales]);

  // Filtered offers list
  const filteredOffers = useMemo(() => {
    return offers.filter((offer) => {
      const computed = getComputedOfferStatus(offer);
      if (statusFilter !== 'all' && computed !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle =
          offer.nameAr.toLowerCase().includes(q) ||
          (offer.nameEn || '').toLowerCase().includes(q) ||
          (offer.description || '').toLowerCase().includes(q);
        const matchComp = offer.components.some((c) =>
          c.productNameAr.toLowerCase().includes(q)
        );
        if (!matchTitle && !matchComp) return false;
      }
      return true;
    });
  }, [offers, statusFilter, searchQuery]);

  // Filtered products inside modal picker
  const pickerProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    return products.filter((p) => {
      if (!q) return true;
      return (
        p.nameAr.toLowerCase().includes(q) ||
        p.nameEn.toLowerCase().includes(q) ||
        (p.sku || '').toLowerCase().includes(q)
      );
    });
  }, [products, productSearch]);

  const resetForm = () => {
    setEditingOfferId(null);
    setNameAr('');
    setNameEn('');
    setDescription('');
    setImageUrl('');
    setComponents([]);
    setUseCustomOriginalPrice(false);
    setCustomOriginalPriceInput('');
    setOfferPriceInput('');
    setStatus('active');
    setSortOrderInput(String(offers.length + 1));
    setStartDate('');
    setEndDate('');
    setValidDays([]);
    setStartTime('');
    setEndTime('');
    setMaxTotalRedemptionsInput('');
    setMaxPerOrderInput('');
    setProductSearch('');
    setFormError(null);
  };

  const openCreateModal = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const openEditModal = (offer: SpecialOffer) => {
    setEditingOfferId(offer.id);
    setNameAr(offer.nameAr);
    setNameEn(offer.nameEn || '');
    setDescription(offer.description || '');
    setImageUrl(offer.imageUrl || '');
    setComponents(offer.components.map((c) => ({ ...c })));
    setUseCustomOriginalPrice(Boolean(offer.useCustomOriginalPrice));
    setCustomOriginalPriceInput(
      offer.useCustomOriginalPrice ? String(offer.originalPrice) : ''
    );
    setOfferPriceInput(String(offer.offerPrice));
    setStatus(offer.status === 'expired' ? 'active' : offer.status);
    setSortOrderInput(String(offer.sortOrder ?? 1));
    setStartDate(offer.startDate || '');
    setEndDate(offer.endDate || '');
    setValidDays(offer.validDays ? [...offer.validDays] : []);
    setStartTime(offer.startTime || '');
    setEndTime(offer.endTime || '');
    setMaxTotalRedemptionsInput(
      offer.maxTotalRedemptions ? String(offer.maxTotalRedemptions) : ''
    );
    setMaxPerOrderInput(offer.maxPerOrder ? String(offer.maxPerOrder) : '');
    setProductSearch('');
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleAddProductComponent = (prod: Product) => {
    setFormError(null);
    setComponents((prev) => {
      const idx = prev.findIndex((c) => c.productId === prod.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = {
          ...next[idx],
          quantity: roundQty(next[idx].quantity + 1),
        };
        return next;
      }
      return [
        ...prev,
        {
          productId: prod.id,
          productNameAr: prod.nameAr,
          productNameEn: prod.nameEn,
          unitPrice: prod.price,
          costPrice: prod.costPrice,
          quantity: 1,
          stationId: prod.stationId || prod.kitchenStation,
        },
      ];
    });
  };

  const handleComponentQtyChange = (productId: string, nextQty: number) => {
    if (nextQty <= 0) {
      setComponents((prev) => prev.filter((c) => c.productId !== productId));
      return;
    }
    setComponents((prev) =>
      prev.map((c) =>
        c.productId === productId ? { ...c, quantity: roundQty(nextQty) } : c
      )
    );
  };

  const handleRemoveComponent = (productId: string) => {
    setComponents((prev) => prev.filter((c) => c.productId !== productId));
  };

  const handleApplyDiscountPercent = (pct: number) => {
    if (effectiveOriginalPrice <= 0) return;
    const discounted = roundCurrency(effectiveOriginalPrice * (1 - pct / 100));
    setOfferPriceInput(String(discounted));
    setFormError(null);
  };

  const handleToggleDay = (day: number) => {
    setValidDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const handleImageFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setImageUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveOffer = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!nameAr.trim()) {
      setFormError('يرجى إدخال اسم العرض باللغة العربية.');
      return;
    }
    if (components.length === 0) {
      setFormError('يجب إضافة صنف واحد على الأقل من قائمة الطعام داخل العرض.');
      return;
    }
    if (!livePricingCheck.valid) {
      setFormError(livePricingCheck.error || 'سعر العرض غير صالح.');
      return;
    }
    if (startDate && endDate && endDate < startDate) {
      setFormError('تاريخ انتهاء العرض لا يمكن أن يسبق تاريخ البداية.');
      return;
    }

    const res = posDb.saveOffer(
      {
        id: editingOfferId || undefined,
        nameAr: nameAr.trim(),
        nameEn: nameEn.trim() || undefined,
        description: description.trim() || undefined,
        imageUrl: imageUrl.trim() || undefined,
        components,
        useCustomOriginalPrice,
        originalPrice: useCustomOriginalPrice ? effectiveOriginalPrice : undefined,
        offerPrice: parsedOfferPrice,
        status,
        sortOrder: parseInt(sortOrderInput, 10) || offers.length + 1,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        validDays: validDays.length > 0 ? validDays : undefined,
        startTime: startTime || undefined,
        endTime: endTime || undefined,
        maxTotalRedemptions: maxTotalRedemptionsInput
          ? parseInt(maxTotalRedemptionsInput, 10) || undefined
          : undefined,
        maxPerOrder: maxPerOrderInput
          ? parseInt(maxPerOrderInput, 10) || undefined
          : undefined,
      },
      currentUser?.id || 'admin',
      currentUser?.name || 'المدير العام'
    );

    if (!res.success) {
      setFormError(res.error || 'تعذر حفظ العرض.');
      return;
    }

    showToast(
      editingOfferId
        ? `تم تحديث العرض "${res.offer?.nameAr}" بنجاح`
        : `تم إنشاء العرض "${res.offer?.nameAr}" وتفعيله في المنيو`,
      'success'
    );
    setIsModalOpen(false);
    resetForm();
  };

  const handleDuplicate = (offer: SpecialOffer) => {
    const copy = posDb.duplicateOffer(
      offer.id,
      currentUser?.id || 'admin',
      currentUser?.name || 'المدير العام'
    );
    if (copy) {
      showToast(`تم نسخ العرض "${offer.nameAr}" (متوقف مؤقتاً للمراجعة)`, 'info');
    }
  };

  const handleToggleStatus = (offer: SpecialOffer) => {
    const computed = getComputedOfferStatus(offer);
    const nextStatus: OfferStatus = computed === 'paused' ? 'active' : 'paused';
    const updated = posDb.toggleOfferStatus(
      offer.id,
      nextStatus,
      currentUser?.id || 'admin',
      currentUser?.name || 'المدير العام'
    );
    if (updated) {
      showToast(
        nextStatus === 'active'
          ? `تم تفعيل العرض "${offer.nameAr}" في شاشة الكاشير`
          : `تم إيقاف العرض "${offer.nameAr}" مؤقتاً`,
        nextStatus === 'active' ? 'success' : 'info'
      );
    }
  };

  const handleMoveOrder = (offerId: string, direction: -1 | 1) => {
    const orderedIds = offers.map((o) => o.id);
    const idx = orderedIds.indexOf(offerId);
    const targetIdx = idx + direction;
    if (idx < 0 || targetIdx < 0 || targetIdx >= orderedIds.length) return;
    [orderedIds[idx], orderedIds[targetIdx]] = [orderedIds[targetIdx], orderedIds[idx]];
    posDb.reorderOffers(orderedIds);
  };

  const handleConfirmDelete = () => {
    if (!deleteTarget) return;
    posDb.deleteOffer(
      deleteTarget.id,
      currentUser?.id || 'admin',
      currentUser?.name || 'المدير العام'
    );
    showToast(`تم حذف العرض "${deleteTarget.nameAr}" نهائياً`, 'info');
    setDeleteTarget(null);
  };

  const renderStatusBadge = (offer: SpecialOffer) => {
    const computed = getComputedOfferStatus(offer);
    if (computed === 'active') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-extrabold bg-emerald-100 text-emerald-900 border border-emerald-200">
          <CheckCircle2 className="w-3 h-3 text-emerald-700" />
          <span>نشط</span>
        </span>
      );
    }
    if (computed === 'paused') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-extrabold bg-amber-100 text-amber-900 border border-amber-200">
          <PauseCircle className="w-3 h-3 text-amber-700" />
          <span>متوقف مؤقتاً</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-extrabold bg-rose-100 text-rose-900 border border-rose-200">
        <Clock className="w-3 h-3 text-rose-700" />
        <span>منتهي</span>
      </span>
    );
  };

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-4rem)] overflow-hidden bg-[#F7F4EE]">
      {/* Header & Controls */}
      <div className="p-4 sm:p-5 bg-white border-b border-[#E8DFD5] space-y-4 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-[#140E0B] border border-[#C59A3F]/60 text-[#C59A3F] flex items-center justify-center shadow-sm">
              <Flame className="w-6 h-6 text-[#E11D48]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-black text-[#140E0B]">
                  إدارة قسم العروض الخاصة (🔥 العروض)
                </h1>
                <span className="px-2 py-0.5 rounded-md bg-[#FFF8EF] border border-[#C59A3F]/50 text-[#8B1E1E] text-[11px] font-extrabold">
                  اول قسم في المنيو
                </span>
              </div>
              <p className="text-xs text-[#7A6455]">
                تجميع أصناف المنيو في باقات وعروض ترويجية بخصم مباشر، مع تقسيم تلقائي للمطبخ وخصم دقيق من المخزون
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={openCreateModal}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-l from-[#8B1E1E] to-[#691313] hover:from-[#731717] hover:to-[#530E0E] text-white text-xs font-black shadow-sm transition-all active:scale-95 cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-4 h-4 text-[#FCD34D]" />
            <span>إنشاء عرض جديد</span>
          </button>
        </div>

        {/* Compact KPI Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="p-3 rounded-xl bg-[#FBF9F6] border border-[#E5DACB]">
            <span className="text-[11px] font-semibold text-[#7A6455]">إجمالي العروض المسجلة</span>
            <div className="text-xl font-black text-[#140E0B] font-num mt-0.5">
              {kpiStats.totalOffers} <span className="text-xs font-bold text-[#7A6455]">عرض</span>
            </div>
          </div>
          <div className="p-3 rounded-xl bg-emerald-50/60 border border-emerald-200">
            <span className="text-[11px] font-semibold text-emerald-800">العروض النشطة في المنيو</span>
            <div className="text-xl font-black text-emerald-700 font-num mt-0.5">
              {kpiStats.activeCount} <span className="text-xs font-bold">نشط</span>
            </div>
          </div>
          <div className="p-3 rounded-xl bg-[#FFF8EF] border border-[#C59A3F]/40">
            <span className="text-[11px] font-semibold text-[#8B651B]">إجمالي مرات بيع العروض</span>
            <div className="text-xl font-black text-[#8B1E1E] font-num mt-0.5">
              {kpiStats.totalSoldCount} <span className="text-xs font-bold">مرة</span>
            </div>
          </div>
          <div className="p-3 rounded-xl bg-[#140E0B] border border-[#C59A3F]/40 text-white">
            <span className="text-[11px] font-semibold text-[#C59A3F]">إجمالي توفير العملاء</span>
            <div className="text-xl font-black text-white font-num mt-0.5">
              {kpiStats.totalSavings.toLocaleString('ar-EG', { minimumFractionDigits: 2 })}{' '}
              <span className="text-xs font-bold text-[#C59A3F]">{profile.currency}</span>
            </div>
          </div>
        </div>

        {/* Search & Status Filters */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="w-4 h-4 absolute right-3 top-2.5 text-[#7A6455]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ابحث باسم العرض أو أحد مكوناته..."
              className="w-full pr-9 pl-3 py-2 text-xs font-semibold rounded-xl border border-[#D7C3A5] bg-[#FBF9F6] focus:outline-none focus:ring-2 focus:ring-[#8B1E1E]"
            />
          </div>

          <div className="flex items-center gap-1 bg-[#F5EFE6] p-1 rounded-xl border border-[#E8DFD5] text-xs">
            {(
              [
                { id: 'all', label: 'الكل' },
                { id: 'active', label: 'النشطة' },
                { id: 'paused', label: 'المتوقفة' },
                { id: 'expired', label: 'المنتهية' },
              ] as { id: StatusFilter; label: string }[]
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3 py-1.5 rounded-lg font-bold transition-colors whitespace-nowrap cursor-pointer ${
                  statusFilter === tab.id
                    ? 'bg-[#8B1E1E] text-white shadow-2xs'
                    : 'text-[#3E2723] hover:bg-[#EAE0D2]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Offers Grid / List */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-5">
        {filteredOffers.length === 0 ? (
          <div className="max-w-lg mx-auto my-12 bg-white p-8 rounded-2xl border border-[#E5DACB] text-center space-y-4 shadow-xs">
            <div className="w-16 h-16 rounded-2xl bg-[#140E0B] border border-[#C59A3F]/50 flex items-center justify-center mx-auto">
              <Flame className="w-8 h-8 text-[#C59A3F]" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-black text-[#140E0B]">
                {offers.length === 0
                  ? 'لا توجد عروض ترويجية مسجلة حالياً'
                  : 'لا توجد عروض مطابقة لمعايير البحث'}
              </h3>
              <p className="text-xs text-[#7A6455] leading-relaxed">
                {offers.length === 0
                  ? 'أنشئ أول عرض منيو الآن (مثلاً: عرض اللمة أو وجبة السعادة) ليظهر في مقدمة شاشة الكاشير ضمن قسم 🔥 العروض.'
                  : 'جرّب تغيير فلتر الحالة أو كلمة البحث لعرض النتائج.'}
              </p>
            </div>
            {offers.length === 0 && (
              <button
                type="button"
                onClick={openCreateModal}
                className="px-5 py-2.5 rounded-xl bg-[#8B1E1E] hover:bg-[#721616] text-white text-xs font-black inline-flex items-center gap-2 cursor-pointer shadow-sm"
              >
                <Plus className="w-4 h-4 text-[#FCD34D]" />
                <span>إنشاء أول عرض خاص</span>
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {filteredOffers.map((offer, idx) => {
              const computed = getComputedOfferStatus(offer);
              const isFirst = idx === 0;
              const isLast = idx === filteredOffers.length - 1;

              return (
                <div
                  key={offer.id}
                  className="bg-white rounded-2xl border border-[#E5DACB] hover:border-[#C59A3F] shadow-2xs overflow-hidden flex flex-col sm:flex-row transition-all"
                >
                  {/* Visual Preview Column */}
                  <div className="sm:w-44 h-40 sm:h-auto bg-[#140E0B] relative shrink-0 flex items-center justify-center overflow-hidden">
                    {offer.imageUrl ? (
                      <img
                        src={offer.imageUrl}
                        alt={offer.nameAr}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-[#140E0B] via-[#3A1111] to-[#8B1E1E] flex flex-col items-center justify-center p-3 text-center">
                        <Flame className="w-9 h-9 text-[#C59A3F] mb-1" />
                        <span className="text-[11px] font-black text-amber-200 tracking-wide">
                          عرض الباشا
                        </span>
                      </div>
                    )}
                    <div className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-md bg-[#8B1E1E] text-white text-[11px] font-black font-num border border-[#C59A3F]/60 shadow-sm">
                      خصم {offer.savingsPercent}%
                    </div>
                  </div>

                  {/* Details & Controls Column */}
                  <div className="flex-1 p-4 flex flex-col justify-between gap-3 min-w-0">
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-sm font-black text-[#140E0B] truncate">
                              {offer.nameAr}
                            </h3>
                            {renderStatusBadge(offer)}
                          </div>
                          {offer.description && (
                            <p className="text-xs text-[#7A6455] mt-0.5 line-clamp-2">
                              {offer.description}
                            </p>
                          )}
                        </div>

                        {/* Sort Order Controls */}
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleMoveOrder(offer.id, -1)}
                            disabled={isFirst}
                            title="تقديم الترتيب للأعلى"
                            className="p-1 rounded-lg border border-[#E5DACB] bg-[#FBF9F6] text-[#5C4033] hover:bg-[#EFE6D8] disabled:opacity-35 cursor-pointer"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMoveOrder(offer.id, 1)}
                            disabled={isLast}
                            title="تأخير الترتيب للأسفل"
                            className="p-1 rounded-lg border border-[#E5DACB] bg-[#FBF9F6] text-[#5C4033] hover:bg-[#EFE6D8] disabled:opacity-35 cursor-pointer"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Linked Products Chips */}
                      <div className="flex flex-wrap gap-1.5">
                        {offer.components.map((comp) => (
                          <span
                            key={comp.productId}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#F7F4EE] border border-[#E5DACB] text-[11px] font-bold text-[#3E2723]"
                          >
                            <span>{comp.productNameAr}</span>
                            <span className="text-[#8B1E1E] font-num">×{comp.quantity}</span>
                          </span>
                        ))}
                      </div>

                      {/* Pricing & Limits Metadata */}
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[#F0E8DD]">
                        <div className="flex items-baseline gap-2">
                          <span className="text-base font-black text-[#8B1E1E] font-num">
                            {offer.offerPrice.toFixed(2)} {profile.currency}
                          </span>
                          <span className="text-xs text-gray-400 line-through font-num">
                            {offer.originalPrice.toFixed(2)}
                          </span>
                          <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 font-num">
                            وفر {offer.savingsAmount.toFixed(2)} {profile.currency}
                          </span>
                        </div>

                        <div className="text-[11px] text-[#7A6455] font-semibold font-num flex items-center gap-2">
                          <span>
                            مرات الاستخدام: <strong className="text-[#140E0B]">{offer.currentRedemptions || 0}</strong>
                            {offer.maxTotalRedemptions ? ` / ${offer.maxTotalRedemptions}` : ''}
                          </span>
                          {offer.maxPerOrder && (
                            <span>• حد الطلب: {offer.maxPerOrder}</span>
                          )}
                        </div>
                      </div>

                      {(offer.startDate || offer.endDate || offer.startTime || offer.endTime) && (
                        <div className="text-[11px] text-[#6F4E37] flex items-center gap-2 flex-wrap">
                          <Calendar className="w-3.5 h-3.5 text-[#C59A3F]" />
                          {(offer.startDate || offer.endDate) && (
                            <span>
                              الفترة: {offer.startDate || 'مفتوح'} ← {offer.endDate || 'مفتوح'}
                            </span>
                          )}
                          {(offer.startTime || offer.endTime) && (
                            <span>
                              • الساعة: {offer.startTime || '00:00'} - {offer.endTime || '23:59'}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Footer Actions */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#F0E8DD]">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openEditModal(offer)}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#FFF8EF] hover:bg-[#F5E8D3] border border-[#D7C3A5] text-[#231610] text-xs font-bold cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5 text-[#8B1E1E]" />
                          <span>تعديل</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDuplicate(offer)}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white hover:bg-[#F7F4EE] border border-[#E5DACB] text-[#5C4033] text-xs font-bold cursor-pointer"
                          title="نسخ العرض"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span>نسخ</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleToggleStatus(offer)}
                          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-bold cursor-pointer ${
                            computed === 'paused'
                              ? 'bg-emerald-50 hover:bg-emerald-100 border-emerald-200 text-emerald-800'
                              : 'bg-amber-50 hover:bg-amber-100 border-amber-200 text-amber-900'
                          }`}
                        >
                          {computed === 'paused' ? (
                            <>
                              <PlayCircle className="w-3.5 h-3.5" />
                              <span>تفعيل</span>
                            </>
                          ) : (
                            <>
                              <PauseCircle className="w-3.5 h-3.5" />
                              <span>إيقاف مؤقت</span>
                            </>
                          )}
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => setDeleteTarget(offer)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-xs font-bold cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>حذف</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create / Edit Offer Modal */}
      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
          dir="rtl"
          onClick={() => setIsModalOpen(false)}
        >
          <div
            className="bg-white rounded-2xl max-w-5xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-[#D7C3A5] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-5 py-4 bg-[#140E0B] text-white flex items-center justify-between border-b border-[#C59A3F]/40 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#8B1E1E] flex items-center justify-center border border-[#C59A3F]/50">
                  <Flame className="w-5 h-5 text-[#FCD34D]" />
                </div>
                <div>
                  <h2 className="text-sm font-black">
                    {editingOfferId ? 'تعديل بيانات ومحتويات العرض' : 'إنشاء عرض خاص جديد (🔥 العروض)'}
                  </h2>
                  <p className="text-[11px] text-amber-200/80">
                    ربط أصناف منيو الباشا في باقة واحدة مع تسعير مرن ومزامنة آلية للمطبخ والمخزون
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Form Body */}
            <form onSubmit={handleSaveOffer} className="flex-1 overflow-y-auto p-5 space-y-5 bg-[#FAF8F4]">
              {formError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-300 text-rose-800 text-xs font-bold flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Section 1: Basic Info & Image */}
              <div className="bg-white p-4 rounded-2xl border border-[#E5DACB] space-y-4">
                <h3 className="text-xs font-black text-[#8B1E1E] flex items-center gap-1.5">
                  <Tag className="w-4 h-4" />
                  <span>1. البيانات الأساسية وصورة العرض</span>
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-[#3E2723] mb-1">
                        اسم العرض (عربي) *
                      </label>
                      <input
                        type="text"
                        value={nameAr}
                        onChange={(e) => setNameAr(e.target.value)}
                        placeholder="مثال: عرض اللمة الملكي"
                        className="w-full px-3 py-2 text-xs font-bold rounded-xl border border-[#D7C3A5] focus:outline-none focus:ring-2 focus:ring-[#8B1E1E]"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-[#3E2723] mb-1">
                        الاسم الإنجليزي (اختياري)
                      </label>
                      <input
                        type="text"
                        value={nameEn}
                        onChange={(e) => setNameEn(e.target.value)}
                        placeholder="Royal Gathering Offer"
                        className="w-full px-3 py-2 text-xs font-semibold rounded-xl border border-[#D7C3A5] focus:outline-none focus:ring-2 focus:ring-[#8B1E1E]"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-bold text-[#3E2723] mb-1">
                        وصف مختصر لمحتويات العرض
                      </label>
                      <input
                        type="text"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="مثال: وجبة عائلية متكاملة تكفي 4 أفراد شاملة المشويات والبيتزا والسلطات"
                        className="w-full px-3 py-2 text-xs font-semibold rounded-xl border border-[#D7C3A5] focus:outline-none focus:ring-2 focus:ring-[#8B1E1E]"
                      />
                    </div>
                  </div>

                  {/* Image URL + Upload Preview */}
                  <div className="space-y-2">
                    <label className="block text-[11px] font-bold text-[#3E2723]">
                      صورة العرض (رابط أو رفع ملف)
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={imageUrl}
                        onChange={(e) => setImageUrl(e.target.value)}
                        placeholder="رابط الصورة أو اختر ملف..."
                        className="flex-1 min-w-0 px-2.5 py-2 text-[11px] rounded-xl border border-[#D7C3A5] focus:outline-none"
                      />
                      <label className="px-2.5 py-2 rounded-xl bg-[#FFF8EF] border border-[#D7C3A5] text-[#8B1E1E] text-[11px] font-bold hover:bg-[#F5EFE6] cursor-pointer flex items-center gap-1 shrink-0">
                        <Upload className="w-3.5 h-3.5" />
                        <span>رفع</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleImageFileUpload}
                          className="hidden"
                        />
                      </label>
                    </div>
                    <div className="h-20 rounded-xl bg-[#F7F4EE] border border-dashed border-[#D7C3A5] flex items-center justify-center overflow-hidden relative">
                      {imageUrl ? (
                        <>
                          <img
                            src={imageUrl}
                            alt="معاينة"
                            className="w-full h-full object-cover"
                          />
                          <button
                            type="button"
                            onClick={() => setImageUrl('')}
                            className="absolute top-1 left-1 p-1 rounded-md bg-black/60 text-white hover:bg-black cursor-pointer"
                            title="إزالة الصورة"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </>
                      ) : (
                        <div className="text-[11px] text-[#8C7665] flex items-center gap-1.5">
                          <ImageIcon className="w-4 h-4" />
                          <span>بدون صورة (يظهر شعار العرض)</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 2: Multi-Item Product Composition */}
              <div className="bg-white p-4 rounded-2xl border border-[#E5DACB] space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs font-black text-[#8B1E1E] flex items-center gap-1.5">
                    <PackagePlus className="w-4 h-4" />
                    <span>2. تكوين العرض من أصناف المنيو الحالية (بدون تكرار للمنتجات)</span>
                  </h3>
                  <span className="text-[11px] font-bold text-[#7A6455] font-num">
                    تم اختيار {components.length} أصناف
                  </span>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Left: Existing Product Picker */}
                  <div className="border border-[#E5DACB] rounded-xl p-3 bg-[#FBF9F6] space-y-2.5 flex flex-col">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 absolute right-3 top-2.5 text-[#7A6455]" />
                      <input
                        type="text"
                        value={productSearch}
                        onChange={(e) => setProductSearch(e.target.value)}
                        placeholder="ابحث عن صنف لإضافته للعرض (بيتزا، كريب، كفتة...)..."
                        className="w-full pr-8 pl-3 py-1.5 text-xs rounded-lg border border-[#D7C3A5] bg-white focus:outline-none focus:ring-1 focus:ring-[#8B1E1E]"
                      />
                    </div>

                    <div className="max-h-56 overflow-y-auto space-y-1.5 pr-0.5">
                      {pickerProducts.map((prod) => {
                        const existingComp = components.find((c) => c.productId === prod.id);
                        return (
                          <button
                            key={prod.id}
                            type="button"
                            onClick={() => handleAddProductComponent(prod)}
                            className={`w-full flex items-center justify-between gap-2 p-2 rounded-lg border text-right transition-colors cursor-pointer ${
                              existingComp
                                ? 'bg-[#FFF8EF] border-[#C59A3F] text-[#140E0B]'
                                : 'bg-white border-[#E5DACB] hover:border-[#8B1E1E]/50'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-[#231610] truncate">
                                {prod.nameAr}
                              </div>
                              <div className="text-[10px] text-[#7A6455] font-num">
                                {prod.price.toFixed(2)} {profile.currency}
                              </div>
                            </div>
                            <span className="px-2 py-1 rounded-md bg-[#8B1E1E] text-white text-[10px] font-bold shrink-0 flex items-center gap-1">
                              <Plus className="w-3 h-3" />
                              <span>{existingComp ? `مضاف (${existingComp.quantity})` : 'إضافة'}</span>
                            </span>
                          </button>
                        );
                      })}
                      {pickerProducts.length === 0 && (
                        <div className="text-center py-8 text-xs text-[#7A6455]">
                          لا توجد أصناف متاحة مطابقة للبحث
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right: Selected Offer Components List */}
                  <div className="border border-[#E5DACB] rounded-xl p-3 bg-white space-y-2.5 flex flex-col">
                    <div className="text-xs font-extrabold text-[#231610] flex items-center justify-between">
                      <span>الأصناف المضمنة داخل العرض:</span>
                      <span className="font-num text-[#8B1E1E]">
                        إجمالي السعر الفردي: {calculatedOriginalPrice.toFixed(2)} {profile.currency}
                      </span>
                    </div>

                    {components.length === 0 ? (
                      <div className="flex-1 flex flex-col items-center justify-center py-8 text-center text-xs text-[#8C7665]">
                        <PackagePlus className="w-8 h-8 text-[#D7C3A5] mb-1.5" />
                        <span>اختر الأصناف من القائمة المجاورة وحدد الكمية لكل صنف</span>
                      </div>
                    ) : (
                      <div className="max-h-56 overflow-y-auto space-y-2 pr-0.5">
                        {components.map((comp) => {
                          const liveProd = productsMap.get(comp.productId);
                          const unitP = liveProd ? liveProd.price : comp.unitPrice;
                          return (
                            <div
                              key={comp.productId}
                              className="p-2.5 rounded-xl bg-[#FBF9F6] border border-[#E5DACB] flex items-center justify-between gap-2"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-bold text-[#140E0B] truncate">
                                  {comp.productNameAr}
                                </div>
                                <div className="text-[10px] text-[#7A6455] font-num">
                                  سعر الوحدة: {unitP.toFixed(2)} • الإجمالي:{' '}
                                  <strong className="text-[#8B1E1E]">
                                    {(unitP * comp.quantity).toFixed(2)} {profile.currency}
                                  </strong>
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleComponentQtyChange(comp.productId, comp.quantity - 1)
                                  }
                                  className="w-6 h-6 rounded-md bg-white border border-[#D7C3A5] flex items-center justify-center text-[#8B1E1E] hover:bg-[#EFE6D8] cursor-pointer"
                                >
                                  <Minus className="w-3 h-3" />
                                </button>
                                <input
                                  type="number"
                                  min="0.25"
                                  step="any"
                                  value={comp.quantity}
                                  onChange={(e) =>
                                    handleComponentQtyChange(
                                      comp.productId,
                                      parseFloat(e.target.value) || 0
                                    )
                                  }
                                  className="w-14 px-1.5 py-1 text-center text-xs font-black font-num rounded-md border border-[#D7C3A5] bg-white"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleComponentQtyChange(comp.productId, comp.quantity + 1)
                                  }
                                  className="w-6 h-6 rounded-md bg-white border border-[#D7C3A5] flex items-center justify-center text-[#8B1E1E] hover:bg-[#EFE6D8] cursor-pointer"
                                >
                                  <Plus className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveComponent(comp.productId)}
                                  className="p-1 text-gray-400 hover:text-rose-600 cursor-pointer"
                                  title="إزالة من العرض"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Section 3: Flexible Pricing Engine */}
              <div className="bg-white p-4 rounded-2xl border border-[#E5DACB] space-y-4">
                <h3 className="text-xs font-black text-[#8B1E1E] flex items-center gap-1.5">
                  <Percent className="w-4 h-4" />
                  <span>3. تسعير العرض والخصم</span>
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
                  {/* Original Price */}
                  <div className="p-3 rounded-xl bg-[#FBF9F6] border border-[#E5DACB] space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-[#3E2723]">السعر الأصلي قبل العرض</span>
                      <label className="flex items-center gap-1 text-[10px] font-bold text-[#8B1E1E] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={useCustomOriginalPrice}
                          onChange={(e) => {
                            setUseCustomOriginalPrice(e.target.checked);
                            if (e.target.checked && !customOriginalPriceInput) {
                              setCustomOriginalPriceInput(String(calculatedOriginalPrice));
                            }
                          }}
                        />
                        <span>تعديل يدوي</span>
                      </label>
                    </div>
                    {useCustomOriginalPrice ? (
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={customOriginalPriceInput}
                        onChange={(e) => setCustomOriginalPriceInput(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-black font-num rounded-xl border border-[#D7C3A5] bg-white"
                      />
                    ) : (
                      <div className="text-lg font-black text-[#231610] font-num">
                        {calculatedOriginalPrice.toFixed(2)} {profile.currency}
                      </div>
                    )}
                    <span className="text-[10px] text-[#7A6455] block">
                      محسوب تلقائياً من مجموع أسعار الأصناف × كمياتها
                    </span>
                  </div>

                  {/* Final Offer Price */}
                  <div className="p-3 rounded-xl bg-[#FFF8EF] border border-[#C59A3F] space-y-2">
                    <label className="block text-[11px] font-black text-[#8B1E1E]">
                      سعر بيع العرض النهائي ({profile.currency}) *
                    </label>
                    <input
                      type="number"
                      min="1"
                      step="0.5"
                      value={offerPriceInput}
                      onChange={(e) => {
                        setOfferPriceInput(e.target.value);
                        setFormError(null);
                      }}
                      placeholder="أدخل سعر العرض..."
                      className="w-full px-3 py-2 text-base font-black font-num rounded-xl border border-[#8B1E1E] bg-white focus:outline-none"
                    />
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {[10, 15, 20, 25, 30].map((pct) => (
                        <button
                          key={pct}
                          type="button"
                          onClick={() => handleApplyDiscountPercent(pct)}
                          disabled={effectiveOriginalPrice <= 0}
                          className="px-2 py-0.5 rounded-md bg-white border border-[#D7C3A5] text-[10px] font-bold text-[#8B1E1E] hover:bg-[#8B1E1E] hover:text-white disabled:opacity-40 cursor-pointer"
                        >
                          -{pct}%
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Live Savings Readout */}
                  <div className="p-3 rounded-xl bg-[#140E0B] text-white border border-[#C59A3F]/50 space-y-1.5">
                    <span className="text-[11px] font-bold text-[#C59A3F] flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>صافي التوفير للعميل</span>
                    </span>
                    <div className="text-lg font-black font-num text-emerald-300">
                      {liveSavings.savingsAmount.toFixed(2)} {profile.currency}
                    </div>
                    <div className="text-xs font-bold text-amber-200 font-num">
                      نسبة الخصم الفعلية: {liveSavings.savingsPercent}%
                    </div>
                    {!livePricingCheck.valid && offerPriceInput !== '' && (
                      <div className="text-[11px] text-rose-300 font-bold pt-1">
                        {livePricingCheck.error}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Section 4: Schedule, Status & Usage Limits */}
              <div className="bg-white p-4 rounded-2xl border border-[#E5DACB] space-y-4">
                <h3 className="text-xs font-black text-[#8B1E1E] flex items-center gap-1.5">
                  <Calendar className="w-4 h-4" />
                  <span>4. الصلاحية والجدولة وحدود الاستخدام (اختياري)</span>
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-[#3E2723] mb-1">
                      الحالة
                    </label>
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value as OfferStatus)}
                      className="w-full px-3 py-2 text-xs font-bold rounded-xl border border-[#D7C3A5] bg-white"
                    >
                      <option value="active">نشط (يظهر في نقطة البيع)</option>
                      <option value="paused">متوقف مؤقتاً</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-[#3E2723] mb-1">
                      ترتيب الظهور في القائمة
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={sortOrderInput}
                      onChange={(e) => setSortOrderInput(e.target.value)}
                      className="w-full px-3 py-2 text-xs font-bold font-num rounded-xl border border-[#D7C3A5]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-[#3E2723] mb-1">
                      تاريخ البداية
                    </label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full px-3 py-2 text-xs font-semibold rounded-xl border border-[#D7C3A5]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-[#3E2723] mb-1">
                      تاريخ الانتهاء
                    </label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full px-3 py-2 text-xs font-semibold rounded-xl border border-[#D7C3A5]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-[#3E2723] mb-1">
                      من الساعة
                    </label>
                    <input
                      type="time"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      className="w-full px-3 py-2 text-xs font-semibold rounded-xl border border-[#D7C3A5]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-[#3E2723] mb-1">
                      إلى الساعة
                    </label>
                    <input
                      type="time"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      className="w-full px-3 py-2 text-xs font-semibold rounded-xl border border-[#D7C3A5]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-[#3E2723] mb-1">
                      الحد الأقصى الكلي للمبيعات
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={maxTotalRedemptionsInput}
                      onChange={(e) => setMaxTotalRedemptionsInput(e.target.value)}
                      placeholder="بدون حد"
                      className="w-full px-3 py-2 text-xs font-bold font-num rounded-xl border border-[#D7C3A5]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-[#3E2723] mb-1">
                      الحد الأقصى في الطلب الواحد
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={maxPerOrderInput}
                      onChange={(e) => setMaxPerOrderInput(e.target.value)}
                      placeholder="بدون حد"
                      className="w-full px-3 py-2 text-xs font-bold font-num rounded-xl border border-[#D7C3A5]"
                    />
                  </div>
                </div>

                {/* Days of week */}
                <div>
                  <span className="block text-[11px] font-bold text-[#3E2723] mb-1.5">
                    أيام التفعيل في الأسبوع (اتركها فارغة للتفعيل كل أيام الأسبوع):
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {WEEKDAYS_AR.map((d) => {
                      const active = validDays.includes(d.day);
                      return (
                        <button
                          key={d.day}
                          type="button"
                          onClick={() => handleToggleDay(d.day)}
                          className={`px-3 py-1 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                            active
                              ? 'bg-[#8B1E1E] text-white border-[#8B1E1E]'
                              : 'bg-[#FBF9F6] text-[#3E2723] border-[#D7C3A5] hover:bg-[#EFE6D8]'
                          }`}
                        >
                          {d.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Footer Submit */}
              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl bg-white border border-[#D7C3A5] text-xs font-bold text-[#3E2723] hover:bg-[#F5EFE6] cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#8B1E1E] hover:bg-[#721616] text-white text-xs font-black shadow-sm cursor-pointer"
                >
                  <Check className="w-4 h-4 text-[#FCD34D]" />
                  <span>{editingOfferId ? 'حفظ التعديلات' : 'حفظ ونشر العرض'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={deleteTarget !== null}
        title="حذف العرض الترويجي"
        message="سيتم حذف هذا العرض نهائياً من قائمة العروض دون التأثير على الأصناف الفردية أو الطلبات السابقة."
        itemName={deleteTarget?.nameAr}
        confirmText="حذف العرض"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};
