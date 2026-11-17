import fs from 'fs';
import path from 'path';
import {
  CloudQueueOrder,
  CustomerConversation,
  PublishedCatalog,
  QueueOrderStatus,
} from './types';

const DATA_DIR = path.resolve('data');
const STATE_FILE = path.join(DATA_DIR, 'pos_cloud_sync_state.json');

// Default initial catalog if POS has not yet synced
const DEFAULT_CATALOG: PublishedCatalog = {
  syncedAt: new Date().toISOString(),
  branchId: 'branch-1',
  branchName: 'الفرع الرئيسي - مشويات الباشا',
  currency: 'ج.م',
  taxPercent: 0,
  defaultDeliveryFee: 25,
  minimumOrderAmount: 50,
  deliveryAreas: ['مدينة نصر', 'التجمع الخامس', 'المعادي', 'مصر الجديدة', 'المهندسين', 'الدقي', 'وسط البلد', 'الشيخ زايد', 'أكتوبر'],
  products: [
    {
      id: 'prod-kebab-1kg',
      nameAr: 'كيلو كباب مشوي عالفحم بلدي',
      price: 680,
      available: true,
      categoryId: 'grill',
      kitchenStation: 'grill',
    },
    {
      id: 'prod-kofta-1kg',
      nameAr: 'كيلو كفتة مشوية حاتي',
      price: 450,
      available: true,
      categoryId: 'grill',
      kitchenStation: 'grill',
    },
    {
      id: 'prod-mix-grill',
      nameAr: 'مشكل مشويات الباشا (كباب وكفتة وشيش)',
      price: 320,
      available: true,
      categoryId: 'grill',
      kitchenStation: 'grill',
    },
    {
      id: 'prod-chicken-charcoal',
      nameAr: 'فرخة مشوية على الفحم كاملة مع الأرز',
      price: 240,
      available: true,
      categoryId: 'grill',
      kitchenStation: 'grill',
    },
    {
      id: 'prod-rice-basmati',
      nameAr: 'أرز بسمتي بالمكسرات والخلطة',
      price: 45,
      available: true,
      categoryId: 'sides',
      kitchenStation: 'kitchen',
    },
    {
      id: 'prod-tahina',
      nameAr: 'سلطة طحينة سمسم فاخرة',
      price: 20,
      available: true,
      categoryId: 'salads',
      kitchenStation: 'cold',
    },
    {
      id: 'prod-baba-ghanouj',
      nameAr: 'بابا غنوج مشوي مدخن',
      price: 25,
      available: true,
      categoryId: 'salads',
      kitchenStation: 'cold',
    },
  ],
  modifierGroups: [
    {
      id: 'mod-spiciness',
      nameAr: 'درجة الشطة',
      required: false,
      minSelections: 0,
      maxSelections: 1,
      options: [
        { id: 'opt-regular', nameAr: 'عادي / بدون شطة', priceDelta: 0 },
        { id: 'opt-spicy', nameAr: 'سبايسي حار', priceDelta: 0 },
      ],
    },
  ],
};

export class CloudBackendStorage {
  private static instance: CloudBackendStorage;

  private processedEventIds: Set<string> = new Set();
  private conversations: Map<string, CustomerConversation> = new Map();
  private orderQueue: Map<string, CloudQueueOrder> = new Map();
  private publishedCatalog: PublishedCatalog = DEFAULT_CATALOG;
  private authorizedDeviceTokens: Set<string> = new Set(['el-basha-pos-device-secret-key-prod']);

  private constructor() {
    this.ensureDataDir();
    this.loadState();
  }

  public static getInstance(): CloudBackendStorage {
    if (!CloudBackendStorage.instance) {
      CloudBackendStorage.instance = new CloudBackendStorage();
    }
    return CloudBackendStorage.instance;
  }

  private ensureDataDir(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
    } catch (e) {
      console.warn('[Storage] Could not create data directory:', e);
    }
  }

  private loadState(): void {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const raw = fs.readFileSync(STATE_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.processedEventIds)) {
          this.processedEventIds = new Set(parsed.processedEventIds);
        }
        if (Array.isArray(parsed.conversations)) {
          this.conversations = new Map(parsed.conversations.map((c: CustomerConversation) => [c.customerPhone, c]));
        }
        if (Array.isArray(parsed.orderQueue)) {
          this.orderQueue = new Map(parsed.orderQueue.map((o: CloudQueueOrder) => [o.id, o]));
        }
        if (parsed.publishedCatalog) {
          this.publishedCatalog = parsed.publishedCatalog;
        }
        if (Array.isArray(parsed.authorizedDeviceTokens)) {
          this.authorizedDeviceTokens = new Set(parsed.authorizedDeviceTokens);
        }
      }
    } catch (e) {
      console.warn('[Storage] Could not load state file, using in-memory defaults:', e);
    }
  }

  public persistState(): void {
    try {
      this.ensureDataDir();
      const stateObj = {
        processedEventIds: Array.from(this.processedEventIds).slice(-1000), // Keep last 1000 event IDs
        conversations: Array.from(this.conversations.values()),
        orderQueue: Array.from(this.orderQueue.values()),
        publishedCatalog: this.publishedCatalog,
        authorizedDeviceTokens: Array.from(this.authorizedDeviceTokens),
      };
      fs.writeFileSync(STATE_FILE, JSON.stringify(stateObj, null, 2), 'utf-8');
    } catch (e) {
      console.warn('[Storage] State persistence write error (non-fatal):', e);
    }
  }

  // --- Device Authentication ---
  public validateDeviceToken(token?: string): boolean {
    if (!token) return false;
    const cleanToken = token.replace('Bearer ', '').trim();
    const envToken = process.env.POS_DEVICE_TOKEN;
    if (envToken && cleanToken === envToken) {
      return true;
    }
    return this.authorizedDeviceTokens.has(cleanToken);
  }

  public registerDeviceToken(token: string): void {
    this.authorizedDeviceTokens.add(token);
    this.persistState();
  }

  // --- Webhook Deduplication ---
  public hasEventBeenProcessed(eventId: string): boolean {
    return this.processedEventIds.has(eventId);
  }

  public markEventAsProcessed(eventId: string): void {
    this.processedEventIds.add(eventId);
    this.persistState();
  }

  // --- Customer Conversations ---
  public getConversation(phone: string): CustomerConversation {
    const existing = this.conversations.get(phone);
    if (existing) return existing;

    const newConv: CustomerConversation = {
      customerPhone: phone,
      state: 'idle',
      lastInteractionAt: new Date().toISOString(),
      history: [],
    };
    this.conversations.set(phone, newConv);
    return newConv;
  }

  public saveConversation(conv: CustomerConversation): void {
    this.conversations.set(conv.customerPhone, {
      ...conv,
      lastInteractionAt: new Date().toISOString(),
    });
    this.persistState();
  }

  // --- Catalog Management ---
  public getCatalog(): PublishedCatalog {
    return this.publishedCatalog;
  }

  public updateCatalog(catalogUpdate: Partial<PublishedCatalog>): PublishedCatalog {
    this.publishedCatalog = {
      ...this.publishedCatalog,
      ...catalogUpdate,
      syncedAt: new Date().toISOString(),
    };
    this.persistState();
    return this.publishedCatalog;
  }

  // --- Cloud Order Inbox/Outbox Queue ---
  public enqueueOrder(order: CloudQueueOrder): CloudQueueOrder {
    this.orderQueue.set(order.id, order);
    this.persistState();
    return order;
  }

  public getOrderById(id: string): CloudQueueOrder | undefined {
    return this.orderQueue.get(id);
  }

  public getOrderByExternalId(externalOrderId: string): CloudQueueOrder | undefined {
    for (const order of this.orderQueue.values()) {
      if (order.externalOrderId === externalOrderId) {
        return order;
      }
    }
    return undefined;
  }

  /**
   * Lease pending orders for a device.
   * If an order is already leased but lease has expired, it is re-leased.
   */
  public leasePendingOrders(deviceId: string, limit = 10, leaseDurationSeconds = 60): CloudQueueOrder[] {
    const now = Date.now();
    const results: CloudQueueOrder[] = [];

    for (const order of this.orderQueue.values()) {
      if (results.length >= limit) break;

      const isPending = order.status === 'pending';
      const isExpiredLease =
        order.status === 'leased' &&
        order.leaseExpiresAt &&
        new Date(order.leaseExpiresAt).getTime() < now;

      if (isPending || isExpiredLease) {
        order.status = 'leased';
        order.leasedByDevice = deviceId;
        order.leaseExpiresAt = new Date(now + leaseDurationSeconds * 1000).toISOString();
        order.retryCount = (order.retryCount || 0) + 1;
        order.updatedAt = new Date().toISOString();
        order.auditLogs.push({
          timestamp: new Date().toISOString(),
          action: 'ORDER_LEASED',
          details: `تم حجز الطلب للجهاز [${deviceId}] حتى ${order.leaseExpiresAt} (محاولة ${order.retryCount})`,
          performedBy: deviceId,
        });

        results.push(order);
      }
    }

    if (results.length > 0) {
      this.persistState();
    }

    return results;
  }

  /**
   * Acknowledge an order from the POS device after durable local persistence.
   */
  public acknowledgeOrder(
    orderId: string,
    deviceId: string,
    status: 'accepted' | 'failed' | 'needs_review',
    details?: {
      localSaved: boolean;
      printStatus?: 'printed' | 'failed' | 'pending';
      reason?: string;
    }
  ): { success: boolean; order?: CloudQueueOrder; error?: string } {
    const order = this.orderQueue.get(orderId);
    if (!order) {
      return { success: false, error: 'Order not found in cloud queue' };
    }

    order.status = status;
    order.leaseExpiresAt = null;
    order.updatedAt = new Date().toISOString();

    if (status === 'accepted') {
      order.auditLogs.push({
        timestamp: new Date().toISOString(),
        action: 'ORDER_ACCEPTED_LOCALLY',
        details: `تم تأكيد استلام وحفظ الطلب محلياً بنجاح بواسطة [${deviceId}]. حالة الطباعة: ${details?.printStatus || 'غير محدد'}`,
        performedBy: deviceId,
      });
    } else {
      order.reviewReason = details?.reason || 'فشل الاستلام أو التحقق في نقطة البيع';
      order.auditLogs.push({
        timestamp: new Date().toISOString(),
        action: `ORDER_${status.toUpperCase()}`,
        details: `تحديث الطلب إلى [${status}]: ${order.reviewReason}`,
        performedBy: deviceId,
      });
    }

    this.persistState();
    return { success: true, order };
  }

  public getQueueStats(): {
    total: number;
    pending: number;
    leased: number;
    accepted: number;
    failed: number;
    needs_review: number;
    catalogSyncedAt: string;
  } {
    let pending = 0;
    let leased = 0;
    let accepted = 0;
    let failed = 0;
    let needs_review = 0;

    for (const order of this.orderQueue.values()) {
      if (order.status === 'pending') pending++;
      else if (order.status === 'leased') leased++;
      else if (order.status === 'accepted') accepted++;
      else if (order.status === 'failed') failed++;
      else if (order.status === 'needs_review') needs_review++;
    }

    return {
      total: this.orderQueue.size,
      pending,
      leased,
      accepted,
      failed,
      needs_review,
      catalogSyncedAt: this.publishedCatalog.syncedAt,
    };
  }

  public getAllOrders(): CloudQueueOrder[] {
    return Array.from(this.orderQueue.values());
  }
}

export const cloudStorage = CloudBackendStorage.getInstance();
