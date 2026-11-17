import './setup';
import assert from 'assert';
import { posDb } from '../src/services/db';
import {
  roundCurrency,
  roundQty,
  calculateLineItemTotal,
  calculateOrderTotals,
} from '../src/utils/currency';
import { hashSecret, verifySecret, isHashedSecret } from '../src/utils/security';
import { Order, RestaurantTable, User } from '../src/types';

async function runPosCoreTests() {
  console.log('🧪 Starting EL BASHA GRILL POS Core Integrity & Precision Test Suite...\n');
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
      console.error('    ', err?.stack || err?.message || err);
    }
  }

  // --- Test 1: Financial & Quantity Precision (Zero IEEE-754 Drift, 0% Tax/Service) ---
  await test('Financial & quantity rounding eliminates IEEE-754 drift and enforces 0% tax/service', () => {
    assert.strictEqual(roundCurrency(0.1 + 0.2), 0.3);
    assert.strictEqual(roundCurrency(199.995), 200);
    assert.strictEqual(roundQty(0.125 + 0.25), 0.375);

    const line = calculateLineItemTotal(120.33, 15.17, 3);
    assert.strictEqual(line, 406.5);

    const percentDisc = calculateOrderTotals({
      subtotal: 500,
      discountType: 'percent',
      discountValue: 10,
      orderType: 'delivery',
      deliveryFee: 25,
      taxPercent: 0,
      serviceChargePercent: 0,
    });
    assert.strictEqual(percentDisc.discountAmount, 50);
    assert.strictEqual(percentDisc.taxAmount, 0);
    assert.strictEqual(percentDisc.serviceChargeAmount, 0);
    assert.strictEqual(percentDisc.deliveryFee, 25);
    assert.strictEqual(percentDisc.total, 475);

    // Fixed discount capped at subtotal, delivery fee ignored for non-delivery orders
    const fixedDisc = calculateOrderTotals({
      subtotal: 120,
      discountType: 'fixed',
      discountValue: 200,
      orderType: 'takeaway',
      deliveryFee: 30,
      taxPercent: 0,
      serviceChargePercent: 0,
    });
    assert.strictEqual(fixedDisc.discountAmount, 120);
    assert.strictEqual(fixedDisc.deliveryFee, 0);
    assert.strictEqual(fixedDisc.total, 0);
  });

  // --- Test 2: Salted SHA-256 Password & PIN Hashing ---
  await test('Security utilities hash secrets with per-record salt and verify accurately', () => {
    const h1 = hashSecret('Basha@2026');
    const h2 = hashSecret('Basha@2026');
    assert.ok(isHashedSecret(h1), 'Hash must start with sha256$ prefix');
    assert.notStrictEqual(h1, h2, 'Random salt must produce distinct hashes for identical inputs');
    assert.strictEqual(verifySecret('Basha@2026', h1), true);
    assert.strictEqual(verifySecret('WrongPass', h1), false);
    // Double hashing an already-hashed secret should be idempotent
    assert.strictEqual(hashSecret(h1), h1);

    // posDb.saveUser must automatically hash plaintext passwords
    const testUser: User = {
      id: `usr-test-${Date.now()}`,
      name: 'كاشير اختبار',
      username: 'testcashier',
      password: 'plainPassword123',
      role: 'cashier',
      branchId: 'branch-1',
      active: true,
      createdAt: new Date().toISOString(),
    };
    posDb.saveUser(testUser);
    const saved = posDb.getUsers().find((u) => u.id === testUser.id);
    assert.ok(saved, 'Saved user must exist');
    assert.ok(isHashedSecret(saved?.password), 'posDb.saveUser must convert plaintext password to salted SHA-256');
    assert.strictEqual(verifySecret('plainPassword123', saved?.password), true);
  });

  // --- Test 3: Order Creation -> Inventory Deduction -> Cancel Restock + Shift Reversal ---
  await test('Order creation deducts recipe inventory; cancellation restocks inventory, frees table, and reverses shift sales', () => {
    posDb.resetToCleanState();
    const activeShift = posDb.openShift({
      shiftNumber: 'T-1',
      userId: 'cashier-1',
      userName: 'كاشير الاختبار',
      cashierId: 'cashier-1',
      cashierName: 'كاشير الاختبار',
      branchId: 'branch-1',
      branchName: 'الفرع الرئيسي',
      startTime: new Date().toISOString(),
      openedAt: new Date().toISOString(),
      startingCash: 500,
    });
    assert.strictEqual(activeShift.expectedCash, 500);

    // Setup ingredient, recipe, and table
    posDb.saveIngredient({
      id: 'ing-meat-1',
      name: 'لحم ضاني مفروم',
      unit: 'كجم',
      currentStock: 10,
      minStock: 2,
      costPerUnit: 320,
      isActive: true,
    });
    posDb.saveRecipe({
      id: 'rec-kofta-1',
      productId: 'prod-kofta-1',
      productName: 'كفتة مشوية',
      items: [{ ingredientId: 'ing-meat-1', ingredientName: 'لحم ضاني مفروم', quantity: 0.25, unit: 'كجم' }],
    });
    const table: RestaurantTable = {
      id: 'tbl-test-5',
      number: 'T5',
      branchId: 'branch-1',
      capacity: 4,
      section: 'الصالة الداخلية',
      status: 'available',
    };
    posDb.saveTable(table);

    const order: Order = {
      id: 'ord-inv-1',
      orderNumber: '#5001',
      type: 'dine_in',
      tableId: table.id,
      tableNumber: table.number,
      branchId: 'branch-1',
      branchName: 'الفرع الرئيسي',
      cashierId: 'cashier-1',
      cashierName: 'كاشير الاختبار',
      items: [
        {
          id: 'oi-1',
          productId: 'prod-kofta-1',
          productNameAr: 'كفتة مشوية',
          unitPrice: 200,
          costPrice: 90,
          quantity: 4,
          selectedModifiers: [],
          itemTotal: 800,
          kitchenStation: 'grill',
          status: 'pending',
        },
      ],
      subtotal: 800,
      discountAmount: 0,
      taxPercent: 0,
      taxAmount: 0,
      serviceChargePercent: 0,
      serviceChargeAmount: 0,
      total: 800,
      payments: [{ method: 'cash', amount: 1000 }],
      paidAmount: 1000,
      changeAmount: 200,
      status: 'confirmed',
      paymentStatus: 'paid',
      createdAt: new Date().toISOString(),
    };

    posDb.createOrder(order);

    // Check deduction (4 * 0.25 = 1.0 kg deducted -> 9.0 kg remaining)
    const ingAfterOrder = posDb.getIngredientById('ing-meat-1');
    assert.strictEqual(ingAfterOrder?.currentStock, 9);

    // Check table occupied
    const tableAfterOrder = posDb.getTables().find((t) => t.id === table.id);
    assert.strictEqual(tableAfterOrder?.status, 'occupied');

    // Check shift cash sales (1000 - 200 change = 800)
    const shiftAfterOrder = posDb.getActiveShift();
    assert.strictEqual(shiftAfterOrder?.cashSales, 800);
    assert.strictEqual(shiftAfterOrder?.expectedCash, 1300);

    // Cancel order -> must restock to 10 kg, free table, reverse shift back to 500
    posDb.updateOrderStatus(order.id, 'cancelled', 'admin', 'المدير');
    assert.strictEqual(posDb.getIngredientById('ing-meat-1')?.currentStock, 10);
    assert.strictEqual(posDb.getTables().find((t) => t.id === table.id)?.status, 'available');
    assert.strictEqual(posDb.getActiveShift()?.cashSales, 0);
    assert.strictEqual(posDb.getActiveShift()?.expectedCash, 500);

    // Repeating cancel must NOT double-restock or double-reverse
    posDb.updateOrderStatus(order.id, 'cancelled', 'admin', 'المدير');
    assert.strictEqual(posDb.getIngredientById('ing-meat-1')?.currentStock, 10);
    assert.strictEqual(posDb.getActiveShift()?.expectedCash, 500);
  });

  // --- Test 4: Order Refund & Double-Refund Prevention ---
  await test('refundOrder updates status to refunded, reverses active shift sales once, and rejects double refund', () => {
    const order2: Order = {
      id: 'ord-refund-1',
      orderNumber: '#5002',
      type: 'takeaway',
      branchId: 'branch-1',
      branchName: 'الفرع الرئيسي',
      cashierId: 'cashier-1',
      cashierName: 'كاشير الاختبار',
      items: [
        {
          id: 'oi-2',
          productId: 'prod-kofta-1',
          productNameAr: 'كفتة مشوية',
          unitPrice: 150,
          costPrice: 70,
          quantity: 2,
          selectedModifiers: [],
          itemTotal: 300,
          kitchenStation: 'grill',
          status: 'pending',
        },
      ],
      subtotal: 300,
      discountAmount: 0,
      taxPercent: 0,
      taxAmount: 0,
      serviceChargePercent: 0,
      serviceChargeAmount: 0,
      total: 300,
      payments: [{ method: 'card', amount: 300 }],
      paidAmount: 300,
      changeAmount: 0,
      status: 'completed',
      paymentStatus: 'paid',
      createdAt: new Date().toISOString(),
    };

    posDb.createOrder(order2);
    assert.strictEqual(posDb.getActiveShift()?.cardSales, 300);

    const res1 = posDb.refundOrder({
      orderId: order2.id,
      amount: 300,
      reason: 'استرداد بناءً على طلب العميل',
      method: 'card',
      restockInventory: true,
    });
    assert.strictEqual(res1.success, true);
    assert.strictEqual(res1.order?.status, 'refunded');
    assert.strictEqual(res1.order?.refundedAmount, 300);
    assert.strictEqual(posDb.getActiveShift()?.cardSales, 0);
    assert.strictEqual(posDb.getIngredientById('ing-meat-1')?.currentStock, 10);

    // Double refund attempt rejected
    const res2 = posDb.refundOrder({
      orderId: order2.id,
      amount: 300,
      reason: 'محاولة تكرار',
      method: 'card',
    });
    assert.strictEqual(res2.success, false);
  });

  // --- Test 5: Table Transfer & Shift History Persistence ---
  await test('transferTable moves active order & statuses cleanly; closed shifts persist in getShifts()', () => {
    const tFrom: RestaurantTable = { id: 'tbl-a', number: 'T10', branchId: 'branch-1', capacity: 4, section: 'الصالة الرئيسية', status: 'occupied', currentOrderId: 'ord-move-1' };
    const tTo: RestaurantTable = { id: 'tbl-b', number: 'T11', branchId: 'branch-1', capacity: 6, section: 'الصالة الرئيسية', status: 'available' };
    posDb.saveTable(tFrom);
    posDb.saveTable(tTo);

    const transferRes = posDb.transferTable('tbl-a', 'tbl-b', 'cashier-1', 'الكاشير');
    assert.strictEqual(transferRes.success, true);

    const tables = posDb.getTables();
    assert.strictEqual(tables.find((t) => t.id === 'tbl-a')?.status, 'available');
    assert.strictEqual(tables.find((t) => t.id === 'tbl-a')?.currentOrderId, undefined);
    assert.strictEqual(tables.find((t) => t.id === 'tbl-b')?.status, 'occupied');
    assert.strictEqual(tables.find((t) => t.id === 'tbl-b')?.currentOrderId, 'ord-move-1');

    // Close shift and verify it persists in history
    const closed = posDb.closeShift(490, 'تقفيل اختبار');
    assert.strictEqual(closed?.status, 'closed');
    assert.strictEqual(closed?.cashDifference, -10);
    const shifts = posDb.getShifts();
    assert.ok(shifts.some((s) => s.id === closed?.id && s.status === 'closed'));

    // Role visibility: Cashiers MUST NOT see closed/previous shift closings, only Managers/Admins can
    const cashierVisibleAfterClose = posDb.getVisibleShiftsForRole('cashier');
    assert.strictEqual(cashierVisibleAfterClose.length, 0, 'Cashier must not see closed shift history');
    const adminVisibleAfterClose = posDb.getVisibleShiftsForRole('admin');
    assert.ok(adminVisibleAfterClose.some((s) => s.id === closed?.id), 'Admin must see closed shift history');
    const managerVisibleAfterClose = posDb.getVisibleShiftsForRole('manager');
    assert.ok(managerVisibleAfterClose.some((s) => s.id === closed?.id), 'Manager must see closed shift history');
  });

  // --- Test 6: Profile VAT & Service Permanently Forced to 0% ---
  await test('Profile forces defaultTaxPercent, defaultServicePercent, and receiptSettings tax/service flags to 0% / false', () => {
    posDb.updateProfile({
      defaultTaxPercent: 14,
      defaultServicePercent: 12,
      taxRate: 14,
    });
    const prof = posDb.getProfile();
    assert.strictEqual(prof.defaultTaxPercent, 0);
    assert.strictEqual(prof.defaultServicePercent, 0);
    assert.strictEqual(prof.taxRate, 0);
    assert.strictEqual(prof.receiptSettings?.showTax, false);
    assert.strictEqual(prof.receiptSettings?.showServiceCharge, false);
  });

  console.log(`\n========================================`);
  console.log(`POS Core Integrity Tests: ${passedCount}/${totalCount} Passed`);
  console.log(`========================================\n`);

  if (passedCount !== totalCount) {
    process.exit(1);
  }
}

runPosCoreTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
