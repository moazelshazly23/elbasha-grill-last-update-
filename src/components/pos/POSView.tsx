import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  Flame,
  Crown,
  UtensilsCrossed,
  Soup,
  Salad,
  Coffee,
  Sparkles,
  Plus,
  Minus,
  Trash2,
  Tag,
  MessageSquare,
  Users,
  Grid,
  CheckCircle2,
  Clock,
  Bike,
  ShoppingBag,
  RotateCcw,
  Percent,
  PauseCircle,
  Ban,
  DollarSign,
  Keyboard,
  Package,
  GripVertical,
  SlidersHorizontal,
  ChefHat,
} from 'lucide-react';
import { usePOS } from '../../context/POSContext';
import { useBrand } from '../../context/BrandContext';
import { posDb } from '../../services/db';
import { Product, Category, OrderType, SelectedModifier, SpecialOffer } from '../../types';
import { formatOfferComponentsSummary } from '../../services/specialOffersService';
import { roundQty } from '../../utils/currency';
import { ModifierModal } from './ModifierModal';
import { PaymentModal } from './PaymentModal';
import { TablePickerModal } from './TablePickerModal';
import { QuickCustomerModal } from './QuickCustomerModal';
import { HeldOrdersModal } from './HeldOrdersModal';
import { ShortcutsModal } from './ShortcutsModal';
import { QuickAddItemModal } from './QuickAddItemModal';
import { POSCustomerSearch } from './POSCustomerSearch';

interface POSViewProps {
  onNavigateToKitchen?: () => void;
}

export const POSView: React.FC<POSViewProps> = ({ onNavigateToKitchen }) => {
  const { profile } = useBrand();
  const {
    cartItems,
    orderType,
    setOrderType,
    selectedTable,
    setSelectedTable,
    selectedCustomer,
    setSelectedCustomer,
    deliveryFee,
    setDeliveryFee,
    discountMode,
    discountPercent,
    discountFixed,
    setDiscount,
    orderNotes,
    setOrderNotes,
    addToCart,
    addOfferToCart,
    updateQuantity,
    removeItem,
    clearCart,
    cancelCart,
    subtotal,
    discountAmount,
    taxAmount,
    serviceChargeAmount,
    total,
    isSubmittingCheckout,
    processCheckout,
    heldOrders,
    isHeldOrdersModalOpen,
    setIsHeldOrdersModalOpen,
    holdCurrentOrder,
    resumeHeldOrder,
    deleteHeldOrder,
    clearAllHeldOrders,
    openCashDrawer,
    showToast,
  } = usePOS();

  const [categories, setCategories] = useState<Category[]>(() => posDb.getCategories());
  const [products, setProducts] = useState<Product[]>(() => posDb.getProducts());
  const [availableOffers, setAvailableOffers] = useState<SpecialOffer[]>(() =>
    posDb.getActiveAvailableOffers()
  );
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [onlyPopular, setOnlyPopular] = useState<boolean>(false);

  // Modals state
  const [activeProductForModifier, setActiveProductForModifier] = useState<Product | null>(null);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isTableModalOpen, setIsTableModalOpen] = useState(false);
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
  const [isDiscountModalOpen, setIsDiscountModalOpen] = useState(false);
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState(false);
  const [isQuickAddModalOpen, setIsQuickAddModalOpen] = useState(false);
  const customerSearchInputRef = useRef<HTMLInputElement>(null);

  // Adjustable POS Invoice / Cart panel width (persisted in localStorage)
  const CART_WIDTH_KEY = 'basha_pos_cart_width_v2_px';
  const DEFAULT_CART_WIDTH = 330;
  const MIN_CART_WIDTH = 280;
  const MAX_CART_WIDTH = 680;

  const clampCartWidth = (w: number) =>
    Math.max(MIN_CART_WIDTH, Math.min(MAX_CART_WIDTH, Math.round(w)));

  const [cartWidthPx, setCartWidthPx] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(CART_WIDTH_KEY));
      if (Number.isFinite(saved) && saved >= MIN_CART_WIDTH) {
        return clampCartWidth(saved);
      }
    } catch {
      // ignore storage errors
    }
    return DEFAULT_CART_WIDTH;
  });

  const [isDesktopLg, setIsDesktopLg] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  );
  const [isResizingCart, setIsResizingCart] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = () => setIsDesktopLg(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(CART_WIDTH_KEY, String(cartWidthPx));
    } catch {
      // ignore storage errors
    }
  }, [cartWidthPx]);

  const startCartResize = (startClientX: number) => {
    const initialWidth = cartWidthPx;
    const isRtl =
      typeof document !== 'undefined' &&
      getComputedStyle(document.documentElement).direction !== 'ltr';
    const sign = isRtl ? 1 : -1;

    setIsResizingCart(true);
    if (typeof document !== 'undefined') {
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    const handleMove = (clientX: number) => {
      // In RTL, #pos-invoice-panel sits on the left edge, so dragging right increases its width
      const delta = (clientX - startClientX) * sign;
      setCartWidthPx(clampCartWidth(initialWidth + delta));
    };

    const onMouseMove = (ev: MouseEvent) => handleMove(ev.clientX);
    const onTouchMove = (ev: TouchEvent) => {
      if (ev.touches[0]) handleMove(ev.touches[0].clientX);
    };
    const stopResize = () => {
      setIsResizingCart(false);
      if (typeof document !== 'undefined') {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', stopResize);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', stopResize);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', stopResize);
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', stopResize);
  };

  useEffect(() => {
    setCategories(posDb.getCategories());
    setProducts(posDb.getProducts());
    setAvailableOffers(posDb.getActiveAvailableOffers());

    const unsubscribe = posDb.subscribe(() => {
      setCategories(posDb.getCategories());
      setProducts(posDb.getProducts());
      setAvailableOffers(posDb.getActiveAvailableOffers());
    });
    return unsubscribe;
  }, []);

  // Keyboard Shortcuts for Cashier Acceleration (F3: Customer Search, F5: Hold, ESC: Cancel, F9: Drawer, F10: Checkout, F1: Help)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // F3: التركيز السريع على حقل البحث عن العميل
      if (e.key === 'F3') {
        e.preventDefault();
        customerSearchInputRef.current?.focus();
        return;
      }

      // F5: تعليق الطلب (Hold Order)
      if (e.key === 'F5') {
        e.preventDefault();
        holdCurrentOrder();
        return;
      }

      // F6: إضافة صنف سريع مخصص (Quick Add)
      if (e.key === 'F6') {
        e.preventDefault();
        setIsQuickAddModalOpen((prev) => !prev);
        return;
      }

      // F9: فتح صندوق النقدية (Open Cash Drawer)
      if (e.key === 'F9') {
        e.preventDefault();
        openCashDrawer();
        return;
      }

      // F1: دليل اختصارات لوحة المفاتيح
      if (e.key === 'F1') {
        e.preventDefault();
        setIsShortcutsModalOpen((prev) => !prev);
        return;
      }

      // F10: إنهاء الطلب والدفع
      if (e.key === 'F10') {
        e.preventDefault();
        if (cartItems.length > 0) {
          setIsPaymentModalOpen(true);
        } else {
          showToast('السلة فارغة، أضف أصناف أولاً لإتمام الدفع', 'info');
        }
        return;
      }

      // Escape (ESC): إلغاء الطلب أو إغلاق النوافذ النشطة
      if (e.key === 'Escape') {
        if (isQuickAddModalOpen) {
          setIsQuickAddModalOpen(false);
          return;
        }
        if (isShortcutsModalOpen) {
          setIsShortcutsModalOpen(false);
          return;
        }
        if (isHeldOrdersModalOpen) {
          setIsHeldOrdersModalOpen(false);
          return;
        }
        if (isDiscountModalOpen) {
          setIsDiscountModalOpen(false);
          return;
        }
        if (activeProductForModifier !== null) {
          setActiveProductForModifier(null);
          return;
        }
        if (isTableModalOpen) {
          setIsTableModalOpen(false);
          return;
        }
        if (isCustomerModalOpen) {
          setIsCustomerModalOpen(false);
          return;
        }
        if (isPaymentModalOpen) {
          setIsPaymentModalOpen(false);
          return;
        }

        // If no modals are open, clear / cancel the cart
        if (cartItems.length > 0) {
          e.preventDefault();
          cancelCart();
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    holdCurrentOrder,
    openCashDrawer,
    cancelCart,
    cartItems.length,
    isShortcutsModalOpen,
    isHeldOrdersModalOpen,
    isDiscountModalOpen,
    activeProductForModifier,
    isTableModalOpen,
    isCustomerModalOpen,
    isPaymentModalOpen,
    isQuickAddModalOpen,
    showToast,
  ]);

  // Filter active offers by search query
  const filteredOffers = availableOffers.filter((offer) => {
    if (onlyPopular && selectedCategoryId !== 'offers') return false;
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      const matchName =
        offer.nameAr.toLowerCase().includes(q) ||
        (offer.nameEn || '').toLowerCase().includes(q) ||
        (offer.description || '').toLowerCase().includes(q);
      const matchComponent = offer.components.some((c) =>
        c.productNameAr.toLowerCase().includes(q)
      );
      if (!matchName && !matchComponent) return false;
    }
    return true;
  });

  // Filter products (none shown when specifically viewing 'offers' tab)
  const filteredProducts =
    selectedCategoryId === 'offers'
      ? []
      : products.filter((p) => {
          if (!p.available) return false;
          if (selectedCategoryId !== 'all' && p.categoryId !== selectedCategoryId) return false;
          if (onlyPopular && !p.isPopular) return false;
          if (searchQuery.trim() !== '') {
            const q = searchQuery.toLowerCase();
            const matchName =
              p.nameAr.toLowerCase().includes(q) || p.nameEn.toLowerCase().includes(q);
            const matchSku =
              p.sku.toLowerCase().includes(q) || (p.barcode && p.barcode.includes(q));
            if (!matchName && !matchSku) return false;
          }
          return true;
        });

  const handleProductClick = (product: Product) => {
    if (product.modifierGroupIds && product.modifierGroupIds.length > 0) {
      setActiveProductForModifier(product);
    } else {
      addToCart(product, 1, [], '');
    }
  };

  const handleOfferClick = (offer: SpecialOffer) => {
    addOfferToCart(offer, 1, '');
  };

  const getCategoryIcon = (iconName: string, isLarge = false) => {
    const sizeClass = isLarge ? 'w-4 h-4' : 'w-3.5 h-3.5';
    switch (iconName) {
      case 'Flame':
        return <Flame className={`${sizeClass} text-[#8B1E1E]`} />;
      case 'Crown':
        return <Crown className={`${sizeClass} text-[#B8860B]`} />;
      case 'UtensilsCrossed':
        return <UtensilsCrossed className={`${sizeClass} text-[#3F532B]`} />;
      case 'Soup':
        return <Soup className={`${sizeClass} text-[#A67C52]`} />;
      case 'Salad':
        return <Salad className={`${sizeClass} text-emerald-700`} />;
      case 'Coffee':
        return <Coffee className={`${sizeClass} text-[#5D4037]`} />;
      default:
        return <UtensilsCrossed className={`${sizeClass} text-[#8B1E1E]`} />;
    }
  };

  return (
    <div className="flex-1 flex flex-col lg:flex-row h-[calc(100vh-4rem)] overflow-hidden bg-[#F8F5F0]">
      {/* ================= RIGHT (RTL): Products & Categories Catalog (65%) ================= */}
      <div className="flex-1 flex flex-col overflow-hidden border-l border-[#E8DFD5]">
        {/* Top Controls Bar: Enlarged Search & Category tabs */}
        <div className="p-3.5 bg-white border-b border-[#E8DFD5] space-y-3">
          <div className="flex items-center gap-2.5">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute right-3.5 top-3 text-[#7A6455]" />
              <input
                type="text"
                placeholder="ابحث عن صنف بالمسمى أو الكود (SKU / باركود)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pr-10 pl-4 py-2.5 text-sm font-semibold rounded-xl border border-[#D7C3A5] focus:outline-none focus:ring-2 focus:ring-[#8B1E1E] bg-[#FBF9F6]"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute left-3.5 top-2.5 text-xs font-bold text-gray-500 hover:text-gray-700"
                >
                  مسح
                </button>
              )}
            </div>

            {/* Popular items filter button */}
            <button
              onClick={() => setOnlyPopular(!onlyPopular)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-extrabold transition-colors border cursor-pointer ${
                onlyPopular
                  ? 'bg-[#B8860B] text-white border-[#B8860B] shadow-xs'
                  : 'bg-[#FFF8EF] text-[#B8860B] border-[#D7C3A5] hover:bg-[#F5EFE6]'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              <span>الأكثر طلباً</span>
            </button>

            {onNavigateToKitchen && (
              <button
                type="button"
                onClick={onNavigateToKitchen}
                title="متابعة محطات المطبخ وطابور الطابعة المشتركة (F3)"
                className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-extrabold transition-colors border bg-[#231610] text-amber-200 border-[#4E2E20] hover:bg-[#3A241A] cursor-pointer shrink-0"
              >
                <ChefHat className="w-4 h-4 text-amber-400" />
                <span className="hidden sm:inline">محطات المطبخ</span>
              </button>
            )}
          </div>

          {/* Multi-Row Stacked Categories (🔥 العروض pinned FIRST before all categories) */}
          <div className="flex flex-wrap items-center gap-2 max-h-44 overflow-y-auto pt-0.5 pb-1 text-sm">
            <button
              type="button"
              onClick={() => setSelectedCategoryId('offers')}
              className={`px-4 py-2 rounded-xl font-black whitespace-nowrap transition-all flex items-center gap-2 border-2 cursor-pointer shadow-xs ${
                selectedCategoryId === 'offers'
                  ? 'bg-gradient-to-l from-[#140E0B] via-[#5B1111] to-[#8B1E1E] text-[#FCD34D] border-[#C59A3F] shadow-md'
                  : 'bg-[#140E0B] text-[#FCD34D] border-[#C59A3F]/70 hover:border-[#C59A3F] hover:bg-[#231610]'
              }`}
            >
              <span className="text-base leading-none">🔥</span>
              <span>العروض</span>
              <span className="text-xs px-2 py-0.5 rounded-lg font-num font-black bg-[#8B1E1E] text-white border border-[#C59A3F]/40">
                {availableOffers.length}
              </span>
            </button>

            <button
              onClick={() => setSelectedCategoryId('all')}
              className={`px-4 py-2 rounded-xl font-extrabold whitespace-nowrap transition-all flex items-center gap-2 border-2 cursor-pointer ${
                selectedCategoryId === 'all'
                  ? 'bg-[#8B1E1E] text-white border-[#8B1E1E] shadow-sm'
                  : 'bg-white text-[#231610] border-[#D7C3A5] hover:bg-[#FFF8EF] hover:border-[#8B1E1E]/50'
              }`}
            >
              <UtensilsCrossed className="w-4 h-4" />
              <span>جميع الأصناف</span>
              <span className={`text-xs px-2 py-0.5 rounded-lg font-num font-black ${selectedCategoryId === 'all' ? 'bg-white/25 text-white' : 'bg-[#F5EFE6] text-[#8B1E1E]'}`}>
                {products.length}
              </span>
            </button>

            {categories.map((cat) => {
              const count = products.filter((p) => p.categoryId === cat.id).length;
              const isSelected = selectedCategoryId === cat.id;

              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategoryId(cat.id)}
                  className={`px-4 py-2 rounded-xl font-extrabold whitespace-nowrap transition-all flex items-center gap-2 border-2 cursor-pointer ${
                    isSelected
                      ? 'bg-[#8B1E1E] text-white border-[#8B1E1E] shadow-sm'
                      : 'bg-white text-[#231610] border-[#D7C3A5] hover:bg-[#FFF8EF] hover:border-[#8B1E1E]/50'
                  }`}
                >
                  {getCategoryIcon(cat.icon, true)}
                  <span>{cat.nameAr}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-lg font-num font-black ${isSelected ? 'bg-white/25 text-white' : 'bg-[#F5EFE6] text-[#8B1E1E]'}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Product & Special Offers Grid */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* 🔥 SPECIAL OFFERS SECTION (Always first when 'offers' tab or 'all' with active offers) */}
          {(selectedCategoryId === 'offers' ||
            (selectedCategoryId === 'all' && filteredOffers.length > 0 && !onlyPopular)) && (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-2xl bg-gradient-to-l from-[#140E0B] via-[#3A1111] to-[#691313] text-white border border-[#C59A3F]/60 shadow-sm">
                <div className="flex items-center gap-2.5">
                  <span className="text-lg leading-none">🔥</span>
                  <div>
                    <h3 className="text-sm font-black text-[#FCD34D]">
                      العروض الخاصة — باقات مشويات الباشا
                    </h3>
                    <p className="text-[11px] text-amber-100/80">
                      اضغط على العرض لإضافته مباشرة إلى الفاتورة بسعر العرض وتوجيه مكوناته لمحطات المطبخ
                    </p>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-lg bg-black/35 border border-[#C59A3F]/40 text-xs font-black font-num text-[#FCD34D] shrink-0">
                  {filteredOffers.length} عرض متاح
                </span>
              </div>

              {filteredOffers.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5">
                  {filteredOffers.map((offer) => {
                    const remaining =
                      typeof offer.maxTotalRedemptions === 'number' && offer.maxTotalRedemptions > 0
                        ? Math.max(0, offer.maxTotalRedemptions - (offer.currentRedemptions || 0))
                        : null;
                    const componentsText = formatOfferComponentsSummary(offer.components, 1);

                    return (
                      <div
                        key={offer.id}
                        onClick={() => handleOfferClick(offer)}
                        className="rounded-2xl bg-[#140E0B] text-white border-2 border-[#C59A3F]/65 hover:border-[#FCD34D] shadow-md hover:shadow-xl overflow-hidden cursor-pointer flex flex-col justify-between group active:scale-[0.98] transition-all select-none"
                      >
                        {/* Image / Emblem Header */}
                        {offer.imageUrl ? (
                          <div className="relative h-32 w-full bg-[#231610] overflow-hidden">
                            <img
                              src={offer.imageUrl}
                              alt={offer.nameAr}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                              loading="lazy"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-[#140E0B] via-transparent to-black/25" />
                            <div className="absolute top-2.5 right-2.5 px-2.5 py-1 rounded-lg bg-[#8B1E1E] text-white border border-[#C59A3F] text-[11px] font-black font-num shadow-sm">
                              وفّر {offer.savingsAmount.toFixed(0)} {profile.currency} ({offer.savingsPercent}%)
                            </div>
                            {remaining !== null && (
                              <div className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded-md bg-black/75 text-amber-200 text-[10px] font-bold font-num border border-white/15">
                                متبقي {remaining}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="px-3.5 pt-3 pb-2 bg-gradient-to-l from-[#2A1111] to-[#140E0B] border-b border-[#C59A3F]/25 flex items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-black text-[#FCD34D]">
                              <Flame className="w-3.5 h-3.5 text-[#E11D48]" />
                              <span>عرض خاص</span>
                            </span>
                            <div className="flex items-center gap-1.5">
                              {remaining !== null && (
                                <span className="px-2 py-0.5 rounded-md bg-white/10 text-amber-200 text-[10px] font-bold font-num">
                                  متبقي {remaining}
                                </span>
                              )}
                              <span className="px-2 py-0.5 rounded-md bg-[#8B1E1E] text-white border border-[#C59A3F]/70 text-[11px] font-black font-num">
                                خصم {offer.savingsPercent}%
                              </span>
                            </div>
                          </div>
                        )}

                        {/* Card Body */}
                        <div className="p-3.5 flex-1 flex flex-col justify-between gap-2.5">
                          <div className="space-y-1.5">
                            <h4 className="font-black text-sm text-white group-hover:text-[#FCD34D] transition-colors leading-snug">
                              {offer.nameAr}
                            </h4>
                            <p className="text-[11px] text-amber-100/80 line-clamp-2 leading-relaxed">
                              {offer.description || componentsText}
                            </p>
                            {offer.description && (
                              <div className="text-[10.5px] text-[#D7C3A5] bg-white/5 border border-white/10 rounded-lg px-2 py-1 line-clamp-2">
                                {componentsText}
                              </div>
                            )}
                          </div>

                          <div className="pt-2.5 border-t border-white/10 flex items-center justify-between gap-2">
                            <div>
                              <div className="flex items-baseline gap-2">
                                <span className="text-base font-black text-[#FCD34D] font-num">
                                  {offer.offerPrice.toFixed(2)}{' '}
                                  <span className="text-[10px]">{profile.currency}</span>
                                </span>
                                <span className="text-[11px] text-white/50 line-through font-num">
                                  {offer.originalPrice.toFixed(2)}
                                </span>
                              </div>
                              <span className="text-[10px] text-emerald-300 font-bold font-num">
                                توفير {offer.savingsAmount.toFixed(2)} {profile.currency}
                              </span>
                            </div>

                            <div className="px-3 py-1.5 rounded-xl bg-[#8B1E1E] group-hover:bg-[#A62222] text-white border border-[#C59A3F]/60 text-xs font-black flex items-center gap-1 shadow-xs">
                              <Plus className="w-3.5 h-3.5 text-[#FCD34D]" />
                              <span>إضافة</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                selectedCategoryId === 'offers' && (
                  <div className="bg-white rounded-2xl border border-[#E5DACB] p-10 text-center space-y-2 max-w-md mx-auto">
                    <Flame className="w-10 h-10 text-[#8B1E1E] mx-auto" />
                    <div className="text-sm font-black text-[#140E0B]">
                      لا توجد عروض نشطة متاحة الآن
                    </div>
                    <p className="text-xs text-[#7A6455]">
                      يمكن للمدير إضافة أو تفعيل العروض من شاشة «إدارة العروض» في القائمة الجانبية.
                    </p>
                  </div>
                )
              )}
            </section>
          )}

          {selectedCategoryId !== 'offers' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3.5">
            {filteredProducts.map((product) => {
              const hasModifiers = product.modifierGroupIds && product.modifierGroupIds.length > 0;
              const category = categories.find((c) => c.id === product.categoryId);

              return (
                <div
                  key={product.id}
                  onClick={() => handleProductClick(product)}
                  className="bg-white rounded-xl border border-[#E5DACB] hover:border-[#8B1E1E] overflow-hidden shadow-2xs hover:shadow-md transition-all cursor-pointer flex flex-col justify-between group active:scale-[0.98] select-none"
                >
                  {/* Card Header Top Accent / Visual Area */}
                  {product.image ? (
                    <div className="relative h-28 w-full bg-[#EFE8DC] overflow-hidden flex items-center justify-center">
                      <img
                        src={product.image}
                        alt={product.nameAr}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        loading="lazy"
                      />
                      {product.isPopular && (
                        <div className="absolute top-2 right-2 bg-[#140E0B] text-amber-200 border border-[#C59A3F]/50 text-[10px] font-bold px-2 py-0.5 rounded-md shadow-xs flex items-center gap-1">
                          <Sparkles className="w-2.5 h-2.5 text-[#C59A3F]" />
                          <span>الأكثر طلباً</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="p-3 pb-0 flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-[#8B1E1E] flex items-center gap-1">
                        {category ? getCategoryIcon(category.icon) : <Flame className="w-3 h-3" />}
                        <span>{category?.nameAr || 'مشويات'}</span>
                      </span>

                      {product.isPopular ? (
                        <span className="text-[10px] text-[#C59A3F] font-bold flex items-center gap-1">
                          <Sparkles className="w-2.5 h-2.5" />
                          <span>الأكثر طلباً</span>
                        </span>
                      ) : (
                        <span className="text-[10px] text-[#A8988B] font-mono">
                          {product.sku || ''}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Product Details */}
                  <div className="p-3 flex-1 flex flex-col justify-between">
                    <div>
                      <h4 className="font-bold text-sm text-[#1F1511] line-clamp-2 leading-snug group-hover:text-[#8B1E1E] transition-colors">
                        {product.nameAr}
                      </h4>
                      {product.description && (
                        <p className="text-[11px] text-[#7A6455] line-clamp-1 mt-1 leading-normal font-normal">
                          {product.description}
                        </p>
                      )}
                    </div>

                    <div className="mt-3 pt-2 border-t border-[#F2ECE4] flex items-center justify-between">
                      <div>
                        <span className="text-[10px] text-gray-500 block leading-tight">السعر</span>
                        <div className="text-sm font-extrabold text-[#8B1E1E] font-num">
                          {product.price.toFixed(2)} <span className="text-[10px] font-bold">{profile.currency}</span>
                        </div>
                      </div>

                      <div className="w-7 h-7 rounded-lg bg-[#F7F4EE] border border-[#E5DACB] text-[#8B1E1E] flex items-center justify-center group-hover:bg-[#8B1E1E] group-hover:text-white transition-all shadow-2xs group-hover:scale-105">
                        <Plus className="w-3.5 h-3.5" />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            </div>
          )}

          {selectedCategoryId !== 'offers' && filteredProducts.length === 0 && (
            <div className="text-center py-16 px-4 space-y-4 max-w-md mx-auto">
              <div className="w-16 h-16 rounded-3xl bg-[#FFF8EF] border border-[#D7C3A5] flex items-center justify-center text-[#8B1E1E] mx-auto shadow-sm">
                <UtensilsCrossed className="w-8 h-8" />
              </div>
              <div>
                <div className="font-extrabold text-base text-[#231610]">
                  {products.length === 0
                    ? 'قائمة الطعام فارغة حالياً'
                    : 'لا توجد أصناف مطابقة للبحث أو التصنيف المحدد'}
                </div>
                <p className="text-xs text-[#7A6455] mt-1.5 leading-relaxed">
                  {products.length === 0
                    ? 'النظام مهيأ في وضع الإنتاج النظيف. يمكنك إضافة أصنافك وقوائمك الفعلية من شاشة إدارة المنتجات أو إضافة صنف سريع الآن.'
                    : 'جرّب البحث باسم صنف آخر أو اختيار تصنيف مختلف من الشريط العلوي.'}
                </p>
              </div>

              {products.length === 0 && (
                <button
                  type="button"
                  onClick={() => setIsQuickAddModalOpen(true)}
                  className="px-5 py-2.5 rounded-xl bg-[#8B1E1E] hover:bg-[#721616] text-white text-xs font-bold shadow-md transition-all active:scale-95 flex items-center justify-center gap-2 mx-auto cursor-pointer"
                >
                  <Plus className="w-4 h-4 text-amber-300" />
                  <span>إضافة صنف جديد للبيع (F6)</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Draggable Vertical Divider Handle for Invoice Panel Width */}
      <div
        onMouseDown={(e) => {
          e.preventDefault();
          startCartResize(e.clientX);
        }}
        onTouchStart={(e) => {
          if (e.touches[0]) startCartResize(e.touches[0].clientX);
        }}
        onDoubleClick={() => setCartWidthPx(DEFAULT_CART_WIDTH)}
        title={`اسحب يميناً أو يساراً لتغيير عرض الفاتورة (نقر مزدوج للاستعادة ${DEFAULT_CART_WIDTH}px)`}
        className={`hidden lg:flex w-2.5 cursor-col-resize items-center justify-center border-x transition-colors shrink-0 select-none z-30 group ${
          isResizingCart
            ? 'bg-[#8B1E1E]/25 border-[#8B1E1E]'
            : 'bg-[#EFE8DC] hover:bg-[#DFD2BE] border-[#DED0BC]'
        }`}
      >
        <div className="flex flex-col items-center gap-1 py-3 px-0.5 rounded-full bg-white/90 border border-[#D7C3A5] shadow-2xs group-hover:border-[#8B1E1E]">
          <GripVertical className="w-3 h-3 text-[#6F4E37] group-hover:text-[#8B1E1E]" />
        </div>
      </div>

      {/* ================= LEFT (RTL): POS Cart & Order Details Panel ================= */}
      <div
        id="pos-invoice-panel"
        style={isDesktopLg ? { width: `${cartWidthPx}px` } : undefined}
        className="relative w-full lg:shrink-0 bg-white flex flex-col justify-between border-t lg:border-t-0 shadow-lg z-20"
      >
        {/* Subtle Inner Drag Edge on the Invoice Panel itself */}
        <div
          onMouseDown={(e) => {
            e.preventDefault();
            startCartResize(e.clientX);
          }}
          onTouchStart={(e) => {
            if (e.touches[0]) startCartResize(e.touches[0].clientX);
          }}
          onDoubleClick={() => setCartWidthPx(DEFAULT_CART_WIDTH)}
          title="اسحب لتغيير عرض الفاتورة"
          className="hidden lg:block absolute top-0 bottom-0 right-0 w-1.5 cursor-col-resize hover:bg-[#8B1E1E]/30 transition-colors z-40"
        />

        {/* Invoice Width Control Bar (Desktop) */}
        <div className="hidden lg:flex items-center justify-between gap-1.5 px-2 py-1 bg-[#F5EFE6] border-b border-[#E5DACB] text-[10.5px]">
          <div className="flex items-center gap-1 text-[#5C4033] font-bold min-w-0">
            <SlidersHorizontal className="w-3 h-3 text-[#8B1E1E] shrink-0" />
            <span className="truncate">العرض:</span>
            <button
              type="button"
              onClick={() => setCartWidthPx(DEFAULT_CART_WIDTH)}
              title="انقر لاستعادة العرض الافتراضي المضغوط (330px)"
              className="font-mono font-extrabold text-[#8B1E1E] tabular-nums bg-white px-1 py-0.5 rounded border border-[#D7C3A5] hover:bg-[#FFF8EF] cursor-pointer"
            >
              {cartWidthPx}px
            </button>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setCartWidthPx(310)}
              className={`px-1.5 py-0.5 rounded font-bold border transition-colors cursor-pointer ${
                cartWidthPx <= 350
                  ? 'bg-[#8B1E1E] text-white border-[#8B1E1E]'
                  : 'bg-white text-[#5C4033] border-[#D7C3A5] hover:bg-[#FFF8EF]'
              }`}
              title="عرض مضغوط (310px)"
            >
              مضغوط
            </button>
            <button
              type="button"
              onClick={() => setCartWidthPx(390)}
              className={`px-1.5 py-0.5 rounded font-bold border transition-colors cursor-pointer ${
                cartWidthPx > 350 && cartWidthPx <= 460
                  ? 'bg-[#8B1E1E] text-white border-[#8B1E1E]'
                  : 'bg-white text-[#5C4033] border-[#D7C3A5] hover:bg-[#FFF8EF]'
              }`}
              title="عرض وسط (390px)"
            >
              وسط
            </button>
            <button
              type="button"
              onClick={() => setCartWidthPx(500)}
              className={`px-1.5 py-0.5 rounded font-bold border transition-colors cursor-pointer ${
                cartWidthPx > 460
                  ? 'bg-[#8B1E1E] text-white border-[#8B1E1E]'
                  : 'bg-white text-[#5C4033] border-[#D7C3A5] hover:bg-[#FFF8EF]'
              }`}
              title="عرض عريض (500px)"
            >
              عريض
            </button>

            <div className="h-3 w-px bg-[#D7C3A5] mx-0.5" />

            <button
              type="button"
              onClick={() => setCartWidthPx((w) => clampCartWidth(w - 25))}
              disabled={cartWidthPx <= MIN_CART_WIDTH}
              className="w-5 h-5 rounded bg-white border border-[#D7C3A5] text-[#8B1E1E] hover:bg-[#FFF8EF] disabled:opacity-40 flex items-center justify-center cursor-pointer"
              title="تصغير عرض الفاتورة (-25px)"
            >
              <Minus className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={() => setCartWidthPx((w) => clampCartWidth(w + 25))}
              disabled={cartWidthPx >= MAX_CART_WIDTH}
              className="w-5 h-5 rounded bg-white border border-[#D7C3A5] text-[#8B1E1E] hover:bg-[#FFF8EF] disabled:opacity-40 flex items-center justify-center cursor-pointer"
              title="توسيع عرض الفاتورة (+25px)"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Cashier Quick Shortcuts Action Bar (Compact) */}
        <div className="px-1.5 py-1 bg-[#18110D] text-white flex items-center justify-between gap-1 border-b border-[#2C1E17]">
          <div className="flex items-center gap-1 flex-wrap min-w-0">
            {/* Hold Order Button (F5) */}
            <button
              type="button"
              onClick={() => {
                if (cartItems.length > 0) {
                  holdCurrentOrder();
                } else if (heldOrders.length > 0) {
                  setIsHeldOrdersModalOpen(true);
                } else {
                  showToast('لا توجد أصناف في السلة لتعليقها (F5)', 'info');
                }
              }}
              title="تعليق الطلب الحالي لحين خدمة زبون آخر (اختصار F5)"
              className="flex items-center gap-1 px-1.5 py-1 rounded-md bg-[#2E1D15] hover:bg-[#432A1E] text-amber-300 text-[10.5px] font-bold transition-all border border-amber-500/30 active:scale-95 whitespace-nowrap"
            >
              <PauseCircle className="w-3 h-3 text-amber-400 shrink-0" />
              <span>تعليق</span>
              <kbd className="px-1 py-0 bg-black/40 text-[9px] text-amber-200/90 rounded font-mono border border-amber-500/25 leading-tight">
                F5
              </kbd>
              {heldOrders.length > 0 && (
                <span className="bg-amber-500 text-black text-[9px] font-black px-1 rounded-full leading-tight">
                  {heldOrders.length}
                </span>
              )}
            </button>

            {/* Quick Add Custom Item Button (F6) */}
            <button
              type="button"
              onClick={() => setIsQuickAddModalOpen(true)}
              title="إضافة صنف مخصص أو طلب سريع للفاتورة (اختصار F6)"
              className="flex items-center gap-1 px-1.5 py-1 rounded-md bg-[#2E1D15] hover:bg-[#432A1E] text-amber-300 text-[10.5px] font-bold transition-all border border-amber-500/30 active:scale-95 whitespace-nowrap"
            >
              <Plus className="w-3 h-3 text-amber-400 shrink-0" />
              <span>صنف سريع</span>
              <kbd className="px-1 py-0 bg-black/40 text-[9px] text-amber-200/90 rounded font-mono border border-amber-500/25 leading-tight">
                F6
              </kbd>
            </button>

            {/* Held Orders List button */}
            {heldOrders.length > 0 && (
              <button
                type="button"
                onClick={() => setIsHeldOrdersModalOpen(true)}
                title="عرض قائمة الطلبات المعلقة واسترجاعها"
                className="px-1.5 py-1 rounded-md bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 text-[10.5px] font-bold border border-amber-500/40 transition-colors flex items-center gap-1 whitespace-nowrap"
              >
                <span>معلق ({heldOrders.length})</span>
              </button>
            )}

            {/* Open Cash Drawer Button (F9) */}
            <button
              type="button"
              onClick={() => openCashDrawer()}
              title="فتح صندوق النقدية يدوياً وتسجيل الحركة (اختصار F9)"
              className="flex items-center gap-1 px-1.5 py-1 rounded-md bg-[#142B1A] hover:bg-[#1C3E25] text-emerald-300 text-[10.5px] font-bold transition-all border border-emerald-500/40 active:scale-95 whitespace-nowrap"
            >
              <DollarSign className="w-3 h-3 text-emerald-400 shrink-0" />
              <span>فتح الدرج</span>
              <kbd className="px-1 py-0 bg-black/40 text-[9px] text-emerald-200/90 rounded font-mono border border-emerald-500/25 leading-tight">
                F9
              </kbd>
            </button>

            {/* Cancel Cart Button (ESC) */}
            <button
              type="button"
              onClick={() => cancelCart()}
              disabled={cartItems.length === 0}
              title="إلغاء الطلب وتفريغ السلة (اختصار ESC)"
              className="flex items-center gap-1 px-1.5 py-1 rounded-md bg-[#2E1515] hover:bg-[#431E1E] text-rose-300 text-[10.5px] font-bold transition-all border border-rose-500/40 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 whitespace-nowrap"
            >
              <Ban className="w-3 h-3 text-rose-400 shrink-0" />
              <span>إلغاء</span>
              <kbd className="px-1 py-0 bg-black/40 text-[9px] text-rose-200/90 rounded font-mono border border-rose-500/25 leading-tight">
                ESC
              </kbd>
            </button>
          </div>

          {/* Shortcuts Guide Button (F1) */}
          <button
            type="button"
            onClick={() => setIsShortcutsModalOpen(true)}
            title="دليل اختصارات لوحة المفاتيح للكاشير (F1)"
            className="shrink-0 px-1.5 py-1 text-[#D7C3A5] hover:text-white rounded-md hover:bg-white/10 transition-colors flex items-center gap-1 text-[10px] font-bold whitespace-nowrap"
          >
            <Keyboard className="w-3.5 h-3.5 text-amber-300 shrink-0" />
            <kbd className="text-[9px] bg-white/10 px-1 py-0 rounded font-mono leading-tight">F1</kbd>
          </button>
        </div>

        {/* Order Setup Header: Type (Dine-in / Takeaway / Delivery), Table, Customer */}
        <div className="p-2 bg-[#FBF9F6] border-b border-[#E8DFD5] space-y-2">
          {/* Order Type Tabs */}
          <div className="grid grid-cols-4 gap-1 p-1 bg-[#F5EFE6] rounded-xl border border-[#E8DFD5]">
            <button
              onClick={() => setOrderType('dine_in')}
              className={`py-1.5 px-1 rounded-lg text-[11px] font-bold transition-all flex flex-col items-center justify-center gap-0.5 ${
                orderType === 'dine_in'
                  ? 'bg-[#8B1E1E] text-white shadow-xs'
                  : 'text-[#6F4E37] hover:bg-white/60'
              }`}
            >
              <Grid className="w-3.5 h-3.5" />
              <span>صالات</span>
            </button>

            <button
              onClick={() => setOrderType('takeaway')}
              className={`py-1.5 px-1 rounded-lg text-[11px] font-bold transition-all flex flex-col items-center justify-center gap-0.5 ${
                orderType === 'takeaway'
                  ? 'bg-[#8B1E1E] text-white shadow-xs'
                  : 'text-[#6F4E37] hover:bg-white/60'
              }`}
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              <span>سفري</span>
            </button>

            <button
              onClick={() => setOrderType('delivery')}
              className={`py-1.5 px-1 rounded-lg text-[11px] font-bold transition-all flex flex-col items-center justify-center gap-0.5 ${
                orderType === 'delivery'
                  ? 'bg-[#8B1E1E] text-white shadow-xs'
                  : 'text-[#6F4E37] hover:bg-white/60'
              }`}
            >
              <Bike className="w-3.5 h-3.5" />
              <span>توصيل</span>
            </button>

            <button
              onClick={() => setOrderType('pickup')}
              className={`py-1.5 px-1 rounded-lg text-[11px] font-bold transition-all flex flex-col items-center justify-center gap-0.5 ${
                orderType === 'pickup'
                  ? 'bg-[#8B1E1E] text-white shadow-xs'
                  : 'text-[#6F4E37] hover:bg-white/60'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>استلام</span>
            </button>
          </div>

          {/* Order Type Specific Controls & Direct Customer Search */}
          <div className="space-y-2">
            {/* Table picker for Dine In */}
            {orderType === 'dine_in' && (
              <button
                type="button"
                onClick={() => setIsTableModalOpen(true)}
                className={`w-full py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-between transition-colors shadow-2xs ${
                  selectedTable
                    ? 'bg-[#FFF8EF] border-[#8B1E1E] text-[#8B1E1E]'
                    : 'bg-white border-[#D7C3A5] text-[#3E2723] hover:bg-[#F5EFE6]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Grid className="w-4 h-4 text-[#8B1E1E]" />
                  <span>{selectedTable ? `طاولة ${selectedTable.number} (${selectedTable.section})` : 'اختر رقم الطاولة (F4) *'}</span>
                </div>
                <span className="text-[10px] text-[#8B1E1E] font-bold">تغيير</span>
              </button>
            )}

            {/* Direct Customer Search & Quick Attach Field */}
            <POSCustomerSearch
              selectedCustomer={selectedCustomer}
              onSelectCustomer={setSelectedCustomer}
              orderType={orderType}
              inputRef={customerSearchInputRef}
            />
          </div>

          {orderType === 'delivery' && (
            <div className="flex items-center gap-2 bg-amber-50/70 p-2 rounded-xl border border-amber-200 text-xs">
              <span className="text-amber-900 font-bold shrink-0">رسوم التوصيل:</span>
              <input
                type="number"
                min="0"
                value={deliveryFee}
                onChange={(e) => setDeliveryFee(parseFloat(e.target.value) || 0)}
                className="w-20 bg-white border border-[#D7C3A5] rounded-lg px-2 py-1 text-center font-bold tabular-nums"
              />
              <span className="text-amber-900 text-[11px] font-bold">{profile.currency}</span>
              {selectedCustomer?.address && (
                <span className="text-[10px] text-[#7A6455] truncate max-w-[150px] mr-auto">
                  {selectedCustomer.address}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Cart Items List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {cartItems.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-4 text-[#7A6455]">
              <UtensilsCrossed className="w-10 h-10 text-[#D7C3A5] mb-2 stroke-[1.2]" />
              <div className="font-bold text-xs text-[#231610]">الفاتورة فارغة حالياً</div>
              <p className="text-[11px] text-[#8C7665] mt-1 max-w-[190px]">
                انقر على أي صنف من قائمة المشويات لإضافته للفاتورة مباشرة.
              </p>
            </div>
          ) : (
            cartItems.map((item) => {
              const isOffer = item.itemType === 'offer';
              return (
                <div
                  key={item.id}
                  className={`p-2 rounded-xl border space-y-1 ${
                    isOffer
                      ? 'bg-[#FFF8EF] border-[#C59A3F]'
                      : 'bg-[#FBF9F6] border-[#E8DFD5]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-1.5">
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-xs text-[#231610] leading-snug flex items-center gap-1.5 flex-wrap">
                        {isOffer && (
                          <span className="px-1.5 py-0.2 rounded bg-[#140E0B] text-[#FCD34D] text-[9.5px] font-black border border-[#C59A3F]/60">
                            عرض
                          </span>
                        )}
                        <span>{item.productNameAr}</span>
                      </div>

                      {isOffer && item.offerComponents && item.offerComponents.length > 0 && (
                        <div className="mt-1 pr-2 border-r-2 border-[#C59A3F]/60 space-y-0.5 text-[10px] text-[#5C4033]">
                          {item.offerComponents.map((comp) => (
                            <div key={comp.productId} className="truncate">
                              • {comp.productNameAr} ×{' '}
                              <span className="font-num font-bold text-[#8B1E1E]">
                                {roundQty(comp.quantity * item.quantity)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {isOffer && (item.savingsPerUnit || 0) > 0 && (
                        <div className="text-[10px] font-bold text-emerald-700 mt-0.5 font-num">
                          وفّرت {((item.savingsPerUnit || 0) * item.quantity).toFixed(2)} {profile.currency}
                        </div>
                      )}

                      {item.selectedModifiers && item.selectedModifiers.length > 0 && (
                        <div className="text-[10px] text-[#8B1E1E] mt-0.5 space-y-0.5">
                          {item.selectedModifiers.map((m, idx) => (
                            <span key={idx} className="inline-block ml-1">
                              • {m.nameAr} {m.priceDelta > 0 && `(+${m.priceDelta})`}
                            </span>
                          ))}
                        </div>
                      )}
                      {item.notes && (
                        <div className="text-[10px] italic text-[#7A6455] mt-0.5">
                          ملاحظة: {item.notes}
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => removeItem(item.id)}
                      className="text-gray-400 hover:text-red-600 p-0.5 transition-colors shrink-0"
                      title="حذف الصنف"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-[#F0E6D8]">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => updateQuantity(item.id, -1)}
                        className="w-5 h-5 rounded-md bg-white border border-[#D7C3A5] font-bold text-[#8B1E1E] flex items-center justify-center hover:bg-[#EAE0D2]"
                      >
                        <Minus className="w-2.5 h-2.5" />
                      </button>
                      <span className="font-bold text-xs tabular-nums w-5 text-center text-[#231610]">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => updateQuantity(item.id, 1)}
                        className="w-5 h-5 rounded-md bg-white border border-[#D7C3A5] font-bold text-[#8B1E1E] flex items-center justify-center hover:bg-[#EAE0D2]"
                      >
                        <Plus className="w-2.5 h-2.5" />
                      </button>
                    </div>

                    <div className="text-xs font-bold text-[#8B1E1E] tabular-nums">
                      {item.itemTotal.toFixed(2)} {profile.currency}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Order Totals Summary & Checkout Action */}
        <div className="p-2.5 bg-[#FBF9F6] border-t border-[#E8DFD5] space-y-1.5">
          {/* Notes & Discount trigger row */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setIsDiscountModalOpen(!isDiscountModalOpen)}
              className="flex items-center gap-1 px-2 py-1 text-[10.5px] font-bold rounded-lg border border-[#D7C3A5] bg-white text-[#6F4E37] hover:bg-[#F5EFE6] shrink-0"
            >
              <Percent className="w-3 h-3 text-[#B8860B]" />
              <span>
                {discountAmount > 0
                  ? `خصم: ${discountAmount}`
                  : 'خصم'}
              </span>
            </button>

            <input
              type="text"
              placeholder="ملاحظات الفاتورة..."
              value={orderNotes}
              onChange={(e) => setOrderNotes(e.target.value)}
              className="flex-1 min-w-0 px-2 py-1 text-[11px] rounded-lg border border-[#D7C3A5] bg-white focus:outline-none"
            />

            {cartItems.length > 0 && (
              <button
                onClick={clearCart}
                className="p-1 text-gray-400 hover:text-red-700 transition-colors"
                title="تفريغ الفاتورة"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Discount Inline Control */}
          {isDiscountModalOpen && (
            <div className="p-2 bg-white rounded-xl border border-[#D7C3A5] space-y-2 animate-in fade-in">
              <div className="flex items-center justify-between text-xs font-bold text-[#231610]">
                <span>تحديد الخصم المصرح به:</span>
                <div className="flex gap-1 text-[10px]">
                  <button
                    onClick={() => setDiscount('percent', discountPercent || 10)}
                    className={`px-2 py-0.5 rounded ${
                      discountMode === 'percent' ? 'bg-[#8B1E1E] text-white' : 'bg-gray-100'
                    }`}
                  >
                    نسبة مئوية %
                  </button>
                  <button
                    onClick={() => setDiscount('fixed', discountFixed || 50)}
                    className={`px-2 py-0.5 rounded ${
                      discountMode === 'fixed' ? 'bg-[#8B1E1E] text-white' : 'bg-gray-100'
                    }`}
                  >
                    مبلغ ثابت
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  value={discountMode === 'percent' ? discountPercent : discountFixed}
                  onChange={(e) => setDiscount(discountMode, parseFloat(e.target.value) || 0)}
                  className="flex-1 px-2 py-1 text-xs border border-[#D7C3A5] rounded-lg font-bold tabular-nums"
                  placeholder="القيمة..."
                />
                <button
                  onClick={() => {
                    setDiscount('percent', 0);
                    setIsDiscountModalOpen(false);
                  }}
                  className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded"
                >
                  إلغاء الخصم
                </button>
              </div>
            </div>
          )}

          {/* Breakdown summary */}
          <div className="text-[11px] text-[#5C4033] space-y-1 pt-1 border-t border-[#E8DFD5]">
            <div className="flex justify-between">
              <span>المجموع الفرعي:</span>
              <span className="tabular-nums font-bold">
                {subtotal.toFixed(2)} {profile.currency}
              </span>
            </div>

            {discountAmount > 0 && (
              <div className="flex justify-between text-red-700 font-bold">
                <span>الخصم المطبق:</span>
                <span className="tabular-nums">
                  -{discountAmount.toFixed(2)} {profile.currency}
                </span>
              </div>
            )}

            {orderType === 'delivery' && deliveryFee > 0 && (
              <div className="flex justify-between">
                <span>خدمة التوصيل:</span>
                <span className="tabular-nums font-bold">
                  {deliveryFee.toFixed(2)} {profile.currency}
                </span>
              </div>
            )}

            <div className="flex justify-between text-base font-extrabold text-[#8B1E1E] pt-1.5 border-t border-[#E8DFD5]">
              <span>المجموع الكلي:</span>
              <span className="tabular-nums">
                {total.toFixed(2)} {profile.currency}
              </span>
            </div>
          </div>

          {/* Big Checkout Button */}
          <button
            onClick={() => setIsPaymentModalOpen(true)}
            disabled={cartItems.length === 0}
            className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-[#8B1E1E] to-[#721616] hover:from-[#721616] hover:to-[#5A1212] text-white font-black text-sm shadow-md hover:shadow-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-between active:scale-[0.99] select-none"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-amber-200" />
              <span>دفع وإنهاء الفاتورة</span>
              <kbd className="px-2 py-0.5 rounded-md bg-black/30 text-[10px] font-mono text-amber-200 border border-white/20">
                F10
              </kbd>
            </div>
            <span className="tabular-nums text-base font-black text-amber-200">
              {total.toFixed(2)} {profile.currency}
            </span>
          </button>
        </div>
      </div>

      {/* ================= MODALS ================= */}
      <ModifierModal
        product={activeProductForModifier}
        isOpen={activeProductForModifier !== null}
        onClose={() => setActiveProductForModifier(null)}
        onConfirm={(product, quantity, modifiers, notes) => {
          addToCart(product, quantity, modifiers, notes);
          setActiveProductForModifier(null);
        }}
      />

      <PaymentModal
        isOpen={isPaymentModalOpen}
        total={total}
        isSubmitting={isSubmittingCheckout}
        onClose={() => setIsPaymentModalOpen(false)}
        onConfirm={async (payments) => {
          await processCheckout(payments);
          setIsPaymentModalOpen(false);
        }}
      />

      <TablePickerModal
        isOpen={isTableModalOpen}
        selectedTable={selectedTable}
        onSelect={(tbl) => setSelectedTable(tbl)}
        onClose={() => setIsTableModalOpen(false)}
      />

      <QuickCustomerModal
        isOpen={isCustomerModalOpen}
        selectedCustomer={selectedCustomer}
        onSelect={(cust) => setSelectedCustomer(cust)}
        onClose={() => setIsCustomerModalOpen(false)}
      />

      {/* Held Orders Modal */}
      <HeldOrdersModal
        isOpen={isHeldOrdersModalOpen}
        onClose={() => setIsHeldOrdersModalOpen(false)}
        heldOrders={heldOrders}
        onResume={(order) => resumeHeldOrder(order)}
        onDelete={(id) => deleteHeldOrder(id)}
        onClearAll={() => clearAllHeldOrders()}
      />

      {/* Shortcuts Guide Modal */}
      <ShortcutsModal
        isOpen={isShortcutsModalOpen}
        onClose={() => setIsShortcutsModalOpen(false)}
      />

      {/* Quick Add Custom Item Modal */}
      <QuickAddItemModal
        isOpen={isQuickAddModalOpen}
        onClose={() => setIsQuickAddModalOpen(false)}
        onAdd={(product, quantity, notes) => {
          addToCart(product, quantity, [], notes);
          showToast(`تمت إضافة "${product.nameAr}" للفاتورة بنجاح`, 'success');
        }}
      />
    </div>
  );
};
