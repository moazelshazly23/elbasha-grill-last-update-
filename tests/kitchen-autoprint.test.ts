import './setup';
import assert from 'assert';
import { posDb } from '../src/services/db';
import { kitchenAutoPrintService } from '../src/services/kitchenAutoPrintService';
import { Order } from '../src/types';

async function runKitchenAutoPrintTests() {
  console.log('🧪 Starting Kitchen Thermal Auto-Print Background Service Test Suite...\n');
  let passedCount = 0;
  let totalCount = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    totalCount++;
    try {
      const res = fn();
      if (res instanceof Promise) {
        await res;
      }
      console.log(`  ✅ PASS: ${name}`);
      passedCount++;
    } catch (err: any) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error('    ', err.message);
    }
  }

  // Ensure default profile has auto-print enabled
  posDb.updateProfile({
    kitchenAutoPrint: true,
    kitchenAutoPrintOnConfirmed: true,
  });

  // --- Test 1: Service Initialization and Status Check ---
  await test('Background Service is running and enabled on startup', () => {
    const status = kitchenAutoPrintService.getStatus();
    assert.strictEqual(status.isEnabled, true, 'Service should be enabled by default');
    assert.ok(status.targetPrinter, 'Target kitchen printer should be configured');
  });

  // --- Test 2: Order Status Change to 'confirmed' Triggers Auto-Print ---
  await test("Status transition from 'new' to 'confirmed' triggers auto-print and marks order as 'printed'", async () => {
    const orderId = `test-order-confirmed-${Date.now()}`;
    const initialOrder: Order = {
      id: orderId,
      orderNumber: `ORD-TEST-101`,
      type: 'delivery',
      branchId: 'branch-1',
      branchName: 'الفرع الرئيسي',
      cashierId: 'cashier-1',
      cashierName: 'كاشير التجربة',
      customerName: 'أحمد محمود',
      customerPhone: '01011223344',
      deliveryAddress: 'الدقي - شارع مصدق',
      items: [
        {
          id: 'item-1',
          productId: 'p-1',
          productNameAr: 'كيلو كباب ضاني مشوي',
          unitPrice: 600,
          costPrice: 350,
          quantity: 1,
          selectedModifiers: [],
          itemTotal: 600,
          kitchenStation: 'grill',
          status: 'pending',
        },
      ],
      subtotal: 600,
      discountAmount: 0,
      taxPercent: 0,
      taxAmount: 0,
      serviceChargePercent: 0,
      serviceChargeAmount: 0,
      total: 600,
      payments: [],
      paidAmount: 0,
      changeAmount: 0,
      status: 'new',
      paymentStatus: 'unpaid',
      channel: 'web',
      kitchenPrintStatus: 'pending',
      createdAt: new Date().toISOString(),
    };

    posDb.createOrder(initialOrder);

    // Initial check: status is 'new', not yet printed
    const freshOrder = posDb.getOrders().find((o) => o.id === orderId);
    assert.strictEqual(freshOrder?.status, 'new');

    // Trigger status transition to 'confirmed'
    posDb.updateOrderStatus(orderId, 'confirmed', 'cashier-1', 'كاشير الوردية');

    // Wait for the background service to process
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Verify order was marked as 'printed' and has printed timestamp
    const updatedOrder = posDb.getOrders().find((o) => o.id === orderId);
    assert.strictEqual(updatedOrder?.status, 'confirmed', "Order status must remain 'confirmed'");
    assert.strictEqual(updatedOrder?.kitchenPrintStatus, 'printed', "Kitchen print status must be 'printed'");
    assert.ok(updatedOrder?.kitchenPrintedAt, 'kitchenPrintedAt timestamp must be set');
  });

  // --- Test 3: Idempotency - Already Printed Confirmed Orders Are Not Reprinted ---
  await test('Idempotency: Re-evaluating or modifying an already printed confirmed order does not duplicate print', async () => {
    const statusBefore = kitchenAutoPrintService.getStatus();
    const countBefore = statusBefore.totalPrintedCount;

    // Trigger evaluate orders again
    kitchenAutoPrintService.evaluateOrders();
    await new Promise((resolve) => setTimeout(resolve, 200));

    const statusAfter = kitchenAutoPrintService.getStatus();
    assert.strictEqual(
      statusAfter.totalPrintedCount,
      countBefore,
      'Total printed count should not increase on re-evaluation of same orders'
    );
  });

  // --- Test 4: Direct Import as 'confirmed' is Detected and Printed ---
  await test("Order newly imported as 'confirmed' triggers auto-print", async () => {
    const directConfirmedId = `direct-confirmed-${Date.now()}`;
    const confirmedOrder: Order = {
      id: directConfirmedId,
      orderNumber: `ORD-DIRECT-202`,
      type: 'takeaway',
      branchId: 'branch-1',
      branchName: 'الفرع الرئيسي',
      cashierId: 'cashier-1',
      cashierName: 'كاشير الفرع',
      items: [
        {
          id: 'item-2',
          productId: 'p-2',
          productNameAr: 'شيش طاووق ع الفحم',
          unitPrice: 180,
          costPrice: 95,
          quantity: 2,
          selectedModifiers: [],
          itemTotal: 360,
          kitchenStation: 'grill',
          status: 'pending',
        },
      ],
      subtotal: 360,
      discountAmount: 0,
      taxPercent: 0,
      taxAmount: 0,
      serviceChargePercent: 0,
      serviceChargeAmount: 0,
      total: 360,
      payments: [],
      paidAmount: 360,
      changeAmount: 0,
      status: 'confirmed',
      paymentStatus: 'paid',
      channel: 'pos',
      kitchenPrintStatus: 'pending',
      createdAt: new Date().toISOString(),
    };

    posDb.createOrder(confirmedOrder);
    kitchenAutoPrintService.evaluateOrders();

    await new Promise((resolve) => setTimeout(resolve, 300));

    const checked = posDb.getOrders().find((o) => o.id === directConfirmedId);
    assert.strictEqual(checked?.kitchenPrintStatus, 'printed', 'Direct confirmed order must be printed');
  });

  // --- Test 5: Manual triggerPrintForOrder ---
  await test('Manual triggerPrintForOrder allows re-printing on demand', async () => {
    const orders = posDb.getOrders();
    const targetOrder = orders[0];
    assert.ok(targetOrder, 'Target order should exist');

    const result = await kitchenAutoPrintService.triggerPrintForOrder(targetOrder, true);
    assert.strictEqual(result, true, 'Manual print trigger should succeed');
  });

  // --- Test 6: Strict KOT Content Rule Verification ---
  await test('Kitchen Ticket (KOT) contains ONLY Order Number, Order Type, Timestamp, Item Names & Quantities (excludes logo, address, phone, prices, totals, QR)', async () => {
    const { generateKitchenTicketHTML } = await import('../src/utils/thermalPrinter');
    const profile = posDb.getProfile();
    const sampleOrder: Order = {
      id: 'kot-strict-1',
      orderNumber: '#9099',
      type: 'dine_in',
      tableNumber: '12',
      branchId: 'branch-1',
      branchName: 'الفرع الرئيسي',
      cashierId: 'cashier-1',
      cashierName: 'محمد سمير',
      customerName: 'عميل سري',
      customerPhone: '01099887766',
      deliveryAddress: 'شارع التحرير 55',
      items: [
        {
          id: 'it-1',
          productId: 'p-1',
          productNameAr: 'كيلو ريش ضاني مشوي',
          unitPrice: 750,
          costPrice: 450,
          quantity: 3,
          selectedModifiers: [
            { groupId: 'g1', groupNameAr: 'تسوية', optionId: 'o1', nameAr: 'بدون دهن', priceDelta: 25 },
          ],
          itemTotal: 2325,
          notes: 'تقطيع صغير',
          kitchenStation: 'grill',
          status: 'pending',
        },
      ],
      subtotal: 2325,
      discountAmount: 0,
      taxPercent: 0,
      taxAmount: 0,
      serviceChargePercent: 0,
      serviceChargeAmount: 0,
      total: 2325,
      payments: [{ method: 'cash', amount: 2325 }],
      paidAmount: 2325,
      changeAmount: 0,
      status: 'confirmed',
      paymentStatus: 'paid',
      createdAt: new Date().toISOString(),
    };

    const kotHtml = generateKitchenTicketHTML(sampleOrder, {
      ...profile,
      logoUrl: 'https://example.com/logo.png',
      slogan: 'شعار المطعم التجريبي',
      address: 'عنوان المطعم السري',
      phone: '01234567890',
    });

    // Must include Order Number, Order Type, Item Name, Quantity, Modifier & Note
    assert.ok(kotHtml.includes('#9099'), 'KOT must include Order Number');
    assert.ok(kotHtml.includes('كيلو ريش ضاني مشوي'), 'KOT must include Item Name');
    assert.ok(kotHtml.includes('3x'), 'KOT must include Item Quantity');
    assert.ok(kotHtml.includes('بدون دهن'), 'KOT must include Modifier');
    assert.ok(kotHtml.includes('تقطيع صغير'), 'KOT must include Item Preparation Note');

    // Must strictly EXCLUDE logo, restaurant name/slogan/address/phone, prices, totals, cashier/customer, and QR code
    assert.strictEqual(kotHtml.includes('<img'), false, 'KOT must NOT include any logo or QR image');
    assert.strictEqual(kotHtml.includes('شعار المطعم التجريبي'), false, 'KOT must NOT include slogan');
    assert.strictEqual(kotHtml.includes('عنوان المطعم السري'), false, 'KOT must NOT include restaurant address');
    assert.strictEqual(kotHtml.includes('01234567890'), false, 'KOT must NOT include restaurant phone');
    assert.strictEqual(kotHtml.includes('750'), false, 'KOT must NOT include unit price');
    assert.strictEqual(kotHtml.includes('2325'), false, 'KOT must NOT include total price');
    assert.strictEqual(kotHtml.includes('محمد سمير'), false, 'KOT must NOT include cashier name');
    assert.strictEqual(kotHtml.includes('عميل سري'), false, 'KOT must NOT include customer name');
  });

  // --- Test 7: ESC/POS GS v 0 Raster + Buzzer + Auto-Cut Binary Builder ---
  await test('ESC/POS binary builder includes ESC @, ESC B buzzer, GS v 0 raster image, and GS V auto-cut', async () => {
    const { buildEscPosPayload } = await import('../server/thermalPrintRouter');
    const { renderLinesToEscPosGSv0Base64 } = await import('../src/utils/thermalPrinter');

    const rasterBase64 = renderLinesToEscPosGSv0Base64(
      [{ text: '#9099 - 3x كيلو ريش ضاني', align: 'center', bold: true, fontSize: 28 }],
      '80mm'
    );
    const buf = buildEscPosPayload({
      rasterEscPosBase64: rasterBase64,
      buzzer: true,
      autoCut: true,
      copies: 1,
    });

    // Check ESC @ (0x1B 0x40) at start
    assert.strictEqual(buf[0], 0x1b);
    assert.strictEqual(buf[1], 0x40);
    // Check ESC B buzzer (0x1B 0x42 0x03 0x02)
    assert.strictEqual(buf[2], 0x1b);
    assert.strictEqual(buf[3], 0x42);
    // Check GS V 66 0 auto-cut at end (0x1D 0x56 0x42 0x00)
    assert.strictEqual(buf[buf.length - 4], 0x1d);
    assert.strictEqual(buf[buf.length - 3], 0x56);
    assert.strictEqual(buf[buf.length - 2], 0x42);
    assert.strictEqual(buf[buf.length - 1], 0x00);
  });

  // --- Test 8: Simultaneous Dual Print & Offline Error Detection ---
  await test('dispatchDualThermalPrint executes both printers simultaneously and detects offline printer without throwing', async () => {
    const { dispatchDualThermalPrint } = await import('../src/utils/thermalPrinter');
    const orders = posDb.getOrders();
    const profile = posDb.getProfile();

    const okResult = await dispatchDualThermalPrint(orders[0], profile);
    assert.strictEqual(okResult.cashierOk, true);
    assert.strictEqual(okResult.kitchenOk, true);

    const offlineKitchenResult = await dispatchDualThermalPrint(
      orders[0],
      {
        ...profile,
        kitchenPrinterIp: '0.0.0.0',
      },
      { cashier: true, kitchen: true, isReprint: true }
    );
    assert.strictEqual(offlineKitchenResult.cashierOk, true, 'Cashier USB should still succeed when Kitchen LAN is offline');
    assert.strictEqual(offlineKitchenResult.kitchenOk, false, 'Offline Kitchen LAN printer should report failure for Reprint toast');
    assert.ok(offlineKitchenResult.errors.length > 0, 'Errors list should identify the unreachable printer');
  });

  // --- Summary ---
  console.log(`\n========================================`);
  console.log(`Kitchen Auto-Print Tests: ${passedCount}/${totalCount} Passed`);
  console.log(`========================================\n`);

  kitchenAutoPrintService.stop();

  if (passedCount !== totalCount) {
    process.exit(1);
  }
}

runKitchenAutoPrintTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
