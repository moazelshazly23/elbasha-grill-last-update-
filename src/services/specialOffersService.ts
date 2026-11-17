import {
  OfferComponent,
  OfferSaleRecord,
  OfferStatus,
  Order,
  OrderItem,
  Product,
  SpecialOffer,
} from '../types';
import { roundCurrency, roundQty } from '../utils/currency';

export interface OfferPricingValidation {
  valid: boolean;
  error?: string;
  originalPrice: number;
  offerPrice: number;
  savingsAmount: number;
  savingsPercent: number;
}

export interface ExpandedOrderComponent {
  productId: string;
  productNameAr: string;
  productNameEn?: string;
  quantity: number;
  stationId?: string;
  unitPrice: number;
  sourceOrderItemId: string;
  sourceOfferId?: string;
  sourceOfferName?: string;
  notes?: string;
  selectedModifiers: OrderItem['selectedModifiers'];
}

export interface OfferReportRow {
  offerId: string;
  offerName: string;
  status: OfferStatus;
  timesSold: number;
  revenue: number;
  originalValue: number;
  totalSavings: number;
}

export interface OffersAnalyticsSummary {
  totalOfferUnitsSold: number;
  totalOfferRevenue: number;
  totalRegularRevenue: number;
  totalOrderRevenueNet: number;
  totalSavingsGranted: number;
  offerSharePercent: number;
  topOffers: OfferReportRow[];
  perOfferRows: OfferReportRow[];
}

/**
 * Calculate summed original price from offer component products and quantities.
 */
export function computeOfferOriginalPrice(
  components: OfferComponent[],
  productsMap?: Map<string, Product>
): number {
  if (!components || components.length === 0) return 0;
  const total = components.reduce((sum, comp) => {
    const prod = productsMap?.get(comp.productId);
    const price = prod ? Number(prod.price) || 0 : Number(comp.unitPrice) || 0;
    const qty = Math.max(0, Number(comp.quantity) || 0);
    return sum + price * qty;
  }, 0);
  return roundCurrency(total);
}

/**
 * Compute total estimated cost price across all offer components for accurate COGS & profit reporting.
 */
export function computeOfferCostPrice(
  components: OfferComponent[],
  productsMap?: Map<string, Product>
): number {
  if (!components || components.length === 0) return 0;
  const total = components.reduce((sum, comp) => {
    const prod = productsMap?.get(comp.productId);
    const cost = prod ? Number(prod.costPrice) || 0 : Number(comp.costPrice) || 0;
    const qty = Math.max(0, Number(comp.quantity) || 0);
    return sum + cost * qty;
  }, 0);
  return roundCurrency(total);
}

/**
 * Compute discount savings and percentage cleanly.
 */
export function computeOfferSavings(
  originalPrice: number,
  offerPrice: number
): { savingsAmount: number; savingsPercent: number } {
  const orig = roundCurrency(Math.max(0, Number(originalPrice) || 0));
  const offer = roundCurrency(Math.max(0, Number(offerPrice) || 0));
  const savingsAmount = roundCurrency(Math.max(0, orig - offer));
  const savingsPercent = orig > 0 ? Math.round((savingsAmount / orig) * 1000) / 10 : 0;
  return { savingsAmount, savingsPercent };
}

/**
 * Validate offer pricing rules to reject negative, zero, or illogical prices.
 */
export function validateOfferPricing(
  originalPrice: number,
  offerPrice: number
): OfferPricingValidation {
  const orig = roundCurrency(Number(originalPrice));
  const offer = roundCurrency(Number(offerPrice));

  if (!Number.isFinite(offer) || offer <= 0) {
    return {
      valid: false,
      error: 'يجب أن يكون سعر العرض أكبر من صفر.',
      originalPrice: Number.isFinite(orig) ? orig : 0,
      offerPrice: 0,
      savingsAmount: 0,
      savingsPercent: 0,
    };
  }

  if (!Number.isFinite(orig) || orig <= 0) {
    return {
      valid: false,
      error: 'السعر الأصلي للعرض غير صالح (تأكد من إضافة أصناف صالحة للعرض).',
      originalPrice: 0,
      offerPrice: offer,
      savingsAmount: 0,
      savingsPercent: 0,
    };
  }

  if (offer > orig) {
    return {
      valid: false,
      error: `سعر العرض (${offer.toFixed(2)}) لا يمكن أن يتجاوز السعر الأصلي (${orig.toFixed(2)}).`,
      originalPrice: orig,
      offerPrice: offer,
      savingsAmount: 0,
      savingsPercent: 0,
    };
  }

  const { savingsAmount, savingsPercent } = computeOfferSavings(orig, offer);
  return {
    valid: true,
    originalPrice: orig,
    offerPrice: offer,
    savingsAmount,
    savingsPercent,
  };
}

function parseMinutesOfDay(hhmm?: string): number | null {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm.trim())) return null;
  const [hStr, mStr] = hhmm.trim().split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

function formatLocalDateYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Determine whether an offer is expired by date window or total redemptions cap.
 */
export function isOfferExpired(offer: SpecialOffer, now: Date = new Date()): boolean {
  if (offer.status === 'expired') return true;

  const todayYmd = formatLocalDateYmd(now);
  if (offer.endDate && offer.endDate.trim() && todayYmd > offer.endDate.trim()) {
    return true;
  }

  if (
    typeof offer.maxTotalRedemptions === 'number' &&
    offer.maxTotalRedemptions > 0 &&
    (offer.currentRedemptions || 0) >= offer.maxTotalRedemptions
  ) {
    return true;
  }

  return false;
}

/**
 * Compute live status label considering schedule & max redemptions without mutating stored offer.
 */
export function getComputedOfferStatus(
  offer: SpecialOffer,
  now: Date = new Date()
): OfferStatus {
  if (offer.status === 'paused') return 'paused';
  if (isOfferExpired(offer, now)) return 'expired';
  return offer.status || 'active';
}

/**
 * Check whether an offer is active and currently eligible for POS sale.
 */
export function isOfferCurrentlyValid(
  offer: SpecialOffer,
  now: Date = new Date()
): { valid: boolean; reason?: string } {
  if (!offer || !offer.components || offer.components.length === 0) {
    return { valid: false, reason: 'العرض لا يحتوي على أصناف' };
  }
  if (offer.status === 'paused') {
    return { valid: false, reason: 'العرض متوقف مؤقتاً' };
  }
  if (offer.status === 'expired') {
    return { valid: false, reason: 'العرض منتهي الصلاحية' };
  }

  const todayYmd = formatLocalDateYmd(now);
  if (offer.startDate && offer.startDate.trim() && todayYmd < offer.startDate.trim()) {
    return { valid: false, reason: `يبدأ العرض في ${offer.startDate}` };
  }
  if (offer.endDate && offer.endDate.trim() && todayYmd > offer.endDate.trim()) {
    return { valid: false, reason: `انتهى العرض في ${offer.endDate}` };
  }

  if (offer.validDays && offer.validDays.length > 0) {
    const dayOfWeek = now.getDay(); // 0=Sun..6=Sat
    if (!offer.validDays.includes(dayOfWeek)) {
      return { valid: false, reason: 'العرض غير متاح في هذا اليوم من الأسبوع' };
    }
  }

  const startMins = parseMinutesOfDay(offer.startTime);
  const endMins = parseMinutesOfDay(offer.endTime);
  if (startMins !== null || endMins !== null) {
    const currentMins = now.getHours() * 60 + now.getMinutes();
    if (startMins !== null && endMins !== null) {
      if (startMins <= endMins) {
        if (currentMins < startMins || currentMins > endMins) {
          return { valid: false, reason: `متاح من ${offer.startTime} إلى ${offer.endTime}` };
        }
      } else {
        // Overnight window e.g. 20:00 -> 02:00
        if (currentMins < startMins && currentMins > endMins) {
          return { valid: false, reason: `متاح من ${offer.startTime} إلى ${offer.endTime}` };
        }
      }
    } else if (startMins !== null && currentMins < startMins) {
      return { valid: false, reason: `يبدأ الساعة ${offer.startTime}` };
    } else if (endMins !== null && currentMins > endMins) {
      return { valid: false, reason: `ينتهي الساعة ${offer.endTime}` };
    }
  }

  if (
    typeof offer.maxTotalRedemptions === 'number' &&
    offer.maxTotalRedemptions > 0 &&
    (offer.currentRedemptions || 0) >= offer.maxTotalRedemptions
  ) {
    return { valid: false, reason: 'تم الوصول للحد الأقصى لاستخدام العرض' };
  }

  return { valid: true };
}

/**
 * Validate adding/incrementing an offer in the POS cart against schedule and limits.
 */
export function canAddOfferToCart(
  offer: SpecialOffer,
  nextQtyInOrder: number,
  now: Date = new Date()
): { allowed: boolean; reason?: string } {
  const validity = isOfferCurrentlyValid(offer, now);
  if (!validity.valid) {
    return { allowed: false, reason: validity.reason };
  }

  if (
    typeof offer.maxPerOrder === 'number' &&
    offer.maxPerOrder > 0 &&
    nextQtyInOrder > offer.maxPerOrder
  ) {
    return {
      allowed: false,
      reason: `الحد الأقصى للعرض "${offer.nameAr}" في الفاتورة الواحدة هو ${offer.maxPerOrder}`,
    };
  }

  if (typeof offer.maxTotalRedemptions === 'number' && offer.maxTotalRedemptions > 0) {
    const remaining = Math.max(0, offer.maxTotalRedemptions - (offer.currentRedemptions || 0));
    if (nextQtyInOrder > remaining) {
      return {
        allowed: false,
        reason: `المتبقي من العرض "${offer.nameAr}" هو ${remaining} فقط`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Expand an OrderItem (regular product OR multi-item offer bundle) into concrete product quantities
 * for accurate recipe inventory deductions and kitchen station routing.
 */
export function expandOrderItemToComponents(
  item: OrderItem,
  productsMap?: Map<string, Product>
): ExpandedOrderComponent[] {
  const itemQty = Math.max(0, Number(item.quantity) || 0);
  if (itemQty <= 0) return [];

  if (item.itemType === 'offer' && Array.isArray(item.offerComponents) && item.offerComponents.length > 0) {
    return item.offerComponents.map((comp) => {
      const linkedProd = productsMap?.get(comp.productId);
      const effectiveQty = roundQty((Number(comp.quantity) || 0) * itemQty);
      return {
        productId: comp.productId,
        productNameAr: linkedProd?.nameAr || comp.productNameAr,
        productNameEn: linkedProd?.nameEn || comp.productNameEn,
        quantity: effectiveQty,
        stationId: comp.stationId || linkedProd?.stationId || linkedProd?.kitchenStation,
        unitPrice: comp.unitPrice ?? linkedProd?.price ?? 0,
        sourceOrderItemId: item.id,
        sourceOfferId: item.offerId,
        sourceOfferName: item.productNameAr,
        notes: item.notes,
        selectedModifiers: item.selectedModifiers || [],
      };
    });
  }

  const linkedProd = productsMap?.get(item.productId);
  return [
    {
      productId: item.productId,
      productNameAr: item.productNameAr,
      productNameEn: item.productNameEn,
      quantity: roundQty(itemQty),
      stationId: item.stationId || item.kitchenStation || linkedProd?.stationId || linkedProd?.kitchenStation,
      unitPrice: item.unitPrice,
      sourceOrderItemId: item.id,
      notes: item.notes,
      selectedModifiers: item.selectedModifiers || [],
    },
  ];
}

/**
 * Format short component summary string for POS Offer cards and Receipts.
 */
export function formatOfferComponentsSummary(
  components: OfferComponent[],
  multiplier = 1
): string {
  if (!components || components.length === 0) return '';
  return components
    .map((c) => `${c.productNameAr} ×${roundQty(c.quantity * multiplier)}`)
    .join(' • ');
}

/**
 * Compute comprehensive Offers Analytics across active (non-cancelled) orders, deducting refunds proportionally.
 */
export function computeOffersAnalytics(
  orders: Order[],
  offers: SpecialOffer[],
  _offerSales?: OfferSaleRecord[]
): OffersAnalyticsSummary {
  const offersById = new Map(offers.map((o) => [o.id, o]));
  const rowMap = new Map<string, OfferReportRow>();

  // Pre-seed known offers with 0 counters so unused offers are still inspectable in management table if desired
  offers.forEach((offer) => {
    rowMap.set(offer.id, {
      offerId: offer.id,
      offerName: offer.nameAr,
      status: getComputedOfferStatus(offer),
      timesSold: 0,
      revenue: 0,
      originalValue: 0,
      totalSavings: 0,
    });
  });

  let totalOfferUnitsSold = 0;
  let totalOfferRevenue = 0;
  let totalRegularRevenue = 0;
  let totalOrderRevenueNet = 0;
  let totalSavingsGranted = 0;

  orders.forEach((order) => {
    if (order.status === 'cancelled') return;
    const refundedAmt = Number(order.refundedAmount) || 0;
    if (order.status === 'refunded' && refundedAmt >= order.total) return;

    const netRatio =
      order.total > 0 ? Math.max(0, order.total - refundedAmt) / order.total : 1;
    const activeItems = (order.items || []).filter(
      (it) => !it.cancelled && it.status !== 'cancelled'
    );

    const orderItemsSubtotal = activeItems.reduce(
      (s, it) => s + (Number(it.itemTotal) || 0),
      0
    );
    const effectiveOrderSubtotal = Math.max(0, orderItemsSubtotal * netRatio);
    totalOrderRevenueNet = roundCurrency(
      totalOrderRevenueNet + Math.max(0, order.total - refundedAmt)
    );

    activeItems.forEach((item) => {
      const itemNetRev = roundCurrency((Number(item.itemTotal) || 0) * netRatio);
      if (item.itemType === 'offer') {
        const oid = item.offerId || item.productId.replace(/^offer:/, '');
        const existingOffer = offersById.get(oid);
        const origPerUnit = Number(item.originalUnitPrice ?? existingOffer?.originalPrice ?? item.unitPrice);
        const savingsPerUnit = Math.max(
          0,
          Number(item.savingsPerUnit ?? roundCurrency(origPerUnit - item.unitPrice))
        );
        const qty = Number(item.quantity) || 0;
        const scaledQty = roundQty(qty * netRatio);
        const itemOrigVal = roundCurrency(origPerUnit * scaledQty);
        const itemSavings = roundCurrency(savingsPerUnit * scaledQty);

        totalOfferUnitsSold = roundQty(totalOfferUnitsSold + scaledQty);
        totalOfferRevenue = roundCurrency(totalOfferRevenue + itemNetRev);
        totalSavingsGranted = roundCurrency(totalSavingsGranted + itemSavings);

        const prev = rowMap.get(oid) || {
          offerId: oid,
          offerName: existingOffer?.nameAr || item.productNameAr,
          status: existingOffer ? getComputedOfferStatus(existingOffer) : ('active' as OfferStatus),
          timesSold: 0,
          revenue: 0,
          originalValue: 0,
          totalSavings: 0,
        };
        rowMap.set(oid, {
          ...prev,
          timesSold: roundQty(prev.timesSold + scaledQty),
          revenue: roundCurrency(prev.revenue + itemNetRev),
          originalValue: roundCurrency(prev.originalValue + itemOrigVal),
          totalSavings: roundCurrency(prev.totalSavings + itemSavings),
        });
      } else {
        totalRegularRevenue = roundCurrency(totalRegularRevenue + itemNetRev);
      }
    });

    // Guard unused variable check: keep effectiveOrderSubtotal conceptually balanced
    void effectiveOrderSubtotal;
  });

  const allRows = Array.from(rowMap.values()).sort((a, b) => {
    if (b.revenue !== a.revenue) return b.revenue - a.revenue;
    return b.timesSold - a.timesSold;
  });

  const topOffers = allRows.filter((r) => r.timesSold > 0).slice(0, 5);
  const combinedItemsRev = totalOfferRevenue + totalRegularRevenue;
  const offerSharePercent =
    combinedItemsRev > 0 ? Math.round((totalOfferRevenue / combinedItemsRev) * 1000) / 10 : 0;

  return {
    totalOfferUnitsSold,
    totalOfferRevenue,
    totalRegularRevenue,
    totalOrderRevenueNet,
    totalSavingsGranted,
    offerSharePercent,
    topOffers,
    perOfferRows: allRows,
  };
}
