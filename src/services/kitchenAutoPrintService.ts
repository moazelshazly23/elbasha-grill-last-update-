/**
 * Background Kitchen Thermal Auto-Print Service
 * 
 * Automatically monitors POS database order status changes.
 * Whenever an order status transitions to 'confirmed' (from POS, web orders, or KDS),
 * this service triggers an immediate, silent background print job to the kitchen thermal printer.
 * 
 * Features:
 * - Robust state transition detection (watches for 'confirmed' status events)
 * - Durable idempotency: Prevents duplicate prints across app reloads & cloud syncs
 * - Sequential print spooling: Queues multiple concurrent confirmed orders safely
 * - Hardware failure tracking: Marks orders with 'printed' or 'failed' status and allows 1-click retry
 * - Audio Chime: Dual-tone kitchen alert bell when a ticket is sent to the printer
 * - Real-time subscription API for UI badges & status indicators
 */

import { posDb } from './db';
import { printKitchenOrderDetailed } from '../utils/thermalPrinter';
import { windowsBridge } from './windowsBridge';
import { Order, RestaurantProfile } from '../types';

export interface KitchenAutoPrintStatus {
  status: 'idle' | 'printing' | 'error' | 'disabled';
  lastPrintedOrderNumber: string | null;
  lastPrintedAt: string | null;
  totalPrintedCount: number;
  failedCount: number;
  pendingQueueLength: number;
  lastError: string | null;
  isEnabled: boolean;
  targetPrinter: string;
}

type KitchenPrintListener = (status: KitchenAutoPrintStatus) => void;

const PRINTED_STORAGE_KEY = 'basha_kitchen_autoprinted_orders_v1';
const MAX_STORED_HISTORY = 500;

class KitchenAutoPrintService {
  private static instance: KitchenAutoPrintService;

  private orderStatusCache: Map<string, Order['status']> = new Map();
  private printedOrdersSet: Set<string> = new Set();
  private printQueue: Order[] = [];
  private isProcessingQueue = false;
  private checkIntervalTimer: any = null;
  private dbUnsubscribe: (() => void) | null = null;
  private listeners: Set<KitchenPrintListener> = new Set();

  private currentStatus: KitchenAutoPrintStatus = {
    status: 'idle',
    lastPrintedOrderNumber: null,
    lastPrintedAt: null,
    totalPrintedCount: 0,
    failedCount: 0,
    pendingQueueLength: 0,
    lastError: null,
    isEnabled: true,
    targetPrinter: 'Rongta RP350 (Kitchen - LAN)',
  };

  private constructor() {
    this.loadPersistedPrintedSet();
    this.initStatusCache();
    this.start();
  }

  public static getInstance(): KitchenAutoPrintService {
    if (!KitchenAutoPrintService.instance) {
      KitchenAutoPrintService.instance = new KitchenAutoPrintService();
    }
    return KitchenAutoPrintService.instance;
  }

  /**
   * Load history of already printed orders from localStorage to prevent duplicate prints
   */
  private loadPersistedPrintedSet(): void {
    try {
      const saved = localStorage.getItem(PRINTED_STORAGE_KEY);
      if (saved) {
        const parsed: string[] = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          this.printedOrdersSet = new Set(parsed);
        }
      }
    } catch (e) {
      console.warn('[KitchenAutoPrintService] Failed to load printed cache:', e);
    }
  }

  /**
   * Persist set of printed orders to avoid reprinting on page refresh
   */
  private savePersistedPrintedSet(): void {
    try {
      const arr = Array.from(this.printedOrdersSet);
      // Keep within max size limit
      const trimmed = arr.length > MAX_STORED_HISTORY ? arr.slice(arr.length - MAX_STORED_HISTORY) : arr;
      localStorage.setItem(PRINTED_STORAGE_KEY, JSON.stringify(trimmed));
    } catch (e) {
      console.warn('[KitchenAutoPrintService] Failed to persist printed cache:', e);
    }
  }

  /**
   * Initialize initial order status map from existing DB records
   */
  private initStatusCache(): void {
    const orders = posDb.getOrders();
    orders.forEach((o) => {
      this.orderStatusCache.set(o.id, o.status);
      if (o.kitchenPrintStatus === 'printed') {
        this.printedOrdersSet.add(o.id);
      }
    });
  }

  /**
   * Start listening for database updates and periodic checks
   */
  public start(): void {
    if (this.dbUnsubscribe) return;

    // 1. Subscribe to reactive db changes
    this.dbUnsubscribe = posDb.subscribe(() => {
      this.evaluateOrders();
    });

    // 2. Fallback periodic check every 3.5 seconds
    this.checkIntervalTimer = setInterval(() => {
      this.evaluateOrders();
    }, 3500);
    if (this.checkIntervalTimer && typeof (this.checkIntervalTimer as any).unref === 'function') {
      (this.checkIntervalTimer as any).unref();
    }

    // Initial evaluation
    this.evaluateOrders();

    windowsBridge.log('info', 'PRINTER', 'تم تشغيل خدمة المراقبة والطباعة التلقائية لبون المطبخ بنجاح');
  }

  /**
   * Stop background service
   */
  public stop(): void {
    if (this.dbUnsubscribe) {
      this.dbUnsubscribe();
      this.dbUnsubscribe = null;
    }
    if (this.checkIntervalTimer) {
      clearInterval(this.checkIntervalTimer);
      this.checkIntervalTimer = null;
    }
    this.currentStatus.status = 'disabled';
    this.notify();
  }

  /**
   * Subscribe to service status updates (for UI indicators)
   */
  public subscribe(listener: KitchenPrintListener): () => void {
    this.listeners.add(listener);
    listener({ ...this.currentStatus });
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const current = { ...this.currentStatus };
    this.listeners.forEach((l) => l(current));
  }

  public getStatus(): KitchenAutoPrintStatus {
    return { ...this.currentStatus };
  }

  /**
   * Main evaluator: Scans orders for transitions to 'confirmed'
   */
  public evaluateOrders(): void {
    const profile = posDb.getProfile();
    const isAutoPrintActive = profile.kitchenAutoPrintOnConfirmed !== false && profile.kitchenAutoPrint !== false;
    this.currentStatus.isEnabled = isAutoPrintActive;
    this.currentStatus.targetPrinter = profile.kitchenPrinterName || 'Rongta RP350 (Kitchen - LAN)';

    if (!isAutoPrintActive) {
      this.currentStatus.status = 'disabled';
      this.notify();
      return;
    }

    const orders = posDb.getOrders();
    const confirmedToPrint: Order[] = [];

    for (const order of orders) {
      const prevStatus = this.orderStatusCache.get(order.id);
      const currentStatus = order.status;

      // Condition 1: Current status is 'confirmed'
      if (currentStatus === 'confirmed') {
        const alreadyPrinted = this.printedOrdersSet.has(order.id) || order.kitchenPrintStatus === 'printed';

        // Condition 2: Order transitioned to 'confirmed' OR is a new order imported as 'confirmed'
        const isTransitionToConfirmed = prevStatus !== 'confirmed';
        const isFreshUnprintedConfirmed = !alreadyPrinted && (!prevStatus || isTransitionToConfirmed);

        if (isFreshUnprintedConfirmed) {
          // Avoid enqueueing multiple times if already queued
          const isAlreadyInQueue = this.printQueue.some((q) => q.id === order.id);
          if (!isAlreadyInQueue) {
            confirmedToPrint.push(order);
          }
        }
      }

      // Update status cache
      this.orderStatusCache.set(order.id, currentStatus);
    }

    if (confirmedToPrint.length > 0) {
      confirmedToPrint.forEach((ord) => {
        this.printQueue.push(ord);
      });
      this.currentStatus.pendingQueueLength = this.printQueue.length;
      this.notify();
      this.processPrintQueue();
    }
  }

  /**
   * Sequential queue processor: Prints kitchen orders one by one safely
   */
  private async processPrintQueue(): Promise<void> {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    try {
      while (this.printQueue.length > 0) {
        const order = this.printQueue[0];
        const profile = posDb.getProfile();

        this.currentStatus.status = 'printing';
        this.currentStatus.pendingQueueLength = this.printQueue.length;
        this.notify();

        windowsBridge.log(
          'info',
          'PRINTER',
          `بدء طباعة بون المطبخ تلقائياً للطلب المؤكد: [${order.orderNumber}] - نوع: ${order.type}`
        );

        let success = false;
        let errorMessage: string | undefined;

        try {
          const printRes = await printKitchenOrderDetailed(order, profile);
          success = printRes.success;
          if (!success) {
            errorMessage = printRes.errorMessage || 'تعذر الطباعة على طابعة المطبخ';
          }
        } catch (err: any) {
          success = false;
          errorMessage = err?.message || 'خطأ غير متوقع أثناء معالجة طباعة المطبخ';
        }

        if (success) {
          // Play acoustic kitchen chime if enabled
          if (profile.kitchenPrintSoundAlert !== false) {
            this.playKitchenChime();
          }

          // Mark order as printed in DB
          posDb.updateOrderKitchenPrintStatus(order.id, 'printed');
          this.printedOrdersSet.add(order.id);
          this.savePersistedPrintedSet();

          this.currentStatus.lastPrintedOrderNumber = order.orderNumber;
          this.currentStatus.lastPrintedAt = new Date().toISOString();
          this.currentStatus.totalPrintedCount += 1;
          this.currentStatus.lastError = null;

          windowsBridge.log(
            'info',
            'PRINTER',
            `✓ تمت طباعة بون المطبخ للطلب ${order.orderNumber} بنجاح`
          );
        } else {
          // Record failure on order
          posDb.updateOrderKitchenPrintStatus(order.id, 'failed', errorMessage);
          this.currentStatus.failedCount += 1;
          this.currentStatus.lastError = errorMessage || 'فشل أمر الطباعة';

          windowsBridge.log(
            'error',
            'PRINTER',
            `✕ فشلت طباعة بون المطبخ للطلب ${order.orderNumber}: ${errorMessage}`
          );
        }

        // Shift processed order from queue
        this.printQueue.shift();
        this.currentStatus.pendingQueueLength = this.printQueue.length;

        // Slight pause (350ms) between tickets for physical thermal printer spooler safety
        if (this.printQueue.length > 0) {
          await new Promise((r) => setTimeout(r, 350));
        }
      }

      this.currentStatus.status = this.currentStatus.failedCount > 0 ? 'error' : 'idle';
      this.notify();
    } finally {
      this.isProcessingQueue = false;
    }
  }

  /**
   * Synthesize clean, pleasant restaurant kitchen chime (two-tone alert)
   */
  public playKitchenChime(): void {
    try {
      if (typeof window === 'undefined') return;
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      const now = ctx.currentTime;

      // Note 1: High crisp ding (880Hz / A5)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(880, now);
      gain1.gain.setValueAtTime(0.18, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.35);

      // Note 2: Harmonic chime (1174Hz / D6) after 120ms
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1174.66, now + 0.12);
      gain2.gain.setValueAtTime(0.22, now + 0.12);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.12);
      osc2.stop(now + 0.6);
    } catch {
      // Audio playback fails silently if user has not interacted with document yet
    }
  }

  /**
   * Explicitly trigger print for an order (manual re-print or test)
   */
  public async triggerPrintForOrder(order: Order, force = false): Promise<boolean> {
    const profile = posDb.getProfile();
    try {
      this.currentStatus.status = 'printing';
      this.notify();

      const res = await printKitchenOrderDetailed(order, profile, { isReprint: force });

      if (res.success) {
        if (profile.kitchenPrintSoundAlert !== false) {
          this.playKitchenChime();
        }
        posDb.updateOrderKitchenPrintStatus(order.id, 'printed');
        this.printedOrdersSet.add(order.id);
        this.savePersistedPrintedSet();

        this.currentStatus.lastPrintedOrderNumber = order.orderNumber;
        this.currentStatus.lastPrintedAt = new Date().toISOString();
        this.currentStatus.status = 'idle';
        this.currentStatus.lastError = null;
        this.notify();
        return true;
      } else {
        const errText = res.errorMessage || 'تعذر طباعة بون المطبخ';
        posDb.updateOrderKitchenPrintStatus(order.id, 'failed', errText);
        this.currentStatus.status = 'error';
        this.currentStatus.lastError = errText;
        this.notify();
        return false;
      }
    } catch (err: any) {
      posDb.updateOrderKitchenPrintStatus(order.id, 'failed', err?.message);
      this.currentStatus.status = 'error';
      this.currentStatus.lastError = err?.message;
      this.notify();
      return false;
    }
  }

  /**
   * Test kitchen printer calibration with dummy grill ticket
   */
  public async testKitchenPrint(): Promise<boolean> {
    const profile = posDb.getProfile();
    const dummyOrder: Order = {
      id: `test-kitchen-${Date.now()}`,
      orderNumber: `ORD-TEST-KITCHEN`,
      type: 'dine_in',
      branchId: 'branch-1',
      branchName: 'الفرع الرئيسي',
      cashierId: 'cashier',
      cashierName: 'تجربة الطابعة',
      tableNumber: '07',
      items: [
        {
          id: 'k-item-1',
          productId: 'p-grill-1',
          productNameAr: 'كيلو مشكل كباب وكفتة ضاني ع الفحم',
          unitPrice: 580,
          costPrice: 340,
          quantity: 1,
          selectedModifiers: [
            {
              groupId: 'g-1',
              groupNameAr: 'التسوية',
              optionId: 'o-1',
              nameAr: 'شوي فحم هادئ',
              priceDelta: 0,
            },
          ],
          itemTotal: 580,
          notes: 'تسوية ممتازة وساخنة مع ليمون وبقدونس',
          kitchenStation: 'grill',
          status: 'pending',
        },
        {
          id: 'k-item-2',
          productId: 'p-cold-1',
          productNameAr: 'سلطة طحينة سمسم + بابا غنوج',
          unitPrice: 35,
          costPrice: 12,
          quantity: 2,
          selectedModifiers: [],
          itemTotal: 70,
          kitchenStation: 'cold',
          status: 'pending',
        },
      ],
      subtotal: 650,
      discountAmount: 0,
      taxPercent: 0,
      taxAmount: 0,
      serviceChargePercent: 0,
      serviceChargeAmount: 0,
      total: 650,
      payments: [],
      paidAmount: 650,
      changeAmount: 0,
      status: 'confirmed',
      paymentStatus: 'paid',
      channel: 'pos',
      kitchenPrintStatus: 'pending',
      createdAt: new Date().toISOString(),
      notes: 'تذكرة تجريبية لمعايرة طابعة بون المطبخ والشواية',
    };

    return this.triggerPrintForOrder(dummyOrder, true);
  }

  /**
   * Retry all orders in DB with failed kitchen print status
   */
  public async retryFailedPrints(): Promise<number> {
    const orders = posDb.getOrders();
    const failedOrders = orders.filter((o) => o.status === 'confirmed' && o.kitchenPrintStatus === 'failed');

    let retriedSuccessCount = 0;
    for (const ord of failedOrders) {
      const ok = await this.triggerPrintForOrder(ord, true);
      if (ok) retriedSuccessCount++;
    }

    this.currentStatus.failedCount = Math.max(0, this.currentStatus.failedCount - retriedSuccessCount);
    this.notify();
    return retriedSuccessCount;
  }
}

export const kitchenAutoPrintService = KitchenAutoPrintService.getInstance();
