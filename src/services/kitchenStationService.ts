import {
  CancellationRecord,
  KitchenModificationDiff,
  KitchenModificationRecord,
  KitchenStation,
  KitchenStationStatus,
  KitchenTicket,
  KitchenTicketItem,
  Order,
  OrderItem,
  OrderStationState,
  RestaurantProfile,
} from '../types';
import { posDb } from './db';
import { sharedKitchenPrintQueue, SharedBatchPrintOutcome } from '../printing/core/SharedKitchenPrintQueue';
import { calculateLineItemTotal, calculateOrderTotals, roundCurrency, roundQty } from '../utils/currency';
import { expandOrderItemToComponents, ExpandedOrderComponent } from './specialOffersService';

export interface SplitOrderResult {
  orderBatchId: string;
  tickets: KitchenTicket[];
  stationStates: OrderStationState[];
}

export interface ModifyOrderKitchenResult {
  success: boolean;
  requiresApproval?: boolean;
  warningStations?: string[];
  message: string;
  order?: Order;
  modificationRecord?: KitchenModificationRecord;
  tickets?: KitchenTicket[];
  printOutcomePromise?: Promise<SharedBatchPrintOutcome>;
}

export interface CancelOrderKitchenResult {
  success: boolean;
  message: string;
  order?: Order;
  cancellationRecord?: CancellationRecord;
  tickets?: KitchenTicket[];
  printOutcomePromise?: Promise<SharedBatchPrintOutcome>;
}

export function getStationStatusLabelAr(status: KitchenStationStatus): string {
  switch (status) {
    case 'NEW':
      return 'جديد';
    case 'PRINTED':
      return 'تمت الطباعة';
    case 'PREPARING':
      return 'قيد التحضير';
    case 'READY':
      return 'جاهز';
    case 'CANCELLED':
      return 'ملغي';
    default:
      return 'جديد';
  }
}

export function formatOrderStationSummary(order: Order): string {
  const states = order.stationStates || [];
  if (states.length === 0) return 'لم يوزع على المحطات';
  return states.map((s) => `${s.stationNameAr}: ${getStationStatusLabelAr(s.status)}`).join(' • ');
}

/**
 * Group an order's active items strictly by configured Kitchen Station.
 * Multi-item offers are automatically expanded into their constituent products and routed per station.
 * Each ticket contains ONLY the items assigned to that station.
 */
export function splitOrderByStations(
  order: Order,
  _profile?: RestaurantProfile,
  options?: { orderBatchId?: string }
): SplitOrderResult {
  const orderBatchId = options?.orderBatchId || `batch-${order.id}-${Date.now()}`;
  const activeItems = (order.items || []).filter((it) => !it.cancelled && it.status !== 'cancelled');
  const productsMap = new Map(posDb.getProducts({ includeArchived: true }).map((p) => [p.id, p]));
  const grouped = new Map<string, { station: KitchenStation; components: ExpandedOrderComponent[] }>();

  activeItems.forEach((item) => {
    const expandedList = expandOrderItemToComponents(item, productsMap);
    expandedList.forEach((comp) => {
      const station = posDb.resolveStationForProductOrItem(comp.stationId, comp.productId);
      const existing = grouped.get(station.id);
      if (existing) {
        existing.components.push(comp);
      } else {
        grouped.set(station.id, { station, components: [comp] });
      }
    });
  });

  const sortedGroups = Array.from(grouped.values()).sort(
    (a, b) => (a.station.sortOrder || 0) - (b.station.sortOrder || 0)
  );
  const total = sortedGroups.length;
  const now = new Date().toISOString();

  const tickets: KitchenTicket[] = sortedGroups.map((grp, idx) => {
    const seqNum = idx + 1;
    const seqLabel = `${seqNum}/${total}`;
    const ticketItems: KitchenTicketItem[] = grp.components.map((comp) => ({
      orderItemId: comp.sourceOrderItemId,
      productId: comp.productId,
      productNameAr: comp.productNameAr,
      productNameEn: comp.productNameEn,
      quantity: comp.quantity,
      selectedModifiers: comp.selectedModifiers,
      notes: comp.notes,
      sourceOfferId: comp.sourceOfferId,
      sourceOfferName: comp.sourceOfferName,
    }));

    return {
      id: `ktk-${order.id}-${grp.station.id}-NEW-${Date.now()}-${seqNum}`,
      orderId: order.id,
      orderNumber: order.orderNumber,
      orderBatchId,
      stationId: grp.station.id,
      stationCode: grp.station.code,
      stationNameAr: grp.station.nameAr,
      stationNameEn: grp.station.nameEn,
      chefLeadName: grp.station.chefLeadName,
      ticketType: 'NEW',
      sequenceIndex: seqNum,
      sequenceTotal: total,
      sequenceLabel: seqLabel,
      status: 'NEW',
      printStatus: 'pending',
      reprintCount: 0,
      orderType: order.type,
      tableNumber: order.tableNumber,
      orderTime: order.createdAt || now,
      orderNotes: order.notes,
      items: ticketItems,
      actorUserId: order.cashierId,
      actorUserName: order.cashierName,
      createdAt: now,
    };
  });

  const stationStates: OrderStationState[] = tickets.map((tk) => ({
    stationId: tk.stationId,
    stationCode: tk.stationCode,
    stationNameAr: tk.stationNameAr,
    stationNameEn: tk.stationNameEn,
    status: 'NEW',
    latestTicketId: tk.id,
    printStatus: 'pending',
    updatedAt: now,
  }));

  return { orderBatchId, tickets, stationStates };
}

/**
 * Split order across stations (idempotent per order NEW batch) and enqueue all station tickets
 * onto the single shared kitchen printer queue.
 */
export async function createAndDispatchOrderTickets(
  order: Order,
  profile: RestaurantProfile,
  options?: { isReprint?: boolean; dedupePrefix?: string }
): Promise<{
  tickets: KitchenTicket[];
  outcome: SharedBatchPrintOutcome;
}> {
  const existingNewTickets = posDb
    .getKitchenTickets({ orderId: order.id })
    .filter((t) => t.ticketType === 'NEW')
    .sort((a, b) => a.sequenceIndex - b.sequenceIndex);

  let ticketsToEnqueue: KitchenTicket[];
  if (existingNewTickets.length > 0) {
    ticketsToEnqueue = existingNewTickets;
  } else {
    const split = splitOrderByStations(order, profile);
    ticketsToEnqueue = split.tickets;
    if (ticketsToEnqueue.length > 0) {
      posDb.saveKitchenTicketsBatch(ticketsToEnqueue);
      const latestOrder = posDb.getOrders().find((o) => o.id === order.id) || order;
      posDb.saveUpdatedOrder({
        ...latestOrder,
        stationStates: split.stationStates,
        overallKitchenStatus: posDb.computeOverallKitchenStatus(split.stationStates),
      });
    }
  }

  if (ticketsToEnqueue.length === 0) {
    return {
      tickets: [],
      outcome: {
        allOk: true,
        totalJobs: 0,
        completedCount: 0,
        failedCount: 0,
        results: [],
      },
    };
  }

  const { resultsPromise } = sharedKitchenPrintQueue.enqueueTickets(ticketsToEnqueue, profile, {
    isReprint: options?.isReprint,
    dedupePrefix: options?.dedupePrefix || 'order-new',
  });
  const outcome = await resultsPromise;
  return {
    tickets: posDb.getKitchenTickets({ orderId: order.id }),
    outcome,
  };
}

/**
 * Modify an existing order and print ONLY incremental changes (ADD / REMOVE / CHANGE)
 * to ONLY the affected kitchen stations.
 * Enforces explicit warning + approval if an affected station is already PREPARING or READY.
 */
export async function modifyOrderWithKitchenDiff(params: {
  orderId: string;
  nextItems: OrderItem[];
  orderNotes?: string;
  reason: string;
  employeeId: string;
  employeeName: string;
  approvedBy?: string;
  approvePreparingEdit?: boolean;
  restockUnusedIngredients?: boolean;
  profile: RestaurantProfile;
}): Promise<ModifyOrderKitchenResult> {
  const order = posDb.getOrders().find((o) => o.id === params.orderId);
  if (!order) {
    return { success: false, message: 'الطلب غير موجود' };
  }
  if (order.status === 'cancelled' || order.status === 'refunded') {
    return { success: false, message: 'لا يمكن تعديل طلب ملغي أو مسترد' };
  }
  if (!params.reason?.trim()) {
    return { success: false, message: 'يرجى إدخال سبب التعديل لتوثيق السجل' };
  }

  const activeOldItems = order.items.filter((it) => !it.cancelled && it.status !== 'cancelled');
  const activeNewItems = params.nextItems.filter((it) => !it.cancelled && it.status !== 'cancelled' && it.quantity > 0);

  const keyFor = (it: OrderItem) =>
    `${it.productId}::${JSON.stringify(it.selectedModifiers || [])}::${(it.notes || '').trim()}`;

  const oldMap = new Map<string, OrderItem>();
  activeOldItems.forEach((it) => {
    const k = it.id || keyFor(it);
    oldMap.set(k, it);
  });

  const diffs: KitchenModificationDiff[] = [];
  const inventoryDeltas: Array<{ productId: string; quantityDelta: number }> = [];
  const matchedOldKeys = new Set<string>();
  const productsMap = new Map(posDb.getProducts({ includeArchived: true }).map((p) => [p.id, p]));

  // 1. Inspect new items for ADD or CHANGE (expanding offers cleanly per station)
  activeNewItems.forEach((newIt) => {
    let matchedKey: string | undefined;
    if (newIt.id && oldMap.has(newIt.id)) {
      matchedKey = newIt.id;
    } else {
      for (const [k, oldIt] of oldMap.entries()) {
        if (!matchedOldKeys.has(k) && keyFor(oldIt) === keyFor(newIt)) {
          matchedKey = k;
          break;
        }
      }
    }

    const expandedNew = expandOrderItemToComponents(newIt, productsMap);

    if (!matchedKey) {
      expandedNew.forEach((comp) => {
        const station = posDb.resolveStationForProductOrItem(comp.stationId, comp.productId);
        diffs.push({
          orderItemId: comp.sourceOrderItemId,
          productId: comp.productId,
          productNameAr: comp.productNameAr,
          stationId: station.id,
          stationNameAr: station.nameAr,
          changeType: 'ADD',
          oldQuantity: 0,
          newQuantity: comp.quantity,
          notes: comp.notes,
          selectedModifiers: comp.selectedModifiers,
          sourceOfferId: comp.sourceOfferId,
          sourceOfferName: comp.sourceOfferName,
        });
        inventoryDeltas.push({ productId: comp.productId, quantityDelta: comp.quantity });
      });
    } else {
      matchedOldKeys.add(matchedKey);
      const oldIt = oldMap.get(matchedKey)!;
      const qtyDelta = roundQty(newIt.quantity - oldIt.quantity);
      const notesChanged = (newIt.notes || '').trim() !== (oldIt.notes || '').trim();
      const modsChanged =
        JSON.stringify(newIt.selectedModifiers || []) !== JSON.stringify(oldIt.selectedModifiers || []);

      if (Math.abs(qtyDelta) > 0.0001 || notesChanged || modsChanged) {
        const expandedOld = expandOrderItemToComponents(oldIt, productsMap);
        expandedNew.forEach((comp, idx) => {
          const oldCompQty = expandedOld[idx]?.quantity ?? 0;
          const compDelta = roundQty(comp.quantity - oldCompQty);
          const station = posDb.resolveStationForProductOrItem(comp.stationId, comp.productId);
          diffs.push({
            orderItemId: newIt.id || oldIt.id,
            productId: comp.productId,
            productNameAr: comp.productNameAr,
            stationId: station.id,
            stationNameAr: station.nameAr,
            changeType: 'CHANGE',
            oldQuantity: oldCompQty,
            newQuantity: comp.quantity,
            notes: comp.notes,
            selectedModifiers: comp.selectedModifiers,
            sourceOfferId: comp.sourceOfferId,
            sourceOfferName: comp.sourceOfferName,
          });
          if (Math.abs(compDelta) > 0.0001) {
            inventoryDeltas.push({ productId: comp.productId, quantityDelta: compDelta });
          }
        });
      }
    }
  });

  // 2. Inspect removed items
  oldMap.forEach((oldIt, k) => {
    if (!matchedOldKeys.has(k)) {
      const expandedOld = expandOrderItemToComponents(oldIt, productsMap);
      expandedOld.forEach((comp) => {
        const station = posDb.resolveStationForProductOrItem(comp.stationId, comp.productId);
        diffs.push({
          orderItemId: comp.sourceOrderItemId,
          productId: comp.productId,
          productNameAr: comp.productNameAr,
          stationId: station.id,
          stationNameAr: station.nameAr,
          changeType: 'REMOVE',
          oldQuantity: comp.quantity,
          newQuantity: 0,
          notes: comp.notes,
          selectedModifiers: comp.selectedModifiers,
          sourceOfferId: comp.sourceOfferId,
          sourceOfferName: comp.sourceOfferName,
        });
        inventoryDeltas.push({ productId: comp.productId, quantityDelta: -comp.quantity });
      });
    }
  });

  if (diffs.length === 0 && (params.orderNotes || '') === (order.notes || '')) {
    return { success: false, message: 'لا توجد أي تغييرات على أصناف الطلب لإرسالها للمطبخ' };
  }

  // 3. Check PREPARING / READY approval policy
  const affectedStationIds = Array.from(new Set(diffs.map((d) => d.stationId)));
  const existingStates = order.stationStates || [];
  const warningStates = existingStates.filter(
    (s) => affectedStationIds.includes(s.stationId) && (s.status === 'PREPARING' || s.status === 'READY')
  );
  const hadPreparingWarning = warningStates.length > 0;

  if (hadPreparingWarning && !params.approvePreparingEdit) {
    const names = warningStates.map((s) => `${s.stationNameAr} (${getStationStatusLabelAr(s.status)})`).join('، ');
    return {
      success: false,
      requiresApproval: true,
      warningStations: warningStates.map((s) => s.stationNameAr),
      message: `تنبيه: المحطات التالية بدأت التحضير أو أصبحت جاهزة بالفعل: ${names}. يلزم تأكيد الموافقة على التعديل قبل الإرسال للمطبخ.`,
    };
  }

  // 4. Net inventory update without double deduction
  const safeInventoryDeltas = inventoryDeltas.filter((d) => {
    if (d.quantityDelta > 0) return true; // always deduct net added qty
    // Negative delta (removed/reduced): restock only if not yet preparing OR explicitly requested as unused
    return !hadPreparingWarning || Boolean(params.restockUnusedIngredients);
  });
  posDb.applyIncrementalRecipeInventoryDelta(
    safeInventoryDeltas,
    `تعديل الطلب ${order.orderNumber} (${params.reason})`,
    params.employeeId,
    params.employeeName
  );

  // 5. Rebuild order items (preserving cancelled audit items) & recalculate financials
  const cancelledHistoricalItems = order.items.filter((it) => it.cancelled || it.status === 'cancelled');
  const normalizedActiveItems: OrderItem[] = activeNewItems.map((it) => {
    const station = posDb.resolveStationForProductOrItem(it.stationId || it.kitchenStation, it.productId);
    return {
      ...it,
      kitchenStation: station.id,
      stationId: station.id,
      itemTotal: calculateLineItemTotal(it.unitPrice, 0, it.quantity),
      status: it.status === 'cancelled' ? 'pending' : it.status || 'pending',
    };
  });

  const newSubtotal = roundCurrency(
    normalizedActiveItems.reduce((sum, it) => sum + (Number(it.itemTotal) || 0), 0)
  );
  const totals = calculateOrderTotals({
    subtotal: newSubtotal,
    discountType: order.discountType || 'fixed',
    discountValue:
      order.discountType === 'percent' ? order.discountValue || 0 : order.discountAmount || 0,
    orderType: order.type,
    deliveryFee: order.deliveryFee || 0,
    taxPercent: 0,
    serviceChargePercent: 0,
  });

  const oldTotal = roundCurrency(order.total);
  const totalDelta = roundCurrency(totals.total - oldTotal);
  if (order.paymentStatus === 'paid' && Math.abs(totalDelta) > 0.009) {
    const primaryMethod = order.payments?.[0]?.method || 'cash';
    posDb.applyShiftSalesAdjustment(totalDelta, primaryMethod, 0);
  }

  const now = new Date().toISOString();

  // 6. Group ONLY diffs by affected station -> produce incremental MODIFICATION tickets
  const diffsByStation = new Map<string, KitchenModificationDiff[]>();
  diffs.forEach((d) => {
    const list = diffsByStation.get(d.stationId) || [];
    list.push(d);
    diffsByStation.set(d.stationId, list);
  });

  const stationsMap = new Map(posDb.getKitchenStations().map((s) => [s.id, s]));
  const modBatchId = `mod-${order.id}-${Date.now()}`;
  const affectedStationsList = Array.from(diffsByStation.keys()).sort((a, b) => {
    const sa = stationsMap.get(a)?.sortOrder ?? 99;
    const sb = stationsMap.get(b)?.sortOrder ?? 99;
    return sa - sb;
  });

  const modTickets: KitchenTicket[] = affectedStationsList.map((stationId, idx) => {
    const station = posDb.resolveStationForProductOrItem(stationId);
    const stationDiffs = diffsByStation.get(stationId) || [];
    const seqNum = idx + 1;
    const seqTotal = affectedStationsList.length;

    const ticketItems: KitchenTicketItem[] = stationDiffs.map((d) => ({
      orderItemId: d.orderItemId,
      productId: d.productId,
      productNameAr: d.productNameAr,
      quantity: d.changeType === 'REMOVE' ? d.oldQuantity : d.newQuantity,
      previousQuantity: d.changeType === 'CHANGE' ? d.oldQuantity : undefined,
      action: d.changeType,
      selectedModifiers: d.selectedModifiers,
      notes: d.notes,
      sourceOfferId: d.sourceOfferId,
      sourceOfferName: d.sourceOfferName,
    }));

    return {
      id: `ktk-${order.id}-${station.id}-MOD-${Date.now()}-${seqNum}`,
      orderId: order.id,
      orderNumber: order.orderNumber,
      orderBatchId: modBatchId,
      stationId: station.id,
      stationCode: station.code,
      stationNameAr: station.nameAr,
      stationNameEn: station.nameEn,
      ticketType: 'MODIFICATION',
      sequenceIndex: seqNum,
      sequenceTotal: seqTotal,
      sequenceLabel: `${seqNum}/${seqTotal}`,
      status: 'NEW',
      printStatus: 'pending',
      reprintCount: 0,
      orderType: order.type,
      tableNumber: order.tableNumber,
      orderTime: now,
      orderNotes: params.orderNotes ?? order.notes,
      items: ticketItems,
      modificationSummary: params.reason,
      actorUserId: params.employeeId,
      actorUserName: params.employeeName,
      createdAt: now,
    };
  });

  // Update order station states (new stations added, modified stations reset from READY -> PREPARING/NEW)
  const nextStationStates: OrderStationState[] = [...existingStates];
  const activeStationIdSet = new Set<string>();
  normalizedActiveItems.forEach((it) => {
    expandOrderItemToComponents(it, productsMap).forEach((comp) => {
      const st = posDb.resolveStationForProductOrItem(comp.stationId, comp.productId);
      activeStationIdSet.add(st.id);
      if (!nextStationStates.some((s) => s.stationId === st.id)) {
        nextStationStates.push({
          stationId: st.id,
          stationCode: st.code,
          stationNameAr: st.nameAr,
          stationNameEn: st.nameEn,
          status: 'NEW',
          printStatus: 'pending',
          updatedAt: now,
          updatedBy: params.employeeName,
        });
      }
    });
  });
  affectedStationsList.forEach((stId) => {
    const tk = modTickets.find((t) => t.stationId === stId);
    const stIdx = nextStationStates.findIndex((s) => s.stationId === stId);
    const stillHasActiveItems = activeStationIdSet.has(stId);
    const nextStatus: KitchenStationStatus = !stillHasActiveItems
      ? 'CANCELLED'
      : nextStationStates[stIdx]?.status === 'READY'
      ? 'PREPARING'
      : nextStationStates[stIdx]?.status || 'NEW';
    if (stIdx >= 0) {
      nextStationStates[stIdx] = {
        ...nextStationStates[stIdx],
        status: nextStatus,
        latestTicketId: tk?.id || nextStationStates[stIdx].latestTicketId,
        printStatus: tk ? 'pending' : nextStationStates[stIdx].printStatus,
        updatedAt: now,
        updatedBy: params.employeeName,
      };
    }
  });

  const overallKitchenStatus = posDb.computeOverallKitchenStatus(nextStationStates);
  const updatedOrder: Order = {
    ...order,
    items: [...normalizedActiveItems, ...cancelledHistoricalItems],
    notes: params.orderNotes ?? order.notes,
    subtotal: totals.subtotal,
    discountAmount: totals.discountAmount,
    total: totals.total,
    paidAmount: order.paymentStatus === 'paid' ? totals.total : order.paidAmount,
    changeAmount: order.paymentStatus === 'paid' ? 0 : order.changeAmount,
    stationStates: nextStationStates,
    overallKitchenStatus,
    status:
      overallKitchenStatus === 'READY'
        ? 'ready'
        : overallKitchenStatus === 'CANCELLED'
        ? 'cancelled'
        : 'preparing',
    updatedAt: now,
  };

  posDb.saveUpdatedOrder(updatedOrder);

  const modificationRecord: KitchenModificationRecord = {
    id: `kmod-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    orderId: order.id,
    orderNumber: order.orderNumber,
    reason: params.reason,
    employeeId: params.employeeId,
    employeeName: params.employeeName,
    approvedBy: params.approvedBy || (hadPreparingWarning ? params.employeeName : undefined),
    hadPreparingWarning,
    restockedUnusedIngredients: Boolean(params.restockUnusedIngredients),
    diffs,
    affectedStationIds: affectedStationsList,
    generatedTicketIds: modTickets.map((t) => t.id),
    createdAt: now,
  };
  posDb.saveKitchenModification(modificationRecord);

  if (modTickets.length > 0) {
    posDb.saveKitchenTicketsBatch(modTickets);
  }

  posDb.logAudit({
    userId: params.employeeId,
    userName: params.employeeName,
    action: 'تعديل طلب وإرسال فروقات المحطات',
    category: 'order',
    details: `الطلب ${order.orderNumber} | السبب: ${params.reason} | المحطات المتأثرة: ${affectedStationsList.join(', ')}`,
  });

  let printOutcomePromise: Promise<SharedBatchPrintOutcome> | undefined;
  if (modTickets.length > 0) {
    const enq = sharedKitchenPrintQueue.enqueueTickets(modTickets, params.profile, {
      dedupePrefix: `mod-${modificationRecord.id}`,
    });
    printOutcomePromise = enq.resultsPromise;
  }

  return {
    success: true,
    message: `تم تعديل الطلب ${order.orderNumber} وإرسال تذاكر التعديل إلى ${modTickets.length} محطة متأثرة فقط`,
    order: updatedOrder,
    modificationRecord,
    tickets: modTickets,
    printOutcomePromise,
  };
}

/**
 * Cancel a single item OR entire order cleanly with audit trail, reason, inventory decision,
 * order preservation in DB, and CANCELLED ticket printing ONLY to affected stations already notified.
 */
export async function cancelOrderOrItemWithKitchenWorkflow(params: {
  orderId: string;
  scope: 'item' | 'order';
  orderItemId?: string;
  reason: string;
  employeeId: string;
  employeeName: string;
  approvedBy?: string;
  restockIfPreparing?: boolean;
  profile: RestaurantProfile;
}): Promise<CancelOrderKitchenResult> {
  const order = posDb.getOrders().find((o) => o.id === params.orderId);
  if (!order) {
    return { success: false, message: 'الطلب غير موجود' };
  }
  if (order.status === 'cancelled' || order.status === 'refunded') {
    return { success: false, message: 'الطلب ملغي أو مسترد بالفعل' };
  }
  if (!params.reason?.trim()) {
    return { success: false, message: 'يرجى إدخال سبب الإلغاء الإلزامي' };
  }

  const now = new Date().toISOString();
  const existingTickets = posDb.getKitchenTickets({ orderId: order.id });
  const existingStates = [...(order.stationStates || [])];

  const productsMap = new Map(posDb.getProducts({ includeArchived: true }).map((p) => [p.id, p]));

  if (params.scope === 'item') {
    const targetItem = order.items.find((it) => it.id === params.orderItemId && !it.cancelled && it.status !== 'cancelled');
    if (!targetItem) {
      return { success: false, message: 'الصنف المحدد غير موجود أو ملغي بالفعل' };
    }

    const activeRemainingBefore = order.items.filter((it) => !it.cancelled && it.status !== 'cancelled');
    if (activeRemainingBefore.length <= 1) {
      // Last active item in order -> cancel whole order via full cancellation flow
      return cancelOrderOrItemWithKitchenWorkflow({
        ...params,
        scope: 'order',
      });
    }

    const expandedTarget = expandOrderItemToComponents(targetItem, productsMap);
    const affectedStationsMap = new Map<string, { station: KitchenStation; components: ExpandedOrderComponent[] }>();
    expandedTarget.forEach((comp) => {
      const st = posDb.resolveStationForProductOrItem(comp.stationId, comp.productId);
      const grp = affectedStationsMap.get(st.id);
      if (grp) grp.components.push(comp);
      else affectedStationsMap.set(st.id, { station: st, components: [comp] });
    });
    const affectedStationIds = Array.from(affectedStationsMap.keys());

    const wasPreparingOrReady =
      affectedStationIds.some((stId) => {
        const stState = existingStates.find((s) => s.stationId === stId);
        return stState?.status === 'PREPARING' || stState?.status === 'READY';
      }) ||
      targetItem.status === 'preparing' ||
      targetItem.status === 'ready';

    const shouldRestock = !wasPreparingOrReady || Boolean(params.restockIfPreparing);
    if (shouldRestock) {
      posDb.applyIncrementalRecipeInventoryDelta(
        expandedTarget.map((c) => ({ productId: c.productId, quantityDelta: -c.quantity })),
        `إلغاء صنف ${targetItem.productNameAr} من الطلب ${order.orderNumber} (${params.reason})`,
        params.employeeId,
        params.employeeName
      );
    }

    const updatedItems: OrderItem[] = order.items.map((it) =>
      it.id === targetItem.id
        ? {
            ...it,
            cancelled: true,
            status: 'cancelled',
            cancelledAt: now,
            cancelledBy: params.employeeName,
            cancelReason: params.reason,
          }
        : it
    );

    const activeAfter = updatedItems.filter((it) => !it.cancelled && it.status !== 'cancelled');
    const activeAfterStations = new Set<string>();
    activeAfter.forEach((it) => {
      expandOrderItemToComponents(it, productsMap).forEach((c) => {
        activeAfterStations.add(posDb.resolveStationForProductOrItem(c.stationId, c.productId).id);
      });
    });

    const newSubtotal = roundCurrency(activeAfter.reduce((sum, it) => sum + (Number(it.itemTotal) || 0), 0));
    const totals = calculateOrderTotals({
      subtotal: newSubtotal,
      discountType: order.discountType || 'fixed',
      discountValue:
        order.discountType === 'percent' ? order.discountValue || 0 : Math.min(order.discountAmount || 0, newSubtotal),
      orderType: order.type,
      deliveryFee: order.deliveryFee || 0,
      taxPercent: 0,
      serviceChargePercent: 0,
    });

    const totalDelta = roundCurrency(totals.total - order.total);
    if (order.paymentStatus === 'paid' && Math.abs(totalDelta) > 0.009) {
      const primaryMethod = order.payments?.[0]?.method || 'cash';
      posDb.applyShiftSalesAdjustment(totalDelta, primaryMethod, 0);
    }

    const cancelTickets: KitchenTicket[] = [];
    const sentAffectedStations = affectedStationIds.filter((stId) => {
      const stationState = existingStates.find((s) => s.stationId === stId);
      return (
        stationState?.printStatus === 'completed' ||
        stationState?.printStatus === 'printing' ||
        existingTickets.some(
          (t) =>
            t.stationId === stId &&
            t.ticketType !== 'CANCELLATION' &&
            (t.printStatus === 'completed' || t.printStatus === 'printing')
        ) ||
        order.kitchenPrintStatus === 'printed'
      );
    });

    affectedStationIds.forEach((stId) => {
      if (!activeAfterStations.has(stId)) {
        const idx = existingStates.findIndex((s) => s.stationId === stId);
        if (idx >= 0) {
          existingStates[idx] = {
            ...existingStates[idx],
            status: 'CANCELLED',
            updatedAt: now,
            updatedBy: params.employeeName,
          };
        }
      }
    });

    sentAffectedStations.forEach((stId, idx) => {
      const grp = affectedStationsMap.get(stId)!;
      cancelTickets.push({
        id: `ktk-${order.id}-${grp.station.id}-CANCEL-${Date.now()}-${idx + 1}`,
        orderId: order.id,
        orderNumber: order.orderNumber,
        orderBatchId: `cancel-${order.id}-${Date.now()}`,
        stationId: grp.station.id,
        stationCode: grp.station.code,
        stationNameAr: grp.station.nameAr,
        stationNameEn: grp.station.nameEn,
        ticketType: 'CANCELLATION',
        sequenceIndex: idx + 1,
        sequenceTotal: sentAffectedStations.length,
        sequenceLabel: `${idx + 1}/${sentAffectedStations.length}`,
        status: 'CANCELLED',
        printStatus: 'pending',
        reprintCount: 0,
        orderType: order.type,
        tableNumber: order.tableNumber,
        orderTime: now,
        orderNotes: order.notes,
        items: grp.components.map((comp) => ({
          orderItemId: comp.sourceOrderItemId,
          productId: comp.productId,
          productNameAr: comp.productNameAr,
          quantity: comp.quantity,
          action: 'REMOVE',
          selectedModifiers: comp.selectedModifiers,
          notes: comp.notes,
          sourceOfferId: comp.sourceOfferId,
          sourceOfferName: comp.sourceOfferName,
        })),
        cancellationReason: params.reason,
        actorUserId: params.employeeId,
        actorUserName: params.employeeName,
        createdAt: now,
      });
    });

    const overallKitchenStatus = posDb.computeOverallKitchenStatus(existingStates);
    const updatedOrder: Order = {
      ...order,
      items: updatedItems,
      subtotal: totals.subtotal,
      discountAmount: totals.discountAmount,
      total: totals.total,
      paidAmount: order.paymentStatus === 'paid' ? totals.total : order.paidAmount,
      changeAmount: order.paymentStatus === 'paid' ? 0 : order.changeAmount,
      stationStates: existingStates,
      overallKitchenStatus,
      updatedAt: now,
    };

    posDb.saveUpdatedOrder(updatedOrder);
    if (cancelTickets.length > 0) {
      posDb.saveKitchenTicketsBatch(cancelTickets);
    }

    const cancellationRecord: CancellationRecord = {
      id: `can-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      orderId: order.id,
      orderNumber: order.orderNumber,
      scope: 'item',
      orderItemId: targetItem.id,
      productNameAr: targetItem.productNameAr,
      quantity: targetItem.quantity,
      reason: params.reason,
      employeeId: params.employeeId,
      employeeName: params.employeeName,
      approvedBy: params.approvedBy,
      wasPreparingOrReady,
      inventoryAction: shouldRestock ? 'restocked' : 'wastage_no_restock',
      affectedStationIds,
      generatedTicketIds: cancelTickets.map((t) => t.id),
      timestamp: now,
    };
    posDb.saveOrderCancellation(cancellationRecord);

    const affectedNames = affectedStationIds
      .map((id) => affectedStationsMap.get(id)?.station.nameAr || id)
      .join('، ');

    posDb.logAudit({
      userId: params.employeeId,
      userName: params.employeeName,
      action: 'إلغاء صنف من الطلب',
      category: 'order',
      details: `الطلب ${order.orderNumber} | الصنف: ${targetItem.productNameAr} (${targetItem.quantity}x) | محطة: ${affectedNames} | السبب: ${params.reason}`,
    });

    let printOutcomePromise: Promise<SharedBatchPrintOutcome> | undefined;
    if (cancelTickets.length > 0) {
      const enq = sharedKitchenPrintQueue.enqueueTickets(cancelTickets, params.profile, {
        dedupePrefix: `cancel-${cancellationRecord.id}`,
      });
      printOutcomePromise = enq.resultsPromise;
    }

    return {
      success: true,
      message: `تم إلغاء "${targetItem.productNameAr}" وإبلاغ ${affectedNames}`,
      order: updatedOrder,
      cancellationRecord,
      tickets: cancelTickets,
      printOutcomePromise,
    };
  }

  // FULL ORDER CANCELLATION
  const activeItems = order.items.filter((it) => !it.cancelled && it.status !== 'cancelled');
  const expandedActiveAll: ExpandedOrderComponent[] = activeItems.flatMap((it) =>
    expandOrderItemToComponents(it, productsMap)
  );
  const activeStationIds = Array.from(
    new Set(
      expandedActiveAll.map((c) => posDb.resolveStationForProductOrItem(c.stationId, c.productId).id)
    )
  );
  const wasPreparingOrReady =
    existingStates.some((s) => s.status === 'PREPARING' || s.status === 'READY') ||
    activeItems.some((it) => it.status === 'preparing' || it.status === 'ready');

  const shouldRestock = !wasPreparingOrReady || Boolean(params.restockIfPreparing);
  if (shouldRestock && expandedActiveAll.length > 0) {
    posDb.applyIncrementalRecipeInventoryDelta(
      expandedActiveAll.map((c) => ({ productId: c.productId, quantityDelta: -c.quantity })),
      `إلغاء الطلب بالكامل ${order.orderNumber} (${params.reason})`,
      params.employeeId,
      params.employeeName
    );
  }

  posDb.adjustOfferRedemptionsOnOrderCancelOrRefund(order, 'cancelled');

  if (order.paymentStatus === 'paid') {
    const primaryMethod = order.payments?.[0]?.method || 'cash';
    posDb.applyShiftSalesAdjustment(-roundCurrency(order.total), primaryMethod, -1);
  }

  if (order.tableId) {
    posDb.updateTableStatus(order.tableId, 'available', undefined);
  }

  // Determine stations that received kitchen tickets -> print prominent CANCELLED notice to each affected station
  const stationsNeedingCancelTicket = activeStationIds.filter((stId) => {
    const stState = existingStates.find((s) => s.stationId === stId);
    if (stState && (stState.printStatus === 'completed' || stState.printStatus === 'printing')) return true;
    return existingTickets.some(
      (t) =>
        t.stationId === stId &&
        t.ticketType !== 'CANCELLATION' &&
        (t.printStatus === 'completed' || t.printStatus === 'printing')
    );
  });

  // Fallback: if order was printed at kitchen level before station tickets tracked printStatus
  const targetCancelStations =
    stationsNeedingCancelTicket.length > 0
      ? stationsNeedingCancelTicket
      : order.kitchenPrintStatus === 'printed'
      ? activeStationIds
      : [];

  const cancelBatchId = `cancel-order-${order.id}-${Date.now()}`;
  const cancelTickets: KitchenTicket[] = targetCancelStations.map((stId, idx) => {
    const st = posDb.resolveStationForProductOrItem(stId);
    const stComps = expandedActiveAll.filter(
      (c) => posDb.resolveStationForProductOrItem(c.stationId, c.productId).id === stId
    );
    const seqNum = idx + 1;
    const seqTotal = targetCancelStations.length;
    return {
      id: `ktk-${order.id}-${st.id}-CANCEL-${Date.now()}-${seqNum}`,
      orderId: order.id,
      orderNumber: order.orderNumber,
      orderBatchId: cancelBatchId,
      stationId: st.id,
      stationCode: st.code,
      stationNameAr: st.nameAr,
      stationNameEn: st.nameEn,
      ticketType: 'CANCELLATION',
      sequenceIndex: seqNum,
      sequenceTotal: seqTotal,
      sequenceLabel: `${seqNum}/${seqTotal}`,
      status: 'CANCELLED',
      printStatus: 'pending',
      reprintCount: 0,
      orderType: order.type,
      tableNumber: order.tableNumber,
      orderTime: now,
      orderNotes: order.notes,
      items: stComps.map((c) => ({
        orderItemId: c.sourceOrderItemId,
        productId: c.productId,
        productNameAr: c.productNameAr,
        quantity: c.quantity,
        action: 'REMOVE',
        selectedModifiers: c.selectedModifiers,
        notes: c.notes,
        sourceOfferId: c.sourceOfferId,
        sourceOfferName: c.sourceOfferName,
      })),
      cancellationReason: params.reason,
      actorUserId: params.employeeId,
      actorUserName: params.employeeName,
      createdAt: now,
    };
  });

  const nextStationStates: OrderStationState[] = activeStationIds.map((stId) => {
    const prev = existingStates.find((s) => s.stationId === stId);
    const st = posDb.resolveStationForProductOrItem(stId);
    const tk = cancelTickets.find((t) => t.stationId === stId);
    return {
      stationId: st.id,
      stationCode: st.code,
      stationNameAr: st.nameAr,
      stationNameEn: st.nameEn,
      status: 'CANCELLED',
      latestTicketId: tk?.id || prev?.latestTicketId,
      printStatus: tk ? 'pending' : prev?.printStatus || 'completed',
      updatedAt: now,
      updatedBy: params.employeeName,
    };
  });

  const cancellationRecord: CancellationRecord = {
    id: `can-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    orderId: order.id,
    orderNumber: order.orderNumber,
    scope: 'order',
    reason: params.reason,
    employeeId: params.employeeId,
    employeeName: params.employeeName,
    approvedBy: params.approvedBy,
    wasPreparingOrReady,
    inventoryAction: shouldRestock ? 'restocked' : 'wastage_no_restock',
    affectedStationIds: activeStationIds,
    generatedTicketIds: cancelTickets.map((t) => t.id),
    timestamp: now,
  };

  const updatedOrder: Order = {
    ...order,
    status: 'cancelled',
    overallKitchenStatus: 'CANCELLED',
    cancellationRecordId: cancellationRecord.id,
    stationStates: nextStationStates,
    items: order.items.map((it) =>
      it.cancelled || it.status === 'cancelled'
        ? it
        : {
            ...it,
            cancelled: true,
            status: 'cancelled',
            cancelledAt: now,
            cancelledBy: params.employeeName,
            cancelReason: params.reason,
          }
    ),
    updatedAt: now,
  };

  // Never delete order from database — preserve complete financial and kitchen audit record
  posDb.saveUpdatedOrder(updatedOrder);
  posDb.saveOrderCancellation(cancellationRecord);
  if (cancelTickets.length > 0) {
    posDb.saveKitchenTicketsBatch(cancelTickets);
  }

  // Also ensure any pending NEW/MOD jobs for this order are superseded in queue
  if (cancelTickets.length === 0) {
    const jobs = posDb.getKitchenPrintJobs();
    let changed = false;
    jobs.forEach((j, idx) => {
      if (j.orderId === order.id && j.status === 'pending' && j.ticketType !== 'CANCELLATION') {
        jobs[idx] = { ...j, status: 'completed', completedAt: now, errorMessage: 'تم إلغاء الطلب قبل الطباعة' };
        changed = true;
      }
    });
    if (changed) posDb.saveKitchenPrintJobsBatch(jobs);
  }

  posDb.logAudit({
    userId: params.employeeId,
    userName: params.employeeName,
    action: 'إلغاء الطلب بالكامل (محفوظ في السجل)',
    category: 'order',
    details: `الطلب ${order.orderNumber} | السبب: ${params.reason} | المخزون: ${
      shouldRestock ? 'تم الاسترجاع' : 'هالك تحضير بدون استرجاع'
    } | تذاكر الإلغاء المرسلة: ${cancelTickets.length}`,
  });

  let printOutcomePromise: Promise<SharedBatchPrintOutcome> | undefined;
  if (cancelTickets.length > 0) {
    const enq = sharedKitchenPrintQueue.enqueueTickets(cancelTickets, params.profile, {
      dedupePrefix: `cancel-${cancellationRecord.id}`,
    });
    printOutcomePromise = enq.resultsPromise;
  }

  return {
    success: true,
    message: `تم إلغاء الطلب ${order.orderNumber} وحفظه بسجل التدقيق وإشعار المحطات المتأثرة (${cancelTickets.length})`,
    order: updatedOrder,
    cancellationRecord,
    tickets: cancelTickets,
    printOutcomePromise,
  };
}
