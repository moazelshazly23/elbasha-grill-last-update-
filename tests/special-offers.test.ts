import './setup';
import assert from 'assert';
import net from 'net';
import { posDb } from '../src/services/db';
import { initialProfile } from '../src/services/seedData';
import {
  computeOfferOriginalPrice,
  computeOfferCostPrice,
  validateOfferPricing,
  canAddOfferToCart,
  isOfferCurrentlyValid,
  computeOffersAnalytics,
} from '../src/services/specialOffersService';
import {
  splitOrderByStations,
  createAndDispatchOrderTickets,
  cancelOrderOrItemWithKitchenWorkflow,
} from '../src/services/kitchenStationService';
import { generateThermalReceiptHTML } from '../src/printing/templates/ReceiptTemplate';
import {
  generateStationKitchenTicketHTML,
  buildStationKotPlainText,
} from '../src/printing/templates/KitchenTicketTemplate';
import { printManager } from '../src/printing/core/PrintManager';
import { sharedKitchenPrintQueue } from '../src/printing/core/SharedKitchenPrintQueue';
import {
  Ingredient,
  Order,
  OrderItem,
  Product,
  Recipe,
  RestaurantProfile,
} from '../src/types';

async function startCaptureKitchenTcpServer(): Promise<{
  port: number;
  capturedTexts: string[];
  close: () => Promise<void>;
}> {
  const capturedTexts: string[] = [];
  const openSockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    openSockets.add(socket);
    const chunks: Buffer[] = [];
    socket.on('data', (c) => chunks.push(Buffer.from(c)));
    socket.on('close', () => {
      openSockets.delete(socket);
      capturedTexts.push(Buffer.concat(chunks).toString('utf8'));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as net.AddressInfo;
  return {
    port: addr.port,
    capturedTexts,
    close: async () => {
      openSockets.forEach((s) => s.destroy());
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function makeTestProduct(overrides: Partial<Product>): Product {
  return {
    id: overrides.id || `prod-${Math.random()}`,
    nameAr: overrides.nameAr || 'صنف اختبار',
    nameEn: overrides.nameEn || 'Test Product',
    sku: overrides.sku || 'SKU-TEST',
    categoryId: overrides.categoryId || 'cat-1',
    price: overrides.price ?? 100,
    costPrice: overrides.costPrice ?? 50,
    available: true,
    prepTimeMinutes: 10,
    kitchenStation: overrides.kitchenStation || 'GRILL_STATION',
    stationId: overrides.stationId || overrides.kitchenStation || 'GRILL_STATION',
    trackInventory: true,
    ...overrides,
  };
}

function makeTestIngredient(overrides: Partial<Ingredient>): Ingredient {
  return {
    id: overrides.id || `ing-${Math.random()}`,
    name: overrides.name || 'خامة اختبار',
    unit: overrides.unit || 'كجم',
    currentStock: overrides.currentStock ?? 100,
    minStock: 5,
    costPerUnit: overrides.costPerUnit ?? 50,
    ...overrides,
  };
}

async function runTests() {
  console.log('=== Starting Special Offers Management System Tests (14 Scenarios) ===');

  posDb.resetToCleanState();

  const tcpServer = await startCaptureKitchenTcpServer();
  const profile: RestaurantProfile = {
    ...initialProfile,
    setupCompleted: true,
    kitchenPrinterIp: '127.0.0.1',
    kitchenPrinterPort: tcpServer.port,
    kitchenPrinterProtocol: 'plain_line',
    kitchenAutoCut: false,
    kitchenBuzzerEnabled: false,
    receiptSettings: {
      ...(initialProfile.receiptSettings as any),
      kitchenPrinterIp: '127.0.0.1',
      kitchenPrinterPort: tcpServer.port,
      kitchenPrinterProtocol: 'plain_line',
      kitchenAutoCut: false,
      kitchenBuzzerEnabled: false,
    },
  };
  posDb.updateProfile(profile);

  // Seed Ingredients & Recipes & 5 Distinct Catalog Products across 4 Kitchen Stations
  const ingDough = makeTestIngredient({ id: 'ing-dough', name: 'عجينة بيتزا', unit: 'قطعة', currentStock: 50 });
  const ingCrepe = makeTestIngredient({ id: 'ing-crepe', name: 'عيش كريب', unit: 'قطعة', currentStock: 50 });
  const ingKoftaMeat = makeTestIngredient({ id: 'ing-meat', name: 'لحم مفروم', unit: 'كجم', currentStock: 30 });
  const ingChicken = makeTestIngredient({ id: 'ing-chicken', name: 'فراخ مشوية', unit: 'قطعة', currentStock: 40 });
  const ingBread = makeTestIngredient({ id: 'ing-bread', name: 'عيش فينو ساندوتش', unit: 'رغيف', currentStock: 60 });

  [ingDough, ingCrepe, ingKoftaMeat, ingChicken, ingBread].forEach((ing) => posDb.saveIngredient(ing));

  const pPizza = makeTestProduct({
    id: 'prod-pizza-mix',
    nameAr: 'بيتزا ميكس لحوم',
    price: 200,
    costPrice: 100,
    kitchenStation: 'PIZZA_STATION',
    stationId: 'PIZZA_STATION',
  });
  const pCrepe = makeTestProduct({
    id: 'prod-crepe-crispy',
    nameAr: 'كريب كريسبي',
    price: 120,
    costPrice: 60,
    kitchenStation: 'CREPE_STATION',
    stationId: 'CREPE_STATION',
  });
  const pKofta = makeTestProduct({
    id: 'prod-kofta',
    nameAr: 'كفتة ضاني',
    price: 150,
    costPrice: 80,
    kitchenStation: 'GRILL_STATION',
    stationId: 'GRILL_STATION',
  });
  const pChicken = makeTestProduct({
    id: 'prod-quarter-chicken',
    nameAr: 'ربع فرخة على الفحم',
    price: 110,
    costPrice: 55,
    kitchenStation: 'GRILL_STATION',
    stationId: 'GRILL_STATION',
  });
  const pSandwich = makeTestProduct({
    id: 'prod-sandwich-shish',
    nameAr: 'ساندوتش شيش طاووق',
    price: 80,
    costPrice: 40,
    kitchenStation: 'SANDWICH_STATION',
    stationId: 'SANDWICH_STATION',
  });

  [pPizza, pCrepe, pKofta, pChicken, pSandwich].forEach((p) => posDb.saveProduct(p));

  const recipes: Recipe[] = [
    { id: 'rec-1', productId: pPizza.id, items: [{ ingredientId: ingDough.id, ingredientName: ingDough.name, quantity: 1 }] },
    { id: 'rec-2', productId: pCrepe.id, items: [{ ingredientId: ingCrepe.id, ingredientName: ingCrepe.name, quantity: 1 }] },
    { id: 'rec-3', productId: pKofta.id, items: [{ ingredientId: ingKoftaMeat.id, ingredientName: ingKoftaMeat.name, quantity: 0.25 }] },
    { id: 'rec-4', productId: pChicken.id, items: [{ ingredientId: ingChicken.id, ingredientName: ingChicken.name, quantity: 1 }] },
    { id: 'rec-5', productId: pSandwich.id, items: [{ ingredientId: ingBread.id, ingredientName: ingBread.name, quantity: 1 }] },
  ];
  recipes.forEach((r) => posDb.saveRecipe(r));

  try {
    // -----------------------------------------------------------------------
    // Test 1 & 2 & 3: Create offer with 5 existing products + custom quantities (0 duplication)
    // -----------------------------------------------------------------------
    const componentsInput = [
      { productId: pPizza.id, productNameAr: pPizza.nameAr, unitPrice: pPizza.price, quantity: 1, stationId: 'PIZZA_STATION' },
      { productId: pCrepe.id, productNameAr: pCrepe.nameAr, unitPrice: pCrepe.price, quantity: 2, stationId: 'CREPE_STATION' },
      { productId: pKofta.id, productNameAr: pKofta.nameAr, unitPrice: pKofta.price, quantity: 2, stationId: 'GRILL_STATION' },
      { productId: pChicken.id, productNameAr: pChicken.nameAr, unitPrice: pChicken.price, quantity: 1, stationId: 'GRILL_STATION' },
      { productId: pSandwich.id, productNameAr: pSandwich.nameAr, unitPrice: pSandwich.price, quantity: 3, stationId: 'SANDWICH_STATION' },
    ];
    // Expected original price = 200*1 + 120*2 + 150*2 + 110*1 + 80*3 = 200 + 240 + 300 + 110 + 240 = 1090
    const expectedOriginalPrice = computeOfferOriginalPrice(componentsInput);
    assert.strictEqual(expectedOriginalPrice, 1090, 'Test 3: Custom component quantities sum must equal 1090');

    // Test 4: Reject invalid offer pricing (<= 0 or > originalPrice)
    assert.strictEqual(validateOfferPricing(1090, 0).valid, false, 'Test 4: Offer price 0 must be rejected');
    assert.strictEqual(validateOfferPricing(1090, -50).valid, false, 'Test 4: Negative offer price must be rejected');
    assert.strictEqual(validateOfferPricing(1090, 1200).valid, false, 'Test 4: Offer price > originalPrice must be rejected');

    const invalidSave = posDb.saveOffer({
      nameAr: 'عرض غير صالح',
      components: componentsInput,
      offerPrice: 1500,
      status: 'active',
      sortOrder: 1,
    });
    assert.strictEqual(invalidSave.success, false, 'Test 4: saveOffer must reject offerPrice > originalPrice');

    const productCountBeforeOffer = posDb.getProducts().length;
    const createRes = posDb.saveOffer({
      nameAr: 'عرض العائلة الكبير',
      nameEn: 'Family Mega Offer',
      description: 'بيتزا + 2 كريب + 2 كفتة + ربع فرخة + 3 ساندوتش شيش',
      components: componentsInput,
      offerPrice: 850,
      status: 'active',
      sortOrder: 1,
      maxPerOrder: 3,
      maxTotalRedemptions: 10,
    });
    assert.strictEqual(createRes.success, true, 'Test 1: Offer creation must succeed');
    assert.ok(createRes.offer, 'Test 1: Offer object returned');
    const createdOffer = createRes.offer!;
    assert.strictEqual(posDb.getProducts().length, productCountBeforeOffer, 'Test 2: Creating offer must NOT duplicate products');
    assert.strictEqual(createdOffer.originalPrice, 1090);
    assert.strictEqual(createdOffer.offerPrice, 850);
    assert.strictEqual(createdOffer.savingsAmount, 240, 'Test 4: Savings amount must equal 240');
    assert.strictEqual(createdOffer.savingsPercent, 22, 'Test 4: Savings percent must be ~22%');

    // Edit offer price and verify recalculated savings
    const editRes = posDb.saveOffer({
      ...createdOffer,
      offerPrice: 800,
    });
    assert.strictEqual(editRes.success, true);
    assert.strictEqual(editRes.offer!.savingsAmount, 290, 'Test 4: Edited savingsAmount must update to 290');

    const activeOffer = posDb.getOfferById(createdOffer.id)!;

    // -----------------------------------------------------------------------
    // Test 5 & 6 & 7: Cart Bundle + Qty > 1 + Customer Receipt counts ONLY offerPrice * qty
    // -----------------------------------------------------------------------
    const offerQty = 2; // Selling 2 bundles of the offer
    assert.strictEqual(canAddOfferToCart(activeOffer, offerQty).allowed, true, 'Test 5: Offer allowed within maxPerOrder');
    assert.strictEqual(canAddOfferToCart(activeOffer, 4).allowed, false, 'Test 5: Exceeding maxPerOrder=3 must be rejected');

    const productsMap = new Map(posDb.getProducts().map((p) => [p.id, p]));
    const offerOrderItem: OrderItem = {
      id: 'oi-offer-1',
      itemType: 'offer',
      offerId: activeOffer.id,
      originalUnitPrice: activeOffer.originalPrice,
      savingsPerUnit: activeOffer.savingsAmount,
      offerComponents: activeOffer.components.map((c) => ({ ...c })),
      productId: `offer:${activeOffer.id}`,
      productNameAr: activeOffer.nameAr,
      productNameEn: activeOffer.nameEn,
      unitPrice: activeOffer.offerPrice, // 800
      costPrice: computeOfferCostPrice(activeOffer.components, productsMap),
      quantity: offerQty, // 2 -> itemTotal = 1600
      selectedModifiers: [],
      itemTotal: activeOffer.offerPrice * offerQty,
      kitchenStation: 'PIZZA_STATION',
      stationId: 'PIZZA_STATION',
      status: 'pending',
    };

    const order: Order = {
      id: 'ord-offer-1001',
      orderNumber: 'ORD-1001',
      type: 'dine_in',
      branchId: 'branch-1',
      branchName: 'الفرع الرئيسي',
      cashierId: 'user-admin',
      cashierName: 'المدير العام',
      tableNumber: 'T-5',
      items: [offerOrderItem],
      subtotal: 1600,
      discountAmount: 0,
      taxPercent: 0,
      taxAmount: 0,
      serviceChargePercent: 0,
      serviceChargeAmount: 0,
      total: 1600,
      payments: [{ method: 'cash', amount: 1600 }],
      paidAmount: 1600,
      changeAmount: 0,
      status: 'preparing',
      paymentStatus: 'paid',
      channel: 'pos',
      createdAt: new Date().toISOString(),
    };

    const savedOrder = posDb.createOrder(order);
    assert.strictEqual(savedOrder.subtotal, 1600, 'Test 7: Order subtotal must count ONLY offerPrice * qty (1600)');
    assert.strictEqual(savedOrder.total, 1600, 'Test 7: Order total must equal 1600 (not 2180)');

    // Check offer redemption count incremented by 2
    assert.strictEqual(posDb.getOfferById(activeOffer.id)!.currentRedemptions, 2, 'Test 6: Redemptions incremented by offerQty (2)');

    // Customer Receipt HTML verification
    const receiptHtml = generateThermalReceiptHTML(savedOrder, profile);
    assert.ok(receiptHtml.includes(`[عرض] ${activeOffer.nameAr}`), 'Test 7: Receipt prints offer title');
    assert.ok(receiptHtml.includes('محتويات العرض:'), 'Test 7: Receipt prints nested components header');
    assert.ok(receiptHtml.includes(`${pPizza.nameAr} × 2`), 'Test 6/7: Receipt multiplies component qty (Pizza 1*2=2)');
    assert.ok(receiptHtml.includes(`${pCrepe.nameAr} × 4`), 'Test 6/7: Receipt multiplies component qty (Crepe 2*2=4)');
    assert.ok(receiptHtml.includes('1600.00'), 'Test 7: Receipt prints bundle total 1600.00');
    assert.ok(!receiptHtml.includes('2180.00'), 'Test 7: Receipt never sums individual original prices as payable total');

    // -----------------------------------------------------------------------
    // Test 8: Inventory Deduction for 5 products * offerQty (NO Double Deduction)
    // -----------------------------------------------------------------------
    const ingAfterSale = new Map(posDb.getIngredients().map((i) => [i.id, i.currentStock]));
    // Pizza: 1 * 2 = 2 -> 50 - 2 = 48
    assert.strictEqual(ingAfterSale.get(ingDough.id), 48, 'Test 8: Pizza dough deducted exactly once (50 - 2 = 48)');
    // Crepe: 2 * 2 = 4 -> 50 - 4 = 46
    assert.strictEqual(ingAfterSale.get(ingCrepe.id), 46, 'Test 8: Crepe batter deducted exactly once (50 - 4 = 46)');
    // Kofta: (2 * 2) * 0.25kg = 1.0kg -> 30 - 1 = 29
    assert.strictEqual(ingAfterSale.get(ingKoftaMeat.id), 29, 'Test 8: Kofta meat deducted exactly once (30 - 1 = 29)');
    // Chicken: 1 * 2 = 2 -> 40 - 2 = 38
    assert.strictEqual(ingAfterSale.get(ingChicken.id), 38, 'Test 8: Chicken deducted exactly once (40 - 2 = 38)');
    // Sandwich: 3 * 2 = 6 -> 60 - 6 = 54
    assert.strictEqual(ingAfterSale.get(ingBread.id), 54, 'Test 8: Bread deducted exactly once (60 - 6 = 54)');

    // -----------------------------------------------------------------------
    // Test 9: Multi-Station Kitchen Splitting via Single Shared Kitchen Printer
    // -----------------------------------------------------------------------
    const splitRes = splitOrderByStations(savedOrder, profile, { orderBatchId: 'batch-offer-1' });
    assert.strictEqual(splitRes.tickets.length, 4, 'Test 9: Offer items must split across all 4 kitchen stations');

    const ticketByStation = new Map(splitRes.tickets.map((t) => [t.stationId, t]));
    const pizzaTicket = ticketByStation.get('PIZZA_STATION')!;
    const crepeTicket = ticketByStation.get('CREPE_STATION')!;
    const grillTicket = ticketByStation.get('GRILL_STATION')!;
    const sandwichTicket = ticketByStation.get('SANDWICH_STATION')!;

    assert.strictEqual(pizzaTicket.items.length, 1);
    assert.strictEqual(pizzaTicket.items[0].productId, pPizza.id);
    assert.strictEqual(pizzaTicket.items[0].quantity, 2);
    assert.strictEqual(pizzaTicket.items[0].sourceOfferName, activeOffer.nameAr);

    assert.strictEqual(crepeTicket.items[0].productId, pCrepe.id);
    assert.strictEqual(crepeTicket.items[0].quantity, 4);

    assert.strictEqual(grillTicket.items.length, 2, 'Test 9: Grill ticket contains Kofta (4) and Quarter Chicken (2)');
    assert.strictEqual(sandwichTicket.items[0].quantity, 6);

    const kotHtml = generateStationKitchenTicketHTML(pizzaTicket, profile);
    const kotText = buildStationKotPlainText(pizzaTicket, profile);
    assert.ok(kotHtml.includes(activeOffer.nameAr), 'Test 9: Kitchen ticket HTML shows [ضمن عرض: ...]');
    assert.ok(kotText.includes(activeOffer.nameAr), 'Test 9: Kitchen plain text shows [ضمن عرض: ...]');
    assert.ok(!kotText.includes('800'), 'Test 9: Kitchen ticket never leaks offer pricing');

    // Dispatch tickets through shared kitchen printer queue
    const dispatchRes = await createAndDispatchOrderTickets(savedOrder, profile);
    assert.strictEqual(dispatchRes.tickets.length, 4);
    assert.strictEqual(dispatchRes.outcome.allOk, true, 'Test 9: All 4 station tickets printed sequentially to single kitchen printer');
    await new Promise((r) => setTimeout(r, 40));
    assert.strictEqual(tcpServer.capturedTexts.length, 4);

    // -----------------------------------------------------------------------
    // Test 11: Reprint Receipt & Kitchen Ticket -> ZERO inventory mutation / ZERO duplicate sale
    // -----------------------------------------------------------------------
    const salesBeforeReprint = posDb.getOfferSales({ orderId: savedOrder.id }).length;
    await printManager.reprintOrder(savedOrder, profile, 'kitchen', {
      userId: 'user-admin',
      userName: 'المدير',
    });
    await sharedKitchenPrintQueue.reprintTicket(
      dispatchRes.tickets[0].id,
      profile,
      { userId: 'user-admin', userName: 'المدير' },
      'تجربة إعادة طباعة'
    );
    const ingAfterReprint = new Map(posDb.getIngredients().map((i) => [i.id, i.currentStock]));
    assert.strictEqual(ingAfterReprint.get(ingDough.id), 48, 'Test 11: Reprint must NOT mutate inventory');
    assert.strictEqual(posDb.getOfferSales({ orderId: savedOrder.id }).length, salesBeforeReprint, 'Test 11: Reprint must NOT duplicate offer sales');
    assert.strictEqual(posDb.getOfferById(activeOffer.id)!.currentRedemptions, 2, 'Test 11: Reprint must NOT increment redemptions');

    // -----------------------------------------------------------------------
    // Test 10: Cancel Order -> Restock unused ingredients & Decrement offer redemptions
    // -----------------------------------------------------------------------
    const cancelRes = await cancelOrderOrItemWithKitchenWorkflow({
      orderId: savedOrder.id,
      scope: 'order',
      reason: 'تعديل العميل للطلب قبل التجهيز',
      employeeId: 'user-admin',
      employeeName: 'المدير العام',
      restockIfPreparing: true,
      profile,
    });
    assert.strictEqual(cancelRes.success, true, 'Test 10: Order cancellation must succeed');
    if (cancelRes.printOutcomePromise) await cancelRes.printOutcomePromise;
    assert.strictEqual(cancelRes.tickets?.length, 4, 'Test 10: Cancellation must emit CANCELLATION tickets to all 4 affected stations');
    const ingAfterCancel = new Map(posDb.getIngredients().map((i) => [i.id, i.currentStock]));
    assert.strictEqual(ingAfterCancel.get(ingDough.id), 50, 'Test 10: Pizza dough restocked to 50');
    assert.strictEqual(ingAfterCancel.get(ingKoftaMeat.id), 30, 'Test 10: Kofta meat restocked to 30');
    assert.strictEqual(posDb.getOfferById(activeOffer.id)!.currentRedemptions, 0, 'Test 10: Offer redemptions reverted to 0 on cancellation');
    assert.strictEqual(posDb.getOfferSales({ orderId: savedOrder.id })[0].status, 'cancelled', 'Test 10: OfferSaleRecord marked cancelled');

    // Also create a second active order for Analytics verification
    const order2: Order = {
      ...order,
      id: 'ord-offer-1002',
      orderNumber: 'ORD-1002',
      items: [
        offerOrderItem,
        {
          id: 'oi-reg-1',
          itemType: 'product',
          productId: pKofta.id,
          productNameAr: pKofta.nameAr,
          unitPrice: pKofta.price,
          costPrice: pKofta.costPrice,
          quantity: 1,
          selectedModifiers: [],
          itemTotal: 150,
          kitchenStation: 'GRILL_STATION',
          stationId: 'GRILL_STATION',
          status: 'pending',
        },
      ],
      subtotal: 1750,
      total: 1750,
      payments: [{ method: 'cash', amount: 1750 }],
      paidAmount: 1750,
    };
    posDb.createOrder(order2);
    const analytics = computeOffersAnalytics(posDb.getOrders(), posDb.getOffers(), posDb.getOfferSales());
    assert.strictEqual(analytics.totalOfferUnitsSold, 2, 'Analytics counts active order units only');
    assert.strictEqual(analytics.totalOfferRevenue, 1600, 'Analytics offer revenue = 1600');
    assert.strictEqual(analytics.totalRegularRevenue, 150, 'Analytics regular revenue = 150');
    assert.strictEqual(analytics.totalSavingsGranted, 580, 'Analytics total savings = 290 * 2 = 580');

    // -----------------------------------------------------------------------
    // Test 12: Expired / Future / Over-Limit offers excluded from POS
    // -----------------------------------------------------------------------
    const expiredOfferRes = posDb.saveOffer({
      nameAr: 'عرض منتهي الصلاحية',
      components: [componentsInput[0]],
      offerPrice: 150,
      status: 'active',
      sortOrder: 2,
      endDate: '2020-01-01',
    });
    assert.strictEqual(expiredOfferRes.success, true);
    assert.strictEqual(
      isOfferCurrentlyValid(expiredOfferRes.offer!).valid,
      false,
      'Test 12: Expired offer must be invalid'
    );
    const posActiveIds = posDb.getActiveAvailableOffers().map((o) => o.id);
    assert.ok(!posActiveIds.includes(expiredOfferRes.offer!.id), 'Test 12: Expired offer excluded from getActiveAvailableOffers');
    assert.ok(posActiveIds.includes(activeOffer.id), 'Test 12: Valid offer included in getActiveAvailableOffers');

    // -----------------------------------------------------------------------
    // Test 13: Pause & Reactivate Offer
    // -----------------------------------------------------------------------
    posDb.toggleOfferStatus(activeOffer.id, 'paused');
    assert.ok(
      !posDb.getActiveAvailableOffers().some((o) => o.id === activeOffer.id),
      'Test 13: Paused offer hidden from active POS list'
    );
    posDb.toggleOfferStatus(activeOffer.id, 'active');
    assert.ok(
      posDb.getActiveAvailableOffers().some((o) => o.id === activeOffer.id),
      'Test 13: Reactivated offer visible again in active POS list'
    );

    // -----------------------------------------------------------------------
    // Test 14: Persistence across simulated DB reload
    // -----------------------------------------------------------------------
    const FreshDbCtor = posDb.constructor as new () => typeof posDb;
    const reloadedDb = new FreshDbCtor();
    const persistedOffer = reloadedDb.getOfferById(activeOffer.id);
    assert.ok(persistedOffer, 'Test 14: Created offer survives fresh DB reload');
    assert.strictEqual(persistedOffer!.components.length, 5, 'Test 14: All 5 linked components persisted cleanly');
    assert.strictEqual(persistedOffer!.offerPrice, 800, 'Test 14: Edited offer price persisted');

    console.log('ALL 14 SPECIAL OFFERS SCENARIOS PASSED SUCCESSFULLY.');
  } finally {
    await tcpServer.close();
    posDb.resetToCleanState();
  }
}

runTests().catch((err) => {
  console.error('Special offers test failed:', err);
  process.exit(1);
});
