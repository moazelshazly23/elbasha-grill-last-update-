import React, { createContext, useContext, useState, useRef } from 'react';
import {
  Product,
  OrderItem,
  SelectedModifier,
  OrderType,
  RestaurantTable,
  Customer,
  PaymentItem,
  Order,
  HeldOrder,
  SpecialOffer,
} from '../types';
import { useAuth } from './AuthContext';
import { useBrand } from './BrandContext';
import { posDb } from '../services/db';
import { canAddOfferToCart, computeOfferCostPrice } from '../services/specialOffersService';
import { printReceipt, dispatchDualThermalPrint } from '../utils/thermalPrinter';
import { cashDrawer } from '../utils/cashDrawer';
import {
  roundCurrency,
  roundQty,
  calculateLineItemTotal,
  calculateOrderTotals,
} from '../utils/currency';

export interface POSToast {
  text: string;
  type: 'info' | 'success' | 'warning';
  actionLabel?: string;
  onAction?: () => void;
}

interface POSContextType {
  cartItems: OrderItem[];
  orderType: OrderType;
  setOrderType: (type: OrderType) => void;
  selectedTable: RestaurantTable | null;
  setSelectedTable: (table: RestaurantTable | null) => void;
  selectedCustomer: Customer | null;
  setSelectedCustomer: (customer: Customer | null) => void;
  deliveryFee: number;
  setDeliveryFee: (fee: number) => void;
  discountPercent: number;
  discountFixed: number;
  discountMode: 'percent' | 'fixed';
  setDiscount: (mode: 'percent' | 'fixed', value: number) => void;
  orderNotes: string;
  setOrderNotes: (notes: string) => void;
  addToCart: (
    product: Product,
    quantity?: number,
    modifiers?: SelectedModifier[],
    notes?: string
  ) => void;
  addOfferToCart: (offer: SpecialOffer, quantity?: number, notes?: string) => boolean;
  updateQuantity: (itemId: string, delta: number) => void;
  removeItem: (itemId: string) => void;
  clearCart: () => void;
  cancelCart: () => void;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  serviceChargeAmount: number;
  total: number;
  isSubmittingCheckout: boolean;
  processCheckout: (payments: PaymentItem[]) => Promise<Order>;
  printOrderReceipt: (order: Order) => Promise<boolean>;
  lastCompletedOrder: Order | null;
  isReceiptModalOpen: boolean;
  setIsReceiptModalOpen: (open: boolean) => void;
  viewReceiptForOrder: (order: Order) => void;
  heldOrders: HeldOrder[];
  isHeldOrdersModalOpen: boolean;
  setIsHeldOrdersModalOpen: (open: boolean) => void;
  holdCurrentOrder: () => boolean;
  resumeHeldOrder: (order: HeldOrder) => void;
  deleteHeldOrder: (id: string) => void;
  clearAllHeldOrders: () => void;
  openCashDrawer: () => void;
  posToast: POSToast | null;
  showToast: (
    text: string,
    type?: 'info' | 'success' | 'warning',
    options?: { actionLabel?: string; onAction?: () => void; durationMs?: number }
  ) => void;
}

const POSContext = createContext<POSContextType | undefined>(undefined);

export const POSProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser, currentBranch } = useAuth();
  const { profile } = useBrand();

  const [cartItems, setCartItems] = useState<OrderItem[]>([]);
  const [orderType, setOrderType] = useState<OrderType>('dine_in');
  const [selectedTable, setSelectedTable] = useState<RestaurantTable | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [deliveryFee, setDeliveryFee] = useState<number>(0);
  const [discountMode, setDiscountMode] = useState<'percent' | 'fixed'>('percent');
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [orderNotes, setOrderNotes] = useState<string>('');

  const [lastCompletedOrder, setLastCompletedOrder] = useState<Order | null>(null);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState<boolean>(false);

  const [heldOrders, setHeldOrders] = useState<HeldOrder[]>(() => posDb.getHeldOrders());
  const [isHeldOrdersModalOpen, setIsHeldOrdersModalOpen] = useState<boolean>(false);
  const [posToast, setPosToast] = useState<POSToast | null>(null);
  const [isSubmittingCheckout, setIsSubmittingCheckout] = useState<boolean>(false);
  const checkoutLockRef = useRef<boolean>(false);

  const showToast = (
    text: string,
    type: 'info' | 'success' | 'warning' = 'info',
    options?: { actionLabel?: string; onAction?: () => void; durationMs?: number }
  ) => {
    setPosToast({
      text,
      type,
      actionLabel: options?.actionLabel,
      onAction: options?.onAction,
    });
    const timeout = options?.durationMs ?? (options?.onAction ? 10000 : 3500);
    setTimeout(() => {
      setPosToast((current) => (current?.text === text ? null : current));
    }, timeout);
  };

  const cancelCart = () => {
    if (cartItems.length === 0) {
      showToast('السلة فارغة بالفعل', 'info');
      return;
    }
    clearCart();
    showToast('تم إلغاء الطلب وتفريغ السلة (ESC)', 'warning');
    posDb.logAudit({
      userId: currentUser?.id || 'cashier',
      userName: currentUser?.name || 'كاشير',
      action: 'إلغاء الطلب (ESC)',
      category: 'order',
      details: 'تم تفريغ وإلغاء محتويات السلة عبر اختصار الكاشير ESC',
    });
  };

  const holdCurrentOrder = (): boolean => {
    if (cartItems.length === 0) {
      if (heldOrders.length > 0) {
        setIsHeldOrdersModalOpen(true);
      } else {
        showToast('لا توجد أصناف في السلة لتعليقها (F5)', 'info');
      }
      return false;
    }

    const heldOrder: HeldOrder = {
      id: `held-${Date.now()}`,
      orderNumber: `معلق-${heldOrders.length + 1}`,
      heldAt: new Date().toISOString(),
      orderType,
      tableNumber: selectedTable?.number,
      tableId: selectedTable?.id,
      customerName: selectedCustomer?.name,
      customerId: selectedCustomer?.id,
      customerPhone: selectedCustomer?.phone,
      deliveryAddress: selectedCustomer?.address,
      deliveryFee,
      discountMode,
      discountValue,
      orderNotes,
      items: cartItems,
      subtotal,
      total,
      itemCount: cartItems.length,
    };

    posDb.saveHeldOrder(heldOrder);
    setHeldOrders(posDb.getHeldOrders());
    clearCart();
    showToast(`تم تعليق الطلب (${heldOrder.orderNumber}) بنجاح (F5)`, 'success');
    posDb.logAudit({
      userId: currentUser?.id || 'cashier',
      userName: currentUser?.name || 'كاشير',
      action: 'تعليق الطلب (F5)',
      category: 'order',
      details: `تم تعليق الطلب ${heldOrder.orderNumber} بإجمالي ${total.toFixed(2)} ${profile.currency}`,
    });
    return true;
  };

  const resumeHeldOrder = (order: HeldOrder) => {
    // If current cart already has items, auto-hold it first
    if (cartItems.length > 0) {
      const autoHeld: HeldOrder = {
        id: `held-swap-${Date.now()}`,
        orderNumber: `معلق-${heldOrders.length + 1}`,
        heldAt: new Date().toISOString(),
        orderType,
        tableNumber: selectedTable?.number,
        tableId: selectedTable?.id,
        customerName: selectedCustomer?.name,
        customerId: selectedCustomer?.id,
        customerPhone: selectedCustomer?.phone,
        deliveryAddress: selectedCustomer?.address,
        deliveryFee,
        discountMode,
        discountValue,
        orderNotes,
        items: cartItems,
        subtotal,
        total,
        itemCount: cartItems.length,
      };
      posDb.saveHeldOrder(autoHeld);
    }

    setCartItems(order.items);
    setOrderType(order.orderType);
    setSelectedTable(
      order.tableId ? posDb.getTables().find((t) => t.id === order.tableId) || null : null
    );
    setSelectedCustomer(
      order.customerId ? posDb.getCustomers().find((c) => c.id === order.customerId) || null : null
    );
    setDeliveryFee(order.deliveryFee || 0);
    setDiscountMode(order.discountMode);
    setDiscountValue(order.discountValue);
    setOrderNotes(order.orderNotes || '');

    posDb.removeHeldOrder(order.id);
    setHeldOrders(posDb.getHeldOrders());
    setIsHeldOrdersModalOpen(false);
    showToast(`تم استرجاع الطلب ${order.orderNumber} إلى السلة`, 'success');
  };

  const deleteHeldOrder = (id: string) => {
    posDb.removeHeldOrder(id);
    setHeldOrders(posDb.getHeldOrders());
    showToast('تم حذف الطلب المعلق', 'info');
  };

  const clearAllHeldOrders = () => {
    posDb.clearAllHeldOrders();
    setHeldOrders([]);
    showToast('تم حذف كافة الطلبات المعلقة', 'info');
  };

  const openCashDrawer = () => {
    cashDrawer.triggerOpenDrawer('F9 Shortcut');
    posDb.logAudit({
      userId: currentUser?.id || 'cashier',
      userName: currentUser?.name || 'كاشير',
      action: 'فتح درج النقد (F9)',
      category: 'shift',
      details: 'تم فتح صندوق النقدية يدوياً عبر مفتاح الاختصار F9',
    });
    showToast('تم فتح صندوق النقدية (F9)', 'success');
  };

  const addToCart = (
    product: Product,
    quantity = 1,
    modifiers: SelectedModifier[] = [],
    notes = ''
  ) => {
    // Modifier price additions
    const modTotal = modifiers.reduce((acc, m) => acc + m.priceDelta, 0);
    const unitPrice = roundCurrency(product.price + modTotal);
    const cleanQty = Math.max(0.01, roundQty(quantity));

    // Check if an identical product with the exact same modifiers and notes already exists in cart
    const existingIndex = cartItems.findIndex(
      (item) =>
        item.productId === product.id &&
        item.notes === notes &&
        JSON.stringify(item.selectedModifiers) === JSON.stringify(modifiers)
    );

    if (existingIndex >= 0) {
      setCartItems((prev) => {
        const next = [...prev];
        const nextQty = roundQty(next[existingIndex].quantity + cleanQty);
        next[existingIndex] = {
          ...next[existingIndex],
          quantity: nextQty,
          itemTotal: calculateLineItemTotal(next[existingIndex].unitPrice, 0, nextQty),
        };
        return next;
      });
    } else {
      const resolvedStation = posDb.resolveStationForProductOrItem(
        product.stationId || product.kitchenStation,
        product.id
      );
      const newItem: OrderItem = {
        id: `item-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        productId: product.id,
        productNameAr: product.nameAr,
        productNameEn: product.nameEn,
        unitPrice,
        costPrice: product.costPrice,
        quantity: cleanQty,
        selectedModifiers: modifiers,
        itemTotal: calculateLineItemTotal(unitPrice, 0, cleanQty),
        notes,
        kitchenStation: resolvedStation.id,
        stationId: resolvedStation.id,
        status: 'pending',
      };
      setCartItems((prev) => [...prev, newItem]);
    }
  };

  const addOfferToCart = (offer: SpecialOffer, quantity = 1, notes = ''): boolean => {
    const cleanQty = Math.max(1, Math.round(quantity));
    const currentTotalForOffer = cartItems
      .filter((item) => item.itemType === 'offer' && item.offerId === offer.id)
      .reduce((sum, item) => sum + item.quantity, 0);

    const eligibility = canAddOfferToCart(offer, currentTotalForOffer + cleanQty);
    if (!eligibility.allowed) {
      showToast(eligibility.reason || 'هذا العرض غير متاح حالياً', 'warning');
      return false;
    }

    const existingIndex = cartItems.findIndex(
      (item) =>
        item.itemType === 'offer' &&
        item.offerId === offer.id &&
        (item.notes || '') === notes
    );

    if (existingIndex >= 0) {
      setCartItems((prev) => {
        const next = [...prev];
        const nextQty = roundQty(next[existingIndex].quantity + cleanQty);
        next[existingIndex] = {
          ...next[existingIndex],
          quantity: nextQty,
          itemTotal: calculateLineItemTotal(next[existingIndex].unitPrice, 0, nextQty),
        };
        return next;
      });
      return true;
    }

    const productsMap = new Map(
      posDb.getProducts({ includeArchived: true }).map((p) => [p.id, p])
    );
    const costPrice = computeOfferCostPrice(offer.components, productsMap);
    const firstCompStationId = offer.components[0]?.stationId || 'GRILL_STATION';
    const resolvedStation = posDb.resolveStationForProductOrItem(
      firstCompStationId,
      offer.components[0]?.productId
    );

    const offerItem: OrderItem = {
      id: `offer-item-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      itemType: 'offer',
      offerId: offer.id,
      originalUnitPrice: offer.originalPrice,
      savingsPerUnit: offer.savingsAmount,
      offerComponents: offer.components.map((c) => ({ ...c })),
      productId: `offer:${offer.id}`,
      productNameAr: offer.nameAr,
      productNameEn: offer.nameEn || offer.nameAr,
      unitPrice: offer.offerPrice,
      costPrice,
      quantity: cleanQty,
      selectedModifiers: [],
      itemTotal: calculateLineItemTotal(offer.offerPrice, 0, cleanQty),
      notes,
      kitchenStation: resolvedStation.id,
      stationId: resolvedStation.id,
      status: 'pending',
    };

    setCartItems((prev) => [...prev, offerItem]);
    return true;
  };

  const updateQuantity = (itemId: string, delta: number) => {
    if (delta > 0) {
      const target = cartItems.find((i) => i.id === itemId);
      if (target && target.itemType === 'offer' && target.offerId) {
        const liveOffer = posDb.getOfferById(target.offerId);
        if (!liveOffer) {
          showToast('هذا العرض لم يعد موجوداً في القائمة', 'warning');
          return;
        }
        const totalOfferQty = cartItems
          .filter((i) => i.itemType === 'offer' && i.offerId === target.offerId)
          .reduce((sum, i) => sum + i.quantity, 0);
        const eligibility = canAddOfferToCart(liveOffer, totalOfferQty + delta);
        if (!eligibility.allowed) {
          showToast(eligibility.reason || 'تم الوصول للحد الأقصى المسموح لهذا العرض', 'warning');
          return;
        }
      }
    }

    setCartItems((prev) =>
      prev
        .map((item) => {
          if (item.id === itemId) {
            const newQty = roundQty(item.quantity + delta);
            if (newQty <= 0) return null;
            return {
              ...item,
              quantity: newQty,
              itemTotal: calculateLineItemTotal(item.unitPrice, 0, newQty),
            };
          }
          return item;
        })
        .filter(Boolean) as OrderItem[]
    );
  };

  const removeItem = (itemId: string) => {
    setCartItems((prev) => prev.filter((item) => item.id !== itemId));
  };

  const clearCart = () => {
    setCartItems([]);
    setSelectedTable(null);
    setSelectedCustomer(null);
    setDiscountValue(0);
    setDeliveryFee(0);
    setOrderNotes('');
  };

  const setDiscount = (mode: 'percent' | 'fixed', value: number) => {
    setDiscountMode(mode);
    setDiscountValue(Math.max(0, value));
  };

  // Calculations using exact rounding helper (VAT & Service Charge permanently disabled = 0%)
  const rawSubtotal = roundCurrency(
    cartItems.reduce((acc, item) => acc + (Number(item.itemTotal) || 0), 0)
  );
  const { subtotal, discountAmount, taxAmount, serviceChargeAmount, total } = calculateOrderTotals({
    subtotal: rawSubtotal,
    discountType: discountMode,
    discountValue,
    orderType,
    deliveryFee: orderType === 'delivery' ? deliveryFee : 0,
    taxPercent: 0,
    serviceChargePercent: 0,
  });
  const taxPercent = 0;
  const serviceChargePercent = 0;

  const processCheckout = async (payments: PaymentItem[]): Promise<Order> => {
    if (checkoutLockRef.current) {
      throw new Error('جاري إتمام الطلب بالفعل، يرجى الانتظار لحظة.');
    }
    checkoutLockRef.current = true;
    setIsSubmittingCheckout(true);

    try {
      const normalizedPayments = payments.map((p) => ({
        ...p,
        amount: roundCurrency(p.amount || 0),
      }));
      const paidAmount = roundCurrency(
        normalizedPayments.reduce((acc, p) => acc + p.amount, 0)
      );
      const changeAmount = Math.max(0, roundCurrency(paidAmount - total));

      const orderNumber = `ORD-${Math.floor(1000 + Math.random() * 9000)}`;

      const newOrder: Order = {
        id: `ord-${Date.now()}`,
        orderNumber,
        type: orderType,
        branchId: currentBranch?.id || 'branch-1',
        branchName: currentBranch?.name || 'الفرع الرئيسي',
        cashierId: currentUser?.id || 'cashier',
        cashierName: currentUser?.name || 'كاشير',
        tableNumber: selectedTable?.number,
        tableId: selectedTable?.id,
        customerId: selectedCustomer?.id,
        customerName: selectedCustomer?.name,
        customerPhone: selectedCustomer?.phone,
        deliveryAddress: selectedCustomer?.address,
        deliveryFee: orderType === 'delivery' ? roundCurrency(deliveryFee) : 0,
        items: cartItems,
        subtotal,
        discountType: discountMode,
        discountValue,
        discountAmount,
        taxPercent,
        taxAmount,
        serviceChargePercent,
        serviceChargeAmount,
        total,
        payments: normalizedPayments,
        paidAmount,
        changeAmount,
        status: 'preparing',
        paymentStatus: 'paid',
        channel: 'pos',
        printStatus: 'pending',
        createdAt: new Date().toISOString(),
        prepStartedAt: new Date().toISOString(),
        notes: orderNotes,
      };

      const savedOrder = posDb.createOrder(newOrder);
      setLastCompletedOrder(savedOrder);
      setIsReceiptModalOpen(true);
      clearCart();

      // Immediately trigger silent, non-blocking simultaneous background printing to both printers
      const runDualPrintWithRetry = (targets: { cashier: boolean; kitchen: boolean; isReprint?: boolean }) => {
        void dispatchDualThermalPrint(savedOrder, profile, targets).then((res) => {
          if (res.cashierOk && res.kitchenOk) {
            posDb.updateOrderPrintStatus(savedOrder.id, 'printed');
            posDb.updateOrderKitchenPrintStatus(savedOrder.id, 'printed');
            showToast(
              `تم إرسال الفاتورة لطابعة الكاشير (USB) وبون التجهيز لطابعة المطبخ (LAN) للطلب ${savedOrder.orderNumber}`,
              'success'
            );
          } else {
            if (!res.cashierOk) {
              posDb.updateOrderPrintStatus(savedOrder.id, 'failed');
            } else {
              posDb.updateOrderPrintStatus(savedOrder.id, 'printed');
            }

            if (!res.kitchenOk) {
              const kitchenErr = res.kitchenResult?.errorMessage || res.detailedErrors?.join('، ') || `تعذر الوصول إلى ${res.errors.join('، ')}`;
              posDb.updateOrderKitchenPrintStatus(savedOrder.id, 'failed', kitchenErr);
            } else {
              posDb.updateOrderKitchenPrintStatus(savedOrder.id, 'printed');
            }

            const failureReasons =
              res.detailedErrors && res.detailedErrors.length > 0
                ? res.detailedErrors.join(' | ')
                : res.errors.join(' و ');

            showToast(
              `تم حفظ الطلب ${savedOrder.orderNumber} بنجاح، ولكن تعذر الطباعة: ${failureReasons}`,
              'warning',
              {
                actionLabel: 'إعادة الطباعة (Reprint)',
                durationMs: 14000,
                onAction: async () => {
                  const latestProfile = posDb.getProfile();
                  if (!res.kitchenOk) {
                    const { sharedKitchenPrintQueue } = await import('../printing/core/SharedKitchenPrintQueue');
                    const retryOutcome = await sharedKitchenPrintQueue.retryFailedJobs(latestProfile, savedOrder.id);
                    if (retryOutcome.allOk) {
                      posDb.updateOrderKitchenPrintStatus(savedOrder.id, 'printed');
                    }
                  }
                  if (!res.cashierOk) {
                    runDualPrintWithRetry({
                      cashier: true,
                      kitchen: false,
                      isReprint: true,
                    });
                  } else {
                    const latestOrder = posDb.getOrders().find((o) => o.id === savedOrder.id);
                    if (latestOrder?.kitchenPrintStatus === 'printed') {
                      showToast(`تمت إعادة طباعة تذاكر المحطات المتوقفة للطلب ${savedOrder.orderNumber}`, 'success');
                    }
                  }
                },
              }
            );
          }
        });
      };

      runDualPrintWithRetry({
        cashier: profile.autoPrintReceipt !== false,
        kitchen: profile.kitchenAutoPrint !== false,
      });

      return savedOrder;
    } finally {
      checkoutLockRef.current = false;
      setIsSubmittingCheckout(false);
    }
  };

  const printOrderReceipt = async (order: Order): Promise<boolean> => {
    const { printManager } = await import('../printing/core/PrintManager');
    const res = await printManager.reprintOrder(order, profile, 'cashier', {
      userId: currentUser?.id,
      userName: currentUser?.name,
    });
    if (!res.cashierOk && res.detailedErrors?.length) {
      showToast(res.detailedErrors[0], 'warning');
    }
    return res.cashierOk;
  };

  const viewReceiptForOrder = (order: Order) => {
    setLastCompletedOrder(order);
    setIsReceiptModalOpen(true);
  };

  return (
    <POSContext.Provider
      value={{
        cartItems,
        orderType,
        setOrderType,
        selectedTable,
        setSelectedTable,
        selectedCustomer,
        setSelectedCustomer,
        deliveryFee,
        setDeliveryFee,
        discountPercent: discountMode === 'percent' ? discountValue : 0,
        discountFixed: discountMode === 'fixed' ? discountValue : 0,
        discountMode,
        setDiscount,
        orderNotes,
        setOrderNotes,
        addToCart,
        addOfferToCart,
        updateQuantity,
        removeItem,
        clearCart,
        subtotal,
        discountAmount,
        taxAmount,
        serviceChargeAmount,
        total,
        isSubmittingCheckout,
        processCheckout,
        printOrderReceipt,
        lastCompletedOrder,
        isReceiptModalOpen,
        setIsReceiptModalOpen,
        viewReceiptForOrder,
        cancelCart,
        heldOrders,
        isHeldOrdersModalOpen,
        setIsHeldOrdersModalOpen,
        holdCurrentOrder,
        resumeHeldOrder,
        deleteHeldOrder,
        clearAllHeldOrders,
        openCashDrawer,
        posToast,
        showToast,
      }}
    >
      {children}
    </POSContext.Provider>
  );
};

export const usePOS = (): POSContextType => {
  const context = useContext(POSContext);
  if (!context) {
    throw new Error('usePOS must be used within POSProvider');
  }
  return context;
};
