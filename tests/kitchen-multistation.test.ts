import './setup';
import assert from 'assert';
import net from 'net';
import { posDb } from '../src/services/db';
import { initialProfile } from '../src/services/seedData';
import {
  splitOrderByStations,
  createAndDispatchOrderTickets,
  modifyOrderWithKitchenDiff,
  cancelOrderOrItemWithKitchenWorkflow,
} from '../src/services/kitchenStationService';
import { sharedKitchenPrintQueue } from '../src/printing/core/SharedKitchenPrintQueue';
import {
  generateStationKitchenTicketHTML,
  buildStationKotPlainText,
} from '../src/printing/templates/KitchenTicketTemplate';
import {
  Ingredient,
  KitchenStation,
  KitchenTicket,
  Order,
  Product,
  Recipe,
  RestaurantProfile,
  RestaurantTable,
} from '../src/types';

interface CapturedConnection {
  index: number;
  rawBuffer: Buffer;
  text: string;
  startedAt: number;
  endedAt: number;
}

async function startCaptureKitchenTcpServer(): Promise<{
  port: number;
  connections: CapturedConnection[];
  getMaxConcurrentSockets: () => number;
  close: () => Promise<void>;
}> {
  const connections: CapturedConnection[] = [];
  let activeSockets = 0;
  let maxConcurrent = 0;
  let seq = 0;
  const openSockets = new Set<net.Socket>();

  const server = net.createServer((socket) => {
    openSockets.add(socket);
    activeSockets++;
    if (activeSockets > maxConcurrent) {
      maxConcurrent = activeSockets;
    }

    const connIndex = ++seq;
    const startedAt = Date.now();
    const chunks: Buffer[] = [];

    socket.on('data', (chunk) => {
      chunks.push(Buffer.from(chunk));
    });

    socket.on('close', () => {
      openSockets.delete(socket);
      activeSockets = Math.max(0, activeSockets - 1);
      const rawBuffer = Buffer.concat(chunks);
      connections.push({
        index: connIndex,
        rawBuffer,
        text: rawBuffer.toString('utf8'),
        startedAt,
        endedAt: Date.now(),
      });
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address() as net.AddressInfo;
  return {
    port: addr.port,
    connections,
    getMaxConcurrentSockets: () => maxConcurrent,
    close: async () => {
      openSockets.forEach((s) => {
        try {
          s.destroy();
        } catch {}
      });
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function getClosedLocalPort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', () => resolve()));
  const { port } = probe.address() as net.AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

function makeTestProfile(port: number, overrides?: Partial<RestaurantProfile>): RestaurantProfile {
  const base = posDb.getProfile();
  const baseReceiptSettings = base.receiptSettings || initialProfile.receiptSettings!;
  return {
    ...base,
    name: 'مشويات الباشا - EL BASHA GRILL',
    kitchenPrinterName: 'Shared Kitchen Thermal Printer',
    kitchenPrinterIp: '127.0.0.1',
    kitchenPrinterPort: port,
    kitchenPrinterProtocol: 'escpos_text',
    kitchenAutoCut: true,
    kitchenBuzzerEnabled: false,
    kitchenCopies: 1,
    kitchenQueuePriority: 'cancellations_and_mods_first',
    kitchenGroupOrderTickets: true,
    receiptSettings: {
      ...baseReceiptSettings,
      restaurantNameArabic: 'مشويات الباشا',
      restaurantNameEnglish: 'EL BASHA GRILL',
      kitchenPrinterIp: '127.0.0.1',
      kitchenPrinterPort: port,
      kitchenPrinterProtocol: 'escpos_text',
      kitchenAutoCut: true,
      kitchenBuzzerEnabled: false,
      kitchenCopies: 1,
      paperFeedLines: 4,
    },
    ...overrides,
  };
}

function resetCleanCatalogAndState(profile: RestaurantProfile) {
  posDb.resetToCleanState();
  posDb.updateProfile(profile);

  // Open clean shift for sales adjustment assertions
  posDb.openShift({
    shiftNumber: 'T-1',
    userId: 'cashier-1',
    userName: 'أحمد كاشير',
    cashierId: 'cashier-1',
    cashierName: 'أحمد كاشير',
    branchId: 'branch-1',
    branchName: 'الفرع الرئيسي',
    startTime: new Date().toISOString(),
    openedAt: new Date().toISOString(),
    startingCash: 1000,
    totalSales: 0,
    ordersCount: 0,
  });

  // Setup ingredients & recipes to verify net incremental inventory & restock/wastage
  const ingredients: Ingredient[] = [
    { id: 'ing-dough', name: 'عجينة بيتزا', unit: 'قطعة', currentStock: 100, minStock: 10, costPerUnit: 15 },
    { id: 'ing-crepe', name: 'عجينة كريب', unit: 'قطعة', currentStock: 100, minStock: 10, costPerUnit: 8 },
    { id: 'ing-chicken', name: 'ربع فرخة شيش', unit: 'قطعة', currentStock: 100, minStock: 10, costPerUnit: 45 },
    { id: 'ing-kofta', name: 'لحم كفتة', unit: 'كجم', currentStock: 100, minStock: 5, costPerUnit: 220 },
    { id: 'ing-bread', name: 'عيش فينو/سوري', unit: 'رغيف', currentStock: 100, minStock: 20, costPerUnit: 3 },
  ];
  ingredients.forEach((ing) => posDb.saveIngredient(ing));

  const products: Product[] = [
    {
      id: 'prod-pizza-mix',
      sku: 'PZ-001',
      categoryId: 'cat-pizza',
      nameAr: 'بيتزا ميكس لحوم',
      nameEn: 'Pizza Mix',
      price: 210,
      costPrice: 90,
      prepTimeMinutes: 15,
      kitchenStation: 'PIZZA_STATION',
      stationId: 'PIZZA_STATION',
      available: true,
    },
    {
      id: 'prod-crepe-crispy',
      sku: 'CR-001',
      categoryId: 'cat-crepe',
      nameAr: 'كريب كريسبي',
      nameEn: 'Crispy Crepe',
      price: 120,
      costPrice: 45,
      prepTimeMinutes: 10,
      kitchenStation: 'CREPE_STATION',
      stationId: 'CREPE_STATION',
      available: true,
    },
    {
      id: 'prod-quarter-chicken',
      sku: 'GR-001',
      categoryId: 'cat-grill',
      nameAr: 'ربع فرخة مشوي',
      nameEn: 'Quarter Chicken',
      price: 140,
      costPrice: 70,
      prepTimeMinutes: 20,
      kitchenStation: 'GRILL_STATION',
      stationId: 'GRILL_STATION',
      available: true,
    },
    {
      id: 'prod-kofta',
      sku: 'GR-002',
      categoryId: 'cat-grill',
      nameAr: 'كفتة مشوية',
      nameEn: 'Kofta',
      price: 180,
      costPrice: 95,
      prepTimeMinutes: 15,
      kitchenStation: 'GRILL_STATION',
      stationId: 'GRILL_STATION',
      available: true,
    },
    {
      id: 'prod-sandwich-shish',
      sku: 'SW-001',
      categoryId: 'cat-sandwich',
      nameAr: 'ساندوتش شيش طاووق',
      nameEn: 'Shish Sandwich',
      price: 95,
      costPrice: 40,
      prepTimeMinutes: 8,
      kitchenStation: 'SANDWICH_STATION',
      stationId: 'SANDWICH_STATION',
      available: true,
    },
  ];
  products.forEach((p) => posDb.saveProduct(p));

  const recipes: Recipe[] = [
    { id: 'rec-pizza', productId: 'prod-pizza-mix', items: [{ ingredientId: 'ing-dough', ingredientName: 'عجينة بيتزا', quantity: 1, unit: 'قطعة' }] },
    { id: 'rec-crepe', productId: 'prod-crepe-crispy', items: [{ ingredientId: 'ing-crepe', ingredientName: 'عجينة كريب', quantity: 1, unit: 'قطعة' }] },
    { id: 'rec-chicken', productId: 'prod-quarter-chicken', items: [{ ingredientId: 'ing-chicken', ingredientName: 'ربع فرخة شيش', quantity: 1, unit: 'قطعة' }] },
    { id: 'rec-kofta', productId: 'prod-kofta', items: [{ ingredientId: 'ing-kofta', ingredientName: 'لحم كفتة', quantity: 0.25, unit: 'كجم' }] },
    { id: 'rec-sand', productId: 'prod-sandwich-shish', items: [{ ingredientId: 'ing-bread', ingredientName: 'عيش فينو/سوري', quantity: 1, unit: 'رغيف' }] },
  ];
  recipes.forEach((r) => posDb.saveRecipe(r));

  const table: RestaurantTable = {
    id: 'table-5',
    number: '5',
    branchId: 'branch-1',
    capacity: 4,
    section: 'داخلية',
    status: 'available',
  };
  posDb.saveTable(table);
}

function buildOrder1050(): Order {
  const now = new Date().toISOString();
  return {
    id: `ord-1050-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    orderNumber: '#1050',
    type: 'dine_in',
    tableId: 'table-5',
    tableNumber: '5',
    branchId: 'branch-1',
    branchName: 'الفرع الرئيسي',
    cashierId: 'cashier-1',
    cashierName: 'أحمد كاشير',
    items: [
      {
        id: 'it-1050-pizza',
        productId: 'prod-pizza-mix',
        productNameAr: 'بيتزا ميكس لحوم',
        productNameEn: 'Pizza Mix',
        unitPrice: 210,
        costPrice: 90,
        quantity: 2,
        selectedModifiers: [],
        notes: 'بدون زيتون',
        itemTotal: 420,
        kitchenStation: 'PIZZA_STATION',
        stationId: 'PIZZA_STATION',
        status: 'pending',
      },
      {
        id: 'it-1050-crepe',
        productId: 'prod-crepe-crispy',
        productNameAr: 'كريب كريسبي',
        productNameEn: 'Crispy Crepe',
        unitPrice: 120,
        costPrice: 45,
        quantity: 1,
        selectedModifiers: [],
        itemTotal: 120,
        kitchenStation: 'CREPE_STATION',
        stationId: 'CREPE_STATION',
        status: 'pending',
      },
      {
        id: 'it-1050-chicken',
        productId: 'prod-quarter-chicken',
        productNameAr: 'ربع فرخة مشوي',
        productNameEn: 'Quarter Chicken',
        unitPrice: 140,
        costPrice: 70,
        quantity: 2,
        selectedModifiers: [],
        itemTotal: 280,
        kitchenStation: 'GRILL_STATION',
        stationId: 'GRILL_STATION',
        status: 'pending',
      },
      {
        id: 'it-1050-kofta',
        productId: 'prod-kofta',
        productNameAr: 'كفتة مشوية',
        productNameEn: 'Kofta',
        unitPrice: 180,
        costPrice: 95,
        quantity: 3,
        selectedModifiers: [],
        itemTotal: 540,
        kitchenStation: 'GRILL_STATION',
        stationId: 'GRILL_STATION',
        status: 'pending',
      },
    ],
    subtotal: 1360,
    discountAmount: 0,
    taxPercent: 0,
    taxAmount: 0,
    serviceChargePercent: 0,
    serviceChargeAmount: 0,
    total: 1360,
    payments: [{ method: 'cash', amount: 1360 }],
    paidAmount: 1360,
    changeAmount: 0,
    status: 'confirmed',
    paymentStatus: 'paid',
    createdAt: now,
  };
}

async function runMultiStationKitchenTests() {
  console.log('🧪 Starting Single-Printer Multi-Station Kitchen Management Test Suite (15 Scenarios)...\n');
  let passedCount = 0;
  let totalCount = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    totalCount++;
    try {
      const res = fn();
      if (res instanceof Promise) await res;
      console.log(`  ✅ PASS: ${name}`);
      passedCount++;
    } catch (err: any) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error('    ', err?.stack || err?.message || err);
    }
  }

  const tcpServer = await startCaptureKitchenTcpServer();

  try {
    // 1. Multi-station configuration & dynamic product assignment
    await test('1. Multi-station configuration (add/edit/disable) + dynamic product assignment', () => {
      const profile = makeTestProfile(tcpServer.port);
      resetCleanCatalogAndState(profile);

      const defaultStations = posDb.getKitchenStations();
      assert.strictEqual(defaultStations.length, 4, 'Must seed 4 default stations');
      assert.ok(defaultStations.every((s) => s.printerId === 'shared_kitchen_printer'));

      // Add custom station
      const dessertStation: KitchenStation = {
        id: 'DESSERT_STATION',
        code: 'DESSERT_STATION',
        nameAr: 'الحلويات والمقبلات',
        nameEn: 'DESSERT STATION',
        sortOrder: 5,
        enabled: true,
        printerId: 'shared_kitchen_printer',
        createdAt: new Date().toISOString(),
      };
      posDb.saveKitchenStation(dessertStation);
      assert.strictEqual(posDb.getKitchenStations().length, 5);

      // Edit custom station
      posDb.saveKitchenStation({ ...dessertStation, nameAr: 'قسم الحلويات الشرقية' });
      const edited = posDb.getKitchenStations().find((s) => s.id === 'DESSERT_STATION');
      assert.strictEqual(edited?.nameAr, 'قسم الحلويات الشرقية');

      // Dynamic product assignment to custom station
      const kunafa: Product = {
        id: 'prod-kunafa',
        sku: 'DS-001',
        categoryId: 'cat-dessert',
        nameAr: 'كنافة بالمانجو',
        nameEn: 'Mango Kunafa',
        price: 85,
        costPrice: 35,
        prepTimeMinutes: 5,
        stationId: 'DESSERT_STATION',
        kitchenStation: 'DESSERT_STATION',
        available: true,
      };
      posDb.saveProduct(kunafa);
      const resolved = posDb.resolveStationForProductOrItem(undefined, 'prod-kunafa');
      assert.strictEqual(resolved.id, 'DESSERT_STATION', 'Product must resolve dynamically to assigned station');

      // Disable custom station -> product safely resolves to enabled fallback without crashing
      posDb.toggleKitchenStation('DESSERT_STATION', false);
      const disabledState = posDb.getKitchenStations().find((s) => s.id === 'DESSERT_STATION');
      assert.strictEqual(disabledState?.enabled, false);
      assert.strictEqual(posDb.getKitchenStations({ enabledOnly: true }).length, 4);
    });

    // 2. Order #1050 splitting across 3 stations strictly isolating items + sequence 1/3, 2/3, 3/3
    await test('2. Order #1050 splits into 3 station tickets containing ONLY each station items (1/3, 2/3, 3/3)', () => {
      const profile = makeTestProfile(tcpServer.port);
      resetCleanCatalogAndState(profile);

      const order1050 = buildOrder1050();
      const split = splitOrderByStations(order1050, profile);

      assert.strictEqual(split.tickets.length, 3, 'Order #1050 spans Pizza, Crepe, and Grill stations (3 tickets)');
      assert.strictEqual(split.tickets[0].sequenceLabel, '1/3');
      assert.strictEqual(split.tickets[1].sequenceLabel, '2/3');
      assert.strictEqual(split.tickets[2].sequenceLabel, '3/3');

      const pizzaTicket = split.tickets.find((t) => t.stationId === 'PIZZA_STATION')!;
      const crepeTicket = split.tickets.find((t) => t.stationId === 'CREPE_STATION')!;
      const grillTicket = split.tickets.find((t) => t.stationId === 'GRILL_STATION')!;

      assert.strictEqual(pizzaTicket.items.length, 1);
      assert.strictEqual(pizzaTicket.items[0].productNameAr, 'بيتزا ميكس لحوم');
      assert.strictEqual(pizzaTicket.items[0].quantity, 2);

      assert.strictEqual(crepeTicket.items.length, 1);
      assert.strictEqual(crepeTicket.items[0].productNameAr, 'كريب كريسبي');
      assert.strictEqual(crepeTicket.items[0].quantity, 1);

      assert.strictEqual(grillTicket.items.length, 2);
      assert.ok(grillTicket.items.some((i) => i.productNameAr === 'ربع فرخة مشوي' && i.quantity === 2));
      assert.ok(grillTicket.items.some((i) => i.productNameAr === 'كفتة مشوية' && i.quantity === 3));

      // Ensure Pizza ticket plain text & HTML NEVER leak Crepe or Grill items
      const pizzaText = buildStationKotPlainText(pizzaTicket, profile);
      assert.ok(pizzaText.includes('بيتزا ميكس لحوم'));
      assert.ok(!pizzaText.includes('كريب كريسبي'), 'Pizza ticket must NEVER include Crepe items');
      assert.ok(!pizzaText.includes('كفتة مشوية'), 'Pizza ticket must NEVER include Grill items');

      const pizzaHtml = generateStationKitchenTicketHTML(pizzaTicket, profile);
      assert.ok(pizzaHtml.includes('البيتزا') && pizzaHtml.includes('1/3'));
      assert.ok(!pizzaHtml.includes('كريب كريسبي'));
    });

    // 3. Single shared kitchen printer sequential writes (zero simultaneous/interleaved socket writes)
    await test('3. Single shared kitchen printer prints sequentially with zero simultaneous socket writes', async () => {
      const profile = makeTestProfile(tcpServer.port);
      resetCleanCatalogAndState(profile);
      tcpServer.connections.length = 0;

      const order = posDb.createOrder(buildOrder1050());
      const { tickets, outcome } = await createAndDispatchOrderTickets(order, profile);

      assert.strictEqual(outcome.allOk, true, `Expected allOk, errors: ${JSON.stringify(outcome.results)}`);
      assert.strictEqual(outcome.completedCount, 3);
      assert.strictEqual(tickets.length, 3);

      await new Promise((r) => setTimeout(r, 40));
      assert.strictEqual(tcpServer.connections.length, 3, '3 separate sequential TCP print jobs must arrive');
      assert.strictEqual(tcpServer.getMaxConcurrentSockets(), 1, 'Never open simultaneous socket writes to shared printer');

      // Check chronological non-overlapping timestamps and strict station content
      const [c1, c2, c3] = tcpServer.connections;
      assert.ok(c1.endedAt <= c2.startedAt + 5 && c2.endedAt <= c3.startedAt + 5);
      assert.ok(c1.text.includes('SEQ: 1/3') && c1.text.includes('PIZZA STATION') && c1.text.includes('البيتزا'));
      assert.ok(c2.text.includes('SEQ: 2/3') && c2.text.includes('CREPE STATION') && c2.text.includes('الكريب'));
      assert.ok(c3.text.includes('SEQ: 3/3') && c3.text.includes('GRILL STATION') && c3.text.includes('المشويات'));
      // Verify GS V cut bytes present when kitchenAutoCut: true
      assert.ok(c1.rawBuffer.includes(Buffer.from([0x1d, 0x56])), 'GS V cut command expected when kitchenAutoCut is enabled');
    });

    // 4. Contiguous batch grouping when Order 2 arrives while Order 1 is mid-batch
    await test('4. Batch contiguity keeps all Order 1 tickets together before Order 2 starts', async () => {
      const profile = makeTestProfile(tcpServer.port, { kitchenGroupOrderTickets: true });
      resetCleanCatalogAndState(profile);
      tcpServer.connections.length = 0;

      const order1 = posDb.createOrder({ ...buildOrder1050(), id: 'ord-batch-1', orderNumber: '#B001' });
      const order2: Order = {
        ...buildOrder1050(),
        id: 'ord-batch-2',
        orderNumber: '#B002',
        items: [
          {
            id: 'it-b2-sand',
            productId: 'prod-sandwich-shish',
            productNameAr: 'ساندوتش شيش طاووق',
            unitPrice: 95,
            costPrice: 40,
            quantity: 1,
            selectedModifiers: [],
            itemTotal: 95,
            stationId: 'SANDWICH_STATION',
            kitchenStation: 'SANDWICH_STATION',
            status: 'pending',
          },
          {
            id: 'it-b2-pizza',
            productId: 'prod-pizza-mix',
            productNameAr: 'بيتزا ميكس لحوم',
            unitPrice: 210,
            costPrice: 90,
            quantity: 1,
            selectedModifiers: [],
            itemTotal: 210,
            stationId: 'PIZZA_STATION',
            kitchenStation: 'PIZZA_STATION',
            status: 'pending',
          },
        ],
      };
      posDb.createOrder(order2);

      // Dispatch Order 1 first, then immediately dispatch Order 2 without awaiting Order 1
      const p1 = createAndDispatchOrderTickets(order1, profile);
      const p2 = createAndDispatchOrderTickets(order2, profile);
      const [r1, r2] = await Promise.all([p1, p2]);

      assert.strictEqual(r1.outcome.allOk, true);
      assert.strictEqual(r2.outcome.allOk, true);
      await new Promise((r) => setTimeout(r, 40));

      assert.strictEqual(tcpServer.connections.length, 5);
      const orderSequence = tcpServer.connections.map((c) => (c.text.includes('#B001') ? '#B001' : '#B002'));
      assert.deepStrictEqual(
        orderSequence,
        ['#B001', '#B001', '#B001', '#B002', '#B002'],
        'Order #B001 tickets (3) must print contiguously before #B002 (2)'
      );
    });

    // 5. Priority policy + stale pending NEW suppression on CANCELLATION
    await test('5. Priority policies order tickets properly & CANCELLATION suppresses stale pending NEW ticket', async () => {
      const profile = makeTestProfile(tcpServer.port, {
        kitchenGroupOrderTickets: false,
        kitchenQueuePriority: 'cancellations_and_mods_first',
      });
      resetCleanCatalogAndState(profile);
      tcpServer.connections.length = 0;

      // Prepare 3 pre-built tickets directly in DB with pending jobs created in order: NEW -> MODIFICATION -> CANCELLATION
      const tNew: KitchenTicket = {
        id: 't-prio-new',
        orderId: 'ord-prio-1',
        orderNumber: '#PRIO-NEW',
        orderBatchId: 'batch-p1',
        stationId: 'GRILL_STATION',
        stationCode: 'GRILL_STATION',
        stationNameAr: 'المشويات',
        stationNameEn: 'GRILL STATION',
        ticketType: 'NEW',
        sequenceIndex: 1,
        sequenceTotal: 1,
        sequenceLabel: '1/1',
        status: 'NEW',
        printStatus: 'pending',
        reprintCount: 0,
        orderType: 'takeaway',
        orderTime: new Date().toISOString(),
        items: [{ orderItemId: 'i1', productId: 'prod-kofta', productNameAr: 'كفتة مشوية', quantity: 1 }],
        createdAt: new Date(Date.now() - 3000).toISOString(),
      };
      const tMod: KitchenTicket = {
        ...tNew,
        id: 't-prio-mod',
        orderId: 'ord-prio-2',
        orderNumber: '#PRIO-MOD',
        orderBatchId: 'batch-p2',
        ticketType: 'MODIFICATION',
        modificationSummary: 'زيادة كمية',
        createdAt: new Date(Date.now() - 2000).toISOString(),
      };
      const tCancel: KitchenTicket = {
        ...tNew,
        id: 't-prio-cancel',
        orderId: 'ord-prio-3',
        orderNumber: '#PRIO-CANCEL',
        orderBatchId: 'batch-p3',
        ticketType: 'CANCELLATION',
        cancellationReason: 'تغيير رأي العميل',
        createdAt: new Date(Date.now() - 1000).toISOString(),
      };

      // Also test stale NEW ticket for SAME (orderId, stationId) as a CANCELLATION
      const tStaleNew: KitchenTicket = {
        ...tNew,
        id: 't-stale-new',
        orderId: 'ord-prio-3',
        orderNumber: '#PRIO-CANCEL',
        orderBatchId: 'batch-stale',
        stationId: 'GRILL_STATION',
        createdAt: new Date(Date.now() - 4000).toISOString(),
      };

      posDb.saveKitchenTicketsBatch([tStaleNew, tNew, tMod, tCancel]);
      posDb.saveKitchenPrintJobsBatch([
        {
          jobId: 'job-stale',
          orderId: tStaleNew.orderId,
          orderNumber: tStaleNew.orderNumber,
          orderBatchId: tStaleNew.orderBatchId,
          ticketId: tStaleNew.id,
          ticketType: 'NEW',
          stationId: 'GRILL_STATION',
          stationCode: 'GRILL_STATION',
          stationNameAr: 'المشويات',
          sequenceLabel: '1/1',
          priority: 100,
          status: 'pending',
          retryCount: 0,
          dedupeKey: 'stale-1',
          printerId: 'shared_kitchen_printer',
          createdAt: tStaleNew.createdAt,
        },
        {
          jobId: 'job-new',
          orderId: tNew.orderId,
          orderNumber: tNew.orderNumber,
          orderBatchId: tNew.orderBatchId,
          ticketId: tNew.id,
          ticketType: 'NEW',
          stationId: 'GRILL_STATION',
          stationCode: 'GRILL_STATION',
          stationNameAr: 'المشويات',
          sequenceLabel: '1/1',
          priority: 100,
          status: 'pending',
          retryCount: 0,
          dedupeKey: 'prio-new',
          printerId: 'shared_kitchen_printer',
          createdAt: tNew.createdAt,
        },
        {
          jobId: 'job-mod',
          orderId: tMod.orderId,
          orderNumber: tMod.orderNumber,
          orderBatchId: tMod.orderBatchId,
          ticketId: tMod.id,
          ticketType: 'MODIFICATION',
          stationId: 'GRILL_STATION',
          stationCode: 'GRILL_STATION',
          stationNameAr: 'المشويات',
          sequenceLabel: '1/1',
          priority: 200,
          status: 'pending',
          retryCount: 0,
          dedupeKey: 'prio-mod',
          printerId: 'shared_kitchen_printer',
          createdAt: tMod.createdAt,
        },
      ]);

      // Enqueue tCancel -> must suppress job-stale AND print before job-mod and job-new!
      const { resultsPromise } = sharedKitchenPrintQueue.enqueueTickets([tCancel], profile, { dedupePrefix: 'prio-cancel' });
      const res = await resultsPromise;
      assert.strictEqual(res.allOk, true);
      await sharedKitchenPrintQueue.waitForIdle();
      await new Promise((r) => setTimeout(r, 40));

      assert.strictEqual(tcpServer.connections.length, 3, 'Stale pending NEW ticket must be suppressed, only 3 tickets print');
      const printedOrder = tcpServer.connections.map((c) => {
        if (c.text.includes('#PRIO-CANCEL')) return 'CANCELLATION';
        if (c.text.includes('#PRIO-MOD')) return 'MODIFICATION';
        return 'NEW';
      });
      assert.deepStrictEqual(printedOrder, ['CANCELLATION', 'MODIFICATION', 'NEW']);

      const staleJobRecord = posDb.getKitchenPrintJobs().find((j) => j.jobId === 'job-stale');
      assert.strictEqual(staleJobRecord?.status, 'completed');
      assert.ok(staleJobRecord?.errorMessage?.includes('إلغاء'));
    });

    // 6. Order modification ADD item -> prints MODIFICATION ONLY to newly affected station
    await test('6. Modification ADD item prints MODIFICATION ticket ONLY to newly affected station', async () => {
      const profile = makeTestProfile(tcpServer.port);
      resetCleanCatalogAndState(profile);
      const order = posDb.createOrder(buildOrder1050());
      await createAndDispatchOrderTickets(order, profile);
      await new Promise((r) => setTimeout(r, 30));
      tcpServer.connections.length = 0;

      // Add a SANDWICH_STATION item
      const nextItems = [
        ...order.items,
        {
          id: 'it-new-sand',
          productId: 'prod-sandwich-shish',
          productNameAr: 'ساندوتش شيش طاووق',
          unitPrice: 95,
          costPrice: 40,
          quantity: 2,
          selectedModifiers: [],
          itemTotal: 190,
          stationId: 'SANDWICH_STATION',
          kitchenStation: 'SANDWICH_STATION',
          status: 'pending' as const,
        },
      ];

      const modRes = await modifyOrderWithKitchenDiff({
        orderId: order.id,
        nextItems,
        reason: 'إضافة ساندوتشات للعميل',
        employeeId: 'cashier-1',
        employeeName: 'أحمد كاشير',
        profile,
      });

      assert.strictEqual(modRes.success, true);
      assert.strictEqual(modRes.tickets?.length, 1, 'Only SANDWICH_STATION should receive a modification ticket');
      assert.strictEqual(modRes.tickets?.[0].stationId, 'SANDWICH_STATION');
      assert.strictEqual(modRes.tickets?.[0].ticketType, 'MODIFICATION');

      await modRes.printOutcomePromise;
      await new Promise((r) => setTimeout(r, 30));

      assert.strictEqual(tcpServer.connections.length, 1);
      assert.ok(tcpServer.connections[0].text.includes('SANDWICH STATION') && tcpServer.connections[0].text.includes('الساندوتشات'));
      assert.ok(tcpServer.connections[0].text.includes('[ADD] [2x] ساندوتش شيش طاووق'));
      assert.ok(!tcpServer.connections[0].text.includes('بيتزا ميكس لحوم'));

      // Check net inventory deduction: bread started at 100, deducted 2 -> 98; dough stayed 98 (100 - 2)
      const bread = posDb.getIngredientById('ing-bread')!;
      const dough = posDb.getIngredientById('ing-dough')!;
      assert.strictEqual(bread.currentStock, 98);
      assert.strictEqual(dough.currentStock, 98, 'Pizza dough must NOT be double deducted');
    });

    // 7. Modification quantity CHANGE (1->2) & REMOVE item -> incremental diff + net stock delta
    await test('7. Modification CHANGE qty & REMOVE sends incremental diff + net inventory delta (no double deduction)', async () => {
      const profile = makeTestProfile(tcpServer.port);
      resetCleanCatalogAndState(profile);
      const order = posDb.createOrder(buildOrder1050());
      await createAndDispatchOrderTickets(order, profile);
      await new Promise((r) => setTimeout(r, 30));
      tcpServer.connections.length = 0;

      // Initial stock after buildOrder1050():
      // crepe: 100 - 1 = 99; kofta: 100 - (0.25*3) = 99.25; pizza: 100 - 2 = 98
      assert.strictEqual(posDb.getIngredientById('ing-crepe')!.currentStock, 99);
      assert.strictEqual(posDb.getIngredientById('ing-kofta')!.currentStock, 99.25);

      // Change Crispy Crepe qty 1 -> 2, and REMOVE Kofta completely
      const nextItems = order.items
        .filter((it) => it.productId !== 'prod-kofta')
        .map((it) =>
          it.productId === 'prod-crepe-crispy'
            ? { ...it, quantity: 2, itemTotal: 240 }
            : it
        );

      const modRes = await modifyOrderWithKitchenDiff({
        orderId: order.id,
        nextItems,
        reason: 'تعديل كمية الكريب وحذف الكفتة',
        employeeId: 'cashier-1',
        employeeName: 'أحمد كاشير',
        profile,
      });

      assert.strictEqual(modRes.success, true);
      assert.strictEqual(modRes.tickets?.length, 2, 'Only CREPE_STATION and GRILL_STATION affected');

      await modRes.printOutcomePromise;
      await new Promise((r) => setTimeout(r, 30));

      assert.strictEqual(tcpServer.connections.length, 2);
      const crepeText = tcpServer.connections.find((c) => c.text.includes('CREPE STATION'))?.text || '';
      const grillText = tcpServer.connections.find((c) => c.text.includes('GRILL STATION'))?.text || '';
      assert.ok(crepeText.includes('[CHANGE] [1->2] كريب كريسبي'), `Got: ${crepeText}`);
      assert.ok(grillText.includes('[REMOVE] [3x] كفتة مشوية'), `Got: ${grillText}`);

      // Net stock: crepe went from 99 -> 98 (only +1 deducted); kofta went from 99.25 -> 100 (3 * 0.25 restored)
      assert.strictEqual(posDb.getIngredientById('ing-crepe')!.currentStock, 98);
      assert.strictEqual(posDb.getIngredientById('ing-kofta')!.currentStock, 100);
      assert.strictEqual(posDb.getIngredientById('ing-dough')!.currentStock, 98);
    });

    // 8. Modification blocked with requiresApproval when affected station is PREPARING/READY
    await test('8. Modification warns and blocks when affected station is PREPARING until approved', async () => {
      const profile = makeTestProfile(tcpServer.port);
      resetCleanCatalogAndState(profile);
      const order = posDb.createOrder(buildOrder1050());
      await createAndDispatchOrderTickets(order, profile);

      // Mark PIZZA_STATION as PREPARING
      posDb.updateOrderStationStatus(order.id, 'PIZZA_STATION', 'PREPARING', 'chef-1', 'شيف البيتزا');

      const nextItems = order.items.map((it) =>
        it.productId === 'prod-pizza-mix' ? { ...it, quantity: 3, itemTotal: 630 } : it
      );

      // Without approval -> must return requiresApproval: true
      const blocked = await modifyOrderWithKitchenDiff({
        orderId: order.id,
        nextItems,
        reason: 'إضافة بيتزا إضافية',
        employeeId: 'cashier-1',
        employeeName: 'أحمد كاشير',
        approvePreparingEdit: false,
        profile,
      });

      assert.strictEqual(blocked.success, false);
      assert.strictEqual(blocked.requiresApproval, true);
      assert.ok(blocked.warningStations?.includes('البيتزا'));

      // With explicit approval -> succeeds cleanly
      const approved = await modifyOrderWithKitchenDiff({
        orderId: order.id,
        nextItems,
        reason: 'إضافة بيتزا إضافية بموافقة الشيف',
        employeeId: 'cashier-1',
        employeeName: 'أحمد كاشير',
        approvePreparingEdit: true,
        profile,
      });

      assert.strictEqual(approved.success, true);
      assert.strictEqual(approved.modificationRecord?.hadPreparingWarning, true);
      await approved.printOutcomePromise;
    });

    // 9. Single-item cancellation -> CANCELLED ticket ONLY to item's station, reason/actor logged, order intact
    await test('9. Single-item cancellation sends CANCELLED ONLY to affected station and preserves order', async () => {
      const profile = makeTestProfile(tcpServer.port);
      resetCleanCatalogAndState(profile);
      const order = posDb.createOrder(buildOrder1050());
      await createAndDispatchOrderTickets(order, profile);
      await new Promise((r) => setTimeout(r, 30));
      tcpServer.connections.length = 0;

      const res = await cancelOrderOrItemWithKitchenWorkflow({
        orderId: order.id,
        scope: 'item',
        orderItemId: 'it-1050-crepe',
        reason: 'نفاذ شوكولاتة النوتيلا',
        employeeId: 'cashier-1',
        employeeName: 'أحمد كاشير',
        profile,
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.tickets?.length, 1);
      assert.strictEqual(res.tickets?.[0].stationId, 'CREPE_STATION');
      assert.strictEqual(res.tickets?.[0].ticketType, 'CANCELLATION');

      await res.printOutcomePromise;
      await new Promise((r) => setTimeout(r, 30));

      assert.strictEqual(tcpServer.connections.length, 1);
      assert.ok(tcpServer.connections[0].text.includes('TICKET TYPE: CANCELLATION'));
      assert.ok(tcpServer.connections[0].text.includes('CREPE STATION') && tcpServer.connections[0].text.includes('الكريب'));
      assert.ok(tcpServer.connections[0].text.includes('كريب كريسبي'));
      assert.ok(tcpServer.connections[0].text.includes('نفاذ شوكولاتة النوتيلا'));

      const savedOrder = posDb.getOrders().find((o) => o.id === order.id)!;
      assert.notStrictEqual(savedOrder.status, 'cancelled', 'Remaining order stays active');
      assert.strictEqual(savedOrder.total, 1240, 'Order total recalculated (1360 - 120)');
      const cancelRecords = posDb.getOrderCancellations(order.id);
      assert.strictEqual(cancelRecords.length, 1);
      assert.strictEqual(cancelRecords[0].reason, 'نفاذ شوكولاتة النوتيلا');
    });

    // 10. Full-order cancellation -> order preserved in DB, CANCELLED sent only to notified stations, restock vs wastage
    await test('10. Full-order cancellation preserves order in DB, logs wastage when PREPARING, updates shift & table', async () => {
      const profile = makeTestProfile(tcpServer.port);
      resetCleanCatalogAndState(profile);
      const order = posDb.createOrder(buildOrder1050());
      await createAndDispatchOrderTickets(order, profile);

      // Mark Pizza station PREPARING
      posDb.updateOrderStationStatus(order.id, 'PIZZA_STATION', 'PREPARING', 'chef-1', 'شيف البيتزا');
      await new Promise((r) => setTimeout(r, 30));
      tcpServer.connections.length = 0;

      const stockDoughBeforeCancel = posDb.getIngredientById('ing-dough')!.currentStock; // 98
      const cancelRes = await cancelOrderOrItemWithKitchenWorkflow({
        orderId: order.id,
        scope: 'order',
        reason: 'العميل غادر المطعم',
        employeeId: 'manager-1',
        employeeName: 'مدير الصالة',
        restockIfPreparing: false, // Wastage decision: do NOT restock
        profile,
      });

      assert.strictEqual(cancelRes.success, true);
      assert.strictEqual(cancelRes.tickets?.length, 3, 'All 3 notified stations receive CANCELLED ticket');
      assert.strictEqual(cancelRes.cancellationRecord?.inventoryAction, 'wastage_no_restock');

      await cancelRes.printOutcomePromise;
      await new Promise((r) => setTimeout(r, 40));

      assert.strictEqual(tcpServer.connections.length, 3);
      assert.ok(tcpServer.connections.every((c) => c.text.includes('TICKET TYPE: CANCELLATION')));

      // Order MUST still exist in DB
      const dbOrder = posDb.getOrders().find((o) => o.id === order.id);
      assert.ok(dbOrder, 'Cancelled order MUST NEVER be deleted from database');
      assert.strictEqual(dbOrder?.status, 'cancelled');
      assert.strictEqual(dbOrder?.overallKitchenStatus, 'CANCELLED');

      // Stock stayed at 98 (wastage_no_restock)
      assert.strictEqual(posDb.getIngredientById('ing-dough')!.currentStock, stockDoughBeforeCancel);

      // Table released & shift sales reversed
      const table = posDb.getTables().find((t) => t.id === 'table-5');
      assert.strictEqual(table?.status, 'available');
      assert.strictEqual(posDb.getActiveShift()?.totalSales, 0);
    });

    // 11. Overall order status READY only when ALL active stations are READY
    await test('11. Overall order status transitions to READY only when ALL active stations are READY', async () => {
      const profile = makeTestProfile(tcpServer.port);
      resetCleanCatalogAndState(profile);
      const order = posDb.createOrder(buildOrder1050());
      await createAndDispatchOrderTickets(order, profile);

      // Station 1 & 2 READY, Station 3 still PRINTED/PREPARING -> overall must NOT be READY
      posDb.updateOrderStationStatus(order.id, 'PIZZA_STATION', 'READY', 'chef-1', 'شيف البيتزا');
      let updated = posDb.updateOrderStationStatus(order.id, 'CREPE_STATION', 'READY', 'chef-2', 'شيف الكريب')!;
      assert.strictEqual(updated.overallKitchenStatus, 'PREPARING');
      assert.notStrictEqual(updated.status, 'ready', 'Order must NOT become ready while GRILL_STATION is unfinished');

      // Now Station 3 READY -> overall becomes READY
      updated = posDb.updateOrderStationStatus(order.id, 'GRILL_STATION', 'READY', 'chef-3', 'شيف الشواية')!;
      assert.strictEqual(updated.overallKitchenStatus, 'READY');
      assert.strictEqual(updated.status, 'ready');
    });

    // 12. Printer disconnected -> jobs saved as failed (no silent drop) -> retry succeeds when reconnected
    await test('12. Disconnected printer saves failed jobs (no silent drop) and retryFailedJobs recovers when port opens', async () => {
      const closedPort = await getClosedLocalPort();
      const offlineProfile = makeTestProfile(closedPort);
      resetCleanCatalogAndState(offlineProfile);

      const order = posDb.createOrder(buildOrder1050());
      const dispatch = await createAndDispatchOrderTickets(order, offlineProfile);

      assert.strictEqual(dispatch.outcome.allOk, false);
      assert.strictEqual(dispatch.outcome.failedCount, 3);

      const failedJobs = posDb.getKitchenPrintJobs().filter((j) => j.orderId === order.id);
      assert.strictEqual(failedJobs.length, 3);
      assert.ok(failedJobs.every((j) => j.status === 'failed'), 'Failed print jobs must be persisted honestly');

      // Reconnect to live TCP server and retry
      tcpServer.connections.length = 0;
      const onlineProfile = makeTestProfile(tcpServer.port);
      posDb.updateProfile(onlineProfile);

      const retryRes = await sharedKitchenPrintQueue.retryFailedJobs(onlineProfile, order.id);
      assert.strictEqual(retryRes.allOk, true);
      assert.strictEqual(retryRes.completedCount, 3);

      await new Promise((r) => setTimeout(r, 40));
      assert.strictEqual(tcpServer.connections.length, 3);
    });

    // 13. Manual single-station reprint succeeds without duplicating order or mutating inventory
    await test('13. Manual single-station reprint prints ticket without duplicating order or mutating inventory', async () => {
      const profile = makeTestProfile(tcpServer.port);
      resetCleanCatalogAndState(profile);
      const order = posDb.createOrder(buildOrder1050());
      const { tickets } = await createAndDispatchOrderTickets(order, profile);
      await new Promise((r) => setTimeout(r, 30));
      tcpServer.connections.length = 0;

      const ordersCountBefore = posDb.getOrders().length;
      const stockBefore = posDb.getIngredients().map((i) => ({ id: i.id, qty: i.currentStock }));

      const pizzaTicket = tickets.find((t) => t.stationId === 'PIZZA_STATION')!;
      const reprintRes = await sharedKitchenPrintQueue.reprintTicket(
        pizzaTicket.id,
        profile,
        { userId: 'cashier-1', userName: 'أحمد كاشير' },
        'ورقة تالفة'
      );

      assert.strictEqual(reprintRes.success, true);
      assert.strictEqual(reprintRes.ticket?.reprintCount, 1);

      await new Promise((r) => setTimeout(r, 30));
      assert.strictEqual(tcpServer.connections.length, 1);
      assert.ok(tcpServer.connections[0].text.includes('PIZZA STATION') && tcpServer.connections[0].text.includes('البيتزا'));
      assert.strictEqual(posDb.getOrders().length, ordersCountBefore, 'Reprint must NOT duplicate order');
      assert.deepStrictEqual(
        posDb.getIngredients().map((i) => ({ id: i.id, qty: i.currentStock })),
        stockBefore,
        'Reprint must NOT mutate inventory'
      );
      assert.strictEqual(posDb.getKitchenReprints(order.id).length, 1);
    });

    // 14. Duplicate job prevention via dedupeKey
    await test('14. Queue prevents duplicate print jobs for identical non-reprint dedupeKey', async () => {
      const profile = makeTestProfile(tcpServer.port);
      resetCleanCatalogAndState(profile);
      tcpServer.connections.length = 0;

      const order = posDb.createOrder(buildOrder1050());
      const first = await createAndDispatchOrderTickets(order, profile, { dedupePrefix: 'strict-dup-test' });
      assert.strictEqual(first.outcome.completedCount, 3);

      // Call enqueue again for the exact same NEW tickets with same dedupePrefix
      const existingTickets = posDb.getKitchenTickets({ orderId: order.id });
      const second = sharedKitchenPrintQueue.enqueueTickets(existingTickets, profile, {
        dedupePrefix: 'strict-dup-test',
      });
      assert.strictEqual(second.queuedJobs.length, 0, 'Duplicate jobs must be rejected');
      assert.strictEqual(second.dedupedCount, 3);
      await second.resultsPromise;
      await new Promise((r) => setTimeout(r, 30));
      assert.strictEqual(tcpServer.connections.length, 3, 'Total physical prints must stay 3');
    });

    // 15. kitchenAutoCut: false omits GS V bytes while keeping separators & paper feed
    await test('15. kitchenAutoCut: false omits GS V cutter command while preserving separators and paper feed', async () => {
      const baseProf = makeTestProfile(tcpServer.port);
      const noCutProfile = makeTestProfile(tcpServer.port, {
        kitchenAutoCut: false,
        receiptSettings: {
          ...baseProf.receiptSettings!,
          kitchenAutoCut: false,
          paperFeedLines: 5,
        },
      });
      resetCleanCatalogAndState(noCutProfile);
      tcpServer.connections.length = 0;

      const order = posDb.createOrder(buildOrder1050());
      const { outcome } = await createAndDispatchOrderTickets(order, noCutProfile);
      assert.strictEqual(outcome.allOk, true);

      await new Promise((r) => setTimeout(r, 30));
      assert.strictEqual(tcpServer.connections.length, 3);
      tcpServer.connections.forEach((conn) => {
        assert.strictEqual(
          conn.rawBuffer.includes(Buffer.from([0x1d, 0x56])),
          false,
          'GS V cut bytes must NOT be sent when kitchenAutoCut is false'
        );
        assert.ok(
          conn.rawBuffer.includes(Buffer.from([0x1b, 0x64, 0x05])),
          'ESC d paper feed bytes must still be present'
        );
        assert.ok(conn.text.includes('========================================'), 'Separators must still be present');
      });
    });

    // Clean up localStorage test state after suite completes
    posDb.resetToCleanState();
  } finally {
    await tcpServer.close();
  }

  console.log(`\n📊 Multi-Station Kitchen Management Results: ${passedCount}/${totalCount} Passed`);
  if (passedCount !== totalCount) {
    process.exit(1);
  }
}

runMultiStationKitchenTests();
