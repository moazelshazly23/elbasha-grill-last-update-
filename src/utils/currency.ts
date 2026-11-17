/**
 * Financial & Quantity Rounding Utilities for El Basha Grill POS
 * Prevents IEEE-754 floating point drift across cart, discounts, payments, refunds, and reports.
 */

export function roundCurrency(value: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

export function roundQty(value: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 1000) / 1000;
}

export function calculateLineItemTotal(
  unitPrice: number,
  modifiersDelta: number,
  quantity: number
): number {
  const safeUnit = roundCurrency(unitPrice);
  const safeMods = roundCurrency(modifiersDelta);
  const safeQty = Math.max(0, roundQty(quantity));
  return roundCurrency((safeUnit + safeMods) * safeQty);
}

export interface OrderFinancialInput {
  subtotal: number;
  discountType?: 'percent' | 'fixed';
  discountValue?: number;
  deliveryFee?: number;
  orderType?: 'dine_in' | 'takeaway' | 'delivery' | 'pickup';
  taxPercent?: number;
  serviceChargePercent?: number;
}

export interface OrderFinancialSummary {
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  serviceChargeAmount: number;
  deliveryFee: number;
  total: number;
}

export function calculateOrderTotals(input: OrderFinancialInput): OrderFinancialSummary {
  const subtotal = Math.max(0, roundCurrency(input.subtotal));
  const rawDiscountVal = Math.max(0, Number(input.discountValue) || 0);

  let discountAmount = 0;
  if (input.discountType === 'percent') {
    const pct = Math.min(100, rawDiscountVal);
    discountAmount = roundCurrency((subtotal * pct) / 100);
  } else {
    discountAmount = roundCurrency(Math.min(subtotal, rawDiscountVal));
  }

  const afterDiscount = Math.max(0, roundCurrency(subtotal - discountAmount));
  const taxPct = Math.max(0, Number(input.taxPercent) || 0);
  const svcPct = Math.max(0, Number(input.serviceChargePercent) || 0);
  const taxAmount = roundCurrency((afterDiscount * taxPct) / 100);
  const serviceChargeAmount = roundCurrency((afterDiscount * svcPct) / 100);
  const deliveryFee =
    input.orderType === 'delivery' ? Math.max(0, roundCurrency(input.deliveryFee || 0)) : 0;

  const total = Math.max(
    0,
    roundCurrency(afterDiscount + taxAmount + serviceChargeAmount + deliveryFee)
  );

  return {
    subtotal,
    discountAmount,
    taxAmount,
    serviceChargeAmount,
    deliveryFee,
    total,
  };
}
