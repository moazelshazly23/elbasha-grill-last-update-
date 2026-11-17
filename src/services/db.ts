import {
  RestaurantProfile,
  Branch,
  User,
  UserRole,
  Category,
  Product,
  ModifierGroup,
  Ingredient,
  Recipe,
  RestaurantTable,
  Customer,
  Supplier,
  Order,
  OrderItem,
  PurchaseOrder,
  Expense,
  Shift,
  AuditLog,
  HeldOrder,
  PaymentMethodType,
  OrderPrintStatus,
  KitchenStation,
  KitchenStationStatus,
  KitchenTicket,
  KitchenPrintJobRecord,
  KitchenModificationRecord,
  CancellationRecord,
  KitchenReprintRecord,
  OrderStationState,
  SpecialOffer,
  OfferSaleRecord,
  OfferStatus,
} from '../types';
import {
  initialProfile,
  initialBranches,
  initialUsers,
  initialCategories,
  initialProducts,
  initialModifierGroups,
  initialIngredients,
  initialRecipes,
  initialTables,
  initialCustomers,
  initialSuppliers,
  initialOrders,
  initialExpenses,
  initialActiveShift,
  DEFAULT_KITCHEN_STATIONS,
} from './seedData';
import { windowsBridge } from './windowsBridge';
import {
  bashaSqlite,
  ensureBashaLocalAppDataSQLitePath,
  SQLitePathStatus,
} from './sqlite/bashaSqliteEngine';
import { syncQueue } from './syncQueue';
import { roundCurrency, roundQty } from '../utils/currency';
import { hashSecret, isHashedSecret } from '../utils/security';
import {
  computeOfferOriginalPrice,
  computeOfferSavings,
  expandOrderItemToComponents,
  isOfferCurrentlyValid,
  validateOfferPricing,
} from './specialOffersService';

const STORAGE_KEYS = {
  PROFILE: 'basha_pos_profile_v1',
  BRANCHES: 'basha_pos_branches_v1',
  USERS: 'basha_pos_users_v1',
  CATEGORIES: 'basha_pos_categories_v1',
  PRODUCTS: 'basha_pos_products_v1',
  MODIFIERS: 'basha_pos_modifiers_v1',
  INGREDIENTS: 'basha_pos_ingredients_v1',
  RECIPES: 'basha_pos_recipes_v1',
  TABLES: 'basha_pos_tables_v1',
  CUSTOMERS: 'basha_pos_customers_v1',
  SUPPLIERS: 'basha_pos_suppliers_v1',
  ORDERS: 'basha_pos_orders_v1',
  PURCHASES: 'basha_pos_purchases_v1',
  EXPENSES: 'basha_pos_expenses_v1',
  SHIFTS: 'basha_pos_shifts_v1',
  SHIFTS_HISTORY: 'basha_pos_shifts_history_v1',
  AUDIT_LOGS: 'basha_pos_audit_logs_v1',
  HELD_ORDERS: 'basha_pos_held_orders_v1',
  KITCHEN_STATIONS: 'basha_pos_kitchen_stations_v1',
  KITCHEN_TICKETS: 'basha_pos_kitchen_tickets_v1',
  KITCHEN_PRINT_JOBS: 'basha_pos_kitchen_print_jobs_v1',
  KITCHEN_MODIFICATIONS: 'basha_pos_kitchen_modifications_v1',
  ORDER_CANCELLATIONS: 'basha_pos_order_cancellations_v1',
  KITCHEN_REPRINTS: 'basha_pos_kitchen_reprints_v1',
  OFFERS: 'basha_pos_offers_v1',
  OFFER_SALES: 'basha_pos_offer_sales_v1',
};

const DB_INITIALIZED_KEY = 'basha_pos_clean_prod_v5';

const TABLE_MAP: Record<string, string> = {
  [STORAGE_KEYS.PROFILE]: 'restaurant_profile',
  [STORAGE_KEYS.BRANCHES]: 'branches',
  [STORAGE_KEYS.USERS]: 'users',
  [STORAGE_KEYS.CATEGORIES]: 'categories',
  [STORAGE_KEYS.PRODUCTS]: 'products',
  [STORAGE_KEYS.MODIFIERS]: 'modifier_groups',
  [STORAGE_KEYS.INGREDIENTS]: 'ingredients',
  [STORAGE_KEYS.RECIPES]: 'recipes',
  [STORAGE_KEYS.TABLES]: 'restaurant_tables',
  [STORAGE_KEYS.CUSTOMERS]: 'customers',
  [STORAGE_KEYS.SUPPLIERS]: 'suppliers',
  [STORAGE_KEYS.ORDERS]: 'orders',
  [STORAGE_KEYS.PURCHASES]: 'purchase_orders',
  [STORAGE_KEYS.EXPENSES]: 'expenses',
  [STORAGE_KEYS.SHIFTS]: 'shifts',
  [STORAGE_KEYS.SHIFTS_HISTORY]: 'shifts_history',
  [STORAGE_KEYS.AUDIT_LOGS]: 'audit_logs',
  [STORAGE_KEYS.HELD_ORDERS]: 'held_orders',
  [STORAGE_KEYS.KITCHEN_STATIONS]: 'kitchen_stations',
  [STORAGE_KEYS.KITCHEN_TICKETS]: 'kitchen_tickets',
  [STORAGE_KEYS.KITCHEN_PRINT_JOBS]: 'kitchen_print_jobs',
  [STORAGE_KEYS.KITCHEN_MODIFICATIONS]: 'kitchen_modifications',
  [STORAGE_KEYS.ORDER_CANCELLATIONS]: 'order_cancellations',
  [STORAGE_KEYS.KITCHEN_REPRINTS]: 'kitchen_reprints',
  [STORAGE_KEYS.OFFERS]: 'offers',
  [STORAGE_KEYS.OFFER_SALES]: 'offer_sales',
};

type Listener = () => void;

export class POSDatabase {
  private listeners: Set<Listener> = new Set();
  private sqliteEngine = bashaSqlite;

  constructor() {
    this.initSQLiteDatabase();
    // Subscribe to SQLite engine updates
    this.sqliteEngine.subscribe(() => {
      this.notify();
    });
  }

  /**
   * Guarantees and verifies the SQLite database within %LOCALAPPDATA%
   */
  public ensureLocalAppDataSQLitePath(): SQLitePathStatus {
    const status = ensureBashaLocalAppDataSQLitePath();
    windowsBridge.log('info', 'DB', `تأكيد تشغيل SQLite داخل: ${status.resolvedPath}`);
    return status;
  }

  public getSqliteStats() {
    return this.sqliteEngine.getStats();
  }

  public getSqliteEngine() {
    return this.sqliteEngine;
  }

  private initSQLiteDatabase(): void {
    // 1. Ensure SQLite path in %LOCALAPPDATA%\MosawyatAlBashaPOS\data
    this.ensureLocalAppDataSQLitePath();

    // 2. Check if database has already been initialized
    const isInitialized = localStorage.getItem(DB_INITIALIZED_KEY);

    if (!isInitialized) {
      windowsBridge.log('info', 'DB', 'تهيئة جداول النظام للإنتاج');
      this.seedInitialDataToSQLite();
      localStorage.setItem(DB_INITIALIZED_KEY, 'true');
    }

    // 3. Immediately sync from Windows disk (%LOCALAPPDATA%\MosawyatAlBashaPOS\data)
    this.syncWithWindowsDisk();

    // 4. One-time permanent wipe of all demo/training data (Clean Production)
    const DEMO_PURGE_FLAG = 'basha_zero_demo_data_clean_production_v1';
    if (localStorage.getItem(DEMO_PURGE_FLAG) !== 'true') {
      this.purgeAllDemoDataNow();
      localStorage.setItem(DEMO_PURGE_FLAG, 'true');
    }

    // 5. Migrate legacy shift history key & plaintext user passwords to salted SHA-256
    this.migrateLegacyStorageAndSecurity();

    // 6. Safe non-destructive migration for Single-Printer Multi-Station Kitchen tables
    this.migrateKitchenMultiStationSchema();

    // 7. Safe non-destructive migration for Special Offers tables
    this.migrateSpecialOffersSchema();
  }

  private migrateSpecialOffersSchema(): void {
    try {
      if (localStorage.getItem(STORAGE_KEYS.OFFERS) === null) {
        this.save(STORAGE_KEYS.OFFERS, []);
      } else {
        // Re-sync normalized offer_items rows into SQLite engine on boot
        const existingOffers = this.load<SpecialOffer[]>(STORAGE_KEYS.OFFERS, []);
        if (Array.isArray(existingOffers) && existingOffers.length > 0) {
          this.syncOfferItemsToSQLite(existingOffers);
        }
      }
      if (localStorage.getItem(STORAGE_KEYS.OFFER_SALES) === null) {
        this.save(STORAGE_KEYS.OFFER_SALES, []);
      }
    } catch (err) {
      console.warn('Special offers migration warning:', err);
    }
  }

  private syncOfferItemsToSQLite(offers: SpecialOffer[]): void {
    try {
      this.sqliteEngine.clearTable('offer_items');
      const rows: any[] = [];
      offers.forEach((offer) => {
        (offer.components || []).forEach((comp) => {
          rows.push({
            id: `${offer.id}__${comp.productId}`,
            offer_id: offer.id,
            product_id: comp.productId,
            quantity: comp.quantity,
            unit_price: comp.unitPrice,
            productNameAr: comp.productNameAr,
          });
        });
      });
      if (rows.length > 0) {
        this.sqliteEngine.bulkInsertOrReplace('offer_items', rows);
      }
    } catch (err) {
      console.warn('syncOfferItemsToSQLite warning:', err);
    }
  }

  private migrateKitchenMultiStationSchema(): void {
    try {
      const existingStationsRaw = localStorage.getItem(STORAGE_KEYS.KITCHEN_STATIONS);
      let needsSeed = !existingStationsRaw;
      if (existingStationsRaw) {
        try {
          const parsed = JSON.parse(existingStationsRaw);
          if (!Array.isArray(parsed) || parsed.length === 0) {
            needsSeed = true;
          }
        } catch {
          needsSeed = true;
        }
      }

      if (needsSeed) {
        const seeded = DEFAULT_KITCHEN_STATIONS.map((s) => ({ ...s }));
        this.save(STORAGE_KEYS.KITCHEN_STATIONS, seeded);
      }

      const initEmptyKeys = [
        STORAGE_KEYS.KITCHEN_TICKETS,
        STORAGE_KEYS.KITCHEN_PRINT_JOBS,
        STORAGE_KEYS.KITCHEN_MODIFICATIONS,
        STORAGE_KEYS.ORDER_CANCELLATIONS,
        STORAGE_KEYS.KITCHEN_REPRINTS,
      ];
      initEmptyKeys.forEach((key) => {
        if (localStorage.getItem(key) === null) {
          this.save(key, []);
        }
      });
    } catch (err) {
      console.warn('Kitchen multi-station migration warning:', err);
    }
  }

  private migrateLegacyStorageAndSecurity(): void {
    try {
      const legacyShifts = localStorage.getItem('elbasha_shifts_history');
      if (legacyShifts && !localStorage.getItem(STORAGE_KEYS.SHIFTS_HISTORY)) {
        localStorage.setItem(STORAGE_KEYS.SHIFTS_HISTORY, legacyShifts);
        localStorage.removeItem('elbasha_shifts_history');
      }
      const users = this.getUsers();
      let changed = false;
      const upgraded = users.map((u) => {
        if (u.password && !isHashedSecret(u.password)) {
          changed = true;
          return { ...u, password: hashSecret(u.password) };
        }
        return u;
      });
      if (changed) {
        this.save(STORAGE_KEYS.USERS, upgraded);
      }
    } catch (err) {
      console.warn('Legacy migration warning:', err);
    }
  }

  /**
   * Synchronizes database state directly with Windows local disk files
   * Ensures that newly added or modified data persists, and deleted demo data stays deleted.
   */
  public async syncWithWindowsDisk(): Promise<void> {
    try {
      const diskData = await windowsBridge.loadAllData();
      if (!diskData || Object.keys(diskData).length === 0) {
        return;
      }

      let restoredAny = false;

      // 1. Restore standard STORAGE_KEYS from disk
      Object.entries(STORAGE_KEYS).forEach(([_, storageKey]) => {
        if (diskData[storageKey] !== undefined) {
          const diskVal = diskData[storageKey];
          localStorage.setItem(storageKey, JSON.stringify(diskVal));
          restoredAny = true;

          const tableName = TABLE_MAP[storageKey];
          if (tableName) {
            if (Array.isArray(diskVal)) {
              this.sqliteEngine.clearTable(tableName);
              this.sqliteEngine.bulkInsertOrReplace(tableName, diskVal);
            } else if (diskVal && typeof diskVal === 'object') {
              this.sqliteEngine.insertOrReplace(tableName, { ...diskVal, id: diskVal.id || 'profile_main' });
            }
          }
        }
      });

      // 2. Hydrate SQLite engine with any sqlite_* tables
      this.sqliteEngine.hydrateFromDisk(diskData);

      if (restoredAny) {
        localStorage.setItem(DB_INITIALIZED_KEY, 'true');
        windowsBridge.log('info', 'DB', 'تم مزامنة واسترجاع جميع بيانات النظام بنجاح من قرص Windows (%LOCALAPPDATA%)');
        this.notify();
      }
    } catch (err) {
      console.warn('Sync with Windows disk failed:', err);
    }
  }

  private cleanLegacyDemoSuppliers(): void {
    // Legacy stub
  }

  private seedInitialDataToSQLite(): void {
    this.sqliteEngine.transaction(() => {
      // ONLY initialize if key does not exist yet!
      const existingProfile = localStorage.getItem(STORAGE_KEYS.PROFILE);
      if (!existingProfile) {
        this.sqliteEngine.insertOrReplace('restaurant_profile', { ...initialProfile, id: 'profile_main' });
        localStorage.setItem(STORAGE_KEYS.PROFILE, JSON.stringify(initialProfile));
        windowsBridge.saveData(STORAGE_KEYS.PROFILE, JSON.stringify(initialProfile));
      }

      const existingBranches = localStorage.getItem(STORAGE_KEYS.BRANCHES);
      if (!existingBranches) {
        this.sqliteEngine.bulkInsertOrReplace('branches', initialBranches);
        localStorage.setItem(STORAGE_KEYS.BRANCHES, JSON.stringify(initialBranches));
        windowsBridge.saveData(STORAGE_KEYS.BRANCHES, JSON.stringify(initialBranches));
      }

      const existingUsers = localStorage.getItem(STORAGE_KEYS.USERS);
      if (!existingUsers) {
        this.sqliteEngine.bulkInsertOrReplace('users', initialUsers);
        localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(initialUsers));
        windowsBridge.saveData(STORAGE_KEYS.USERS, JSON.stringify(initialUsers));
      }

      // Initialize remaining business tables to empty array [] only if not present
      const emptyTables: Array<{ key: string; tableName: string; defaultValue: any }> = [
        { key: STORAGE_KEYS.CATEGORIES, tableName: 'categories', defaultValue: [] },
        { key: STORAGE_KEYS.PRODUCTS, tableName: 'products', defaultValue: [] },
        { key: STORAGE_KEYS.MODIFIERS, tableName: 'modifier_groups', defaultValue: [] },
        { key: STORAGE_KEYS.INGREDIENTS, tableName: 'ingredients', defaultValue: [] },
        { key: STORAGE_KEYS.RECIPES, tableName: 'recipes', defaultValue: [] },
        { key: STORAGE_KEYS.TABLES, tableName: 'restaurant_tables', defaultValue: [] },
        { key: STORAGE_KEYS.CUSTOMERS, tableName: 'customers', defaultValue: [] },
        { key: STORAGE_KEYS.SUPPLIERS, tableName: 'suppliers', defaultValue: [] },
        { key: STORAGE_KEYS.ORDERS, tableName: 'orders', defaultValue: [] },
        { key: STORAGE_KEYS.EXPENSES, tableName: 'expenses', defaultValue: [] },
        { key: STORAGE_KEYS.PURCHASES, tableName: 'purchase_orders', defaultValue: [] },
        { key: STORAGE_KEYS.SHIFTS_HISTORY, tableName: 'shifts_history', defaultValue: [] },
        { key: STORAGE_KEYS.HELD_ORDERS, tableName: 'held_orders', defaultValue: [] },
        { key: STORAGE_KEYS.AUDIT_LOGS, tableName: 'audit_logs', defaultValue: [] },
      ];

      emptyTables.forEach(({ key, tableName, defaultValue }) => {
        if (localStorage.getItem(key) === null) {
          localStorage.setItem(key, JSON.stringify(defaultValue));
          this.sqliteEngine.clearTable(tableName);
          windowsBridge.saveData(key, JSON.stringify(defaultValue));
        }
      });
    });

    localStorage.setItem(DB_INITIALIZED_KEY, 'true');
  }

  private load<T>(key: string, defaultValue: T): T {
    try {
      // 1. First priority: Check local storage for exact state (preserves empty [] and live edits)
      const data = localStorage.getItem(key);
      if (data !== null) {
        try {
          const parsed = JSON.parse(data);
          return parsed as T;
        } catch (parseErr) {
          console.warn(`JSON parse error loading ${key}:`, parseErr);
        }
      }

      // 2. Second priority: Query relational SQLite engine
      const tableName = TABLE_MAP[key];
      if (tableName) {
        if (key === STORAGE_KEYS.PROFILE) {
          const rec = this.sqliteEngine.selectById<any>(tableName, 'profile_main');
          if (rec) return rec as T;
        } else if (key === STORAGE_KEYS.SHIFTS) {
          const all = this.sqliteEngine.selectAll<any>(tableName);
          const active = all.find((s) => s.status === 'open') || all[0];
          if (active) return active as T;
        } else {
          const all = this.sqliteEngine.selectAll<any>(tableName);
          if (all !== null && all !== undefined) {
            return all as T;
          }
        }
      }

      // 3. Fallback: defaultValue (only on very first pristine launch)
      return defaultValue;
    } catch (e) {
      console.error(`Failed to load ${key} from SQLite storage:`, e);
      return defaultValue;
    }
  }

  private save<T>(key: string, value: T): void {
    try {
      // 1. Serialize and write to primary LocalStorage
      const serialized = JSON.stringify(value);
      localStorage.setItem(key, serialized);

      // Mark initialized to prevent re-seeding
      localStorage.setItem(DB_INITIALIZED_KEY, 'true');

      // 2. Synchronize to SQLite engine
      const tableName = TABLE_MAP[key];
      if (tableName) {
        if (key === STORAGE_KEYS.PROFILE) {
          this.sqliteEngine.insertOrReplace(tableName, { ...(value as any), id: 'profile_main' });
        } else if (key === STORAGE_KEYS.SHIFTS) {
          if (value && typeof value === 'object') {
            const shiftObj = value as any;
            this.sqliteEngine.insertOrReplace(tableName, { ...shiftObj, id: shiftObj.id || 'active_shift' });
          }
        } else if (Array.isArray(value)) {
          this.sqliteEngine.clearTable(tableName);
          this.sqliteEngine.bulkInsertOrReplace(tableName, value);
        } else if (value && typeof value === 'object') {
          this.sqliteEngine.insertOrReplace(tableName, value as any);
        }
      }

      // 3. Sync to Desktop Local File / Electron bridge inside %LOCALAPPDATA%
      windowsBridge.saveData(key, serialized);

      // 4. Also persist SQLite table snapshot to Windows filesystem
      if (tableName && typeof window !== 'undefined' && (window as any).electronAPI?.sqliteWriteSnapshot) {
        try {
          const records = Array.isArray(value) ? value : value ? [value] : [];
          (window as any).electronAPI.sqliteWriteSnapshot({
            tableName,
            data: JSON.stringify(records),
          });
        } catch (snapErr) {
          console.warn(`Snapshot write error for ${tableName}:`, snapErr);
        }
      }

      // 5. Notify all UI subscribers
      this.notify();
    } catch (e) {
      console.error(`Failed to save ${key} to SQLite storage:`, e);
    }
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((l) => l());
  }

  // --- Profile / Branding ---
  public getProfile(): RestaurantProfile {
    const loaded = this.load<RestaurantProfile>(STORAGE_KEYS.PROFILE, initialProfile);
    const oldReceiptDefaults = ['', 'Xprinter XP-80C (Thermal 80mm)', 'Xprinter XP-80C (Thermal 80mm - USB)', 'Default POS Thermal 80mm'];
    const oldKitchenDefaults = ['', 'Kitchen-Printer-POS80 (Grill)', 'Kitchen-Printer-POS80 (Network LAN)'];

    const normalizedReceiptPrinter =
      !loaded.receiptPrinterName || oldReceiptDefaults.includes(loaded.receiptPrinterName)
        ? 'Rongta RP350 (Cashier - USB)'
        : loaded.receiptPrinterName;

    const normalizedKitchenPrinter =
      !loaded.kitchenPrinterName || oldKitchenDefaults.includes(loaded.kitchenPrinterName)
        ? 'Rongta RP350 (Kitchen - LAN)'
        : loaded.kitchenPrinterName;

    return {
      ...loaded,
      defaultTaxPercent: 0,
      defaultServicePercent: 0,
      taxRate: 0,
      receiptPrinterName: normalizedReceiptPrinter,
      kitchenPrinterName: normalizedKitchenPrinter,
      kitchenAutoPrint: loaded.kitchenAutoPrint ?? true,
      kitchenAutoPrintOnConfirmed: loaded.kitchenAutoPrintOnConfirmed ?? true,
      receiptSettings: loaded.receiptSettings
        ? {
            ...loaded.receiptSettings,
            showTax: false,
            showServiceCharge: false,
            taxRate: 0,
          }
        : initialProfile.receiptSettings,
    };
  }

  public updateProfile(updated: Partial<RestaurantProfile>, userId = 'admin', userName = 'المدير'): RestaurantProfile {
    const current = this.getProfile();
    const next: RestaurantProfile = {
      ...current,
      ...updated,
      defaultTaxPercent: 0,
      defaultServicePercent: 0,
      taxRate: 0,
    };
    this.save(STORAGE_KEYS.PROFILE, next);
    this.logAudit({
      userId,
      userName,
      action: 'تحديث الهوية والإعدادات',
      category: 'settings',
      details: `تم تعديل بيانات وهوية المطعم: ${next.name}`,
    });
    return next;
  }

  // --- Branches ---
  public getBranches(): Branch[] {
    return this.load<Branch[]>(STORAGE_KEYS.BRANCHES, initialBranches);
  }

  public saveBranch(branch: Branch, userId = 'admin', userName = 'المدير'): void {
    const branches = this.getBranches();
    const idx = branches.findIndex((b) => b.id === branch.id);
    if (idx >= 0) {
      branches[idx] = branch;
    } else {
      branches.push(branch);
    }
    this.save(STORAGE_KEYS.BRANCHES, branches);
    syncQueue.enqueue(idx >= 0 ? 'update' : 'create', 'branches', branch.id, branch);
    this.logAudit({
      userId,
      userName,
      action: idx >= 0 ? 'تعديل فرع' : 'إضافة فرع جديد',
      category: 'settings',
      details: `الفرع: ${branch.name}`,
    });
  }

  public deleteBranch(branchId: string, userId = 'admin', userName = 'المدير'): boolean {
    const branches = this.getBranches();
    if (branches.length <= 1) {
      return false; // لا يمكن حذف الفرع الوحيد المتبقي
    }
    const filtered = branches.filter((b) => b.id !== branchId);
    this.save(STORAGE_KEYS.BRANCHES, filtered);
    syncQueue.enqueue('delete', 'branches', branchId, { id: branchId });
    this.logAudit({
      userId,
      userName,
      action: 'حذف فرع',
      category: 'settings',
      details: `معرف الفرع المحذوف: ${branchId}`,
    });
    return true;
  }

  // --- Users & RBAC ---
  public getUsers(): User[] {
    return this.load<User[]>(STORAGE_KEYS.USERS, initialUsers);
  }

  public saveUser(user: User, adminId = 'admin', adminName = 'المدير'): void {
    const users = this.getUsers();
    const idx = users.findIndex((u) => u.id === user.id);
    const normalizedUser: User = {
      ...user,
      password:
        user.password && !isHashedSecret(user.password)
          ? hashSecret(user.password)
          : user.password,
    };
    if (idx >= 0) {
      users[idx] = normalizedUser;
    } else {
      users.push(normalizedUser);
    }
    this.save(STORAGE_KEYS.USERS, users);
    syncQueue.enqueue(idx >= 0 ? 'update' : 'create', 'users', normalizedUser.id, normalizedUser);
    this.logAudit({
      userId: adminId,
      userName: adminName,
      action: idx >= 0 ? 'تعديل مستخدم' : 'إضافة مستخدم جديد',
      category: 'auth',
      details: `المستخدم: ${normalizedUser.name} (${normalizedUser.role})`,
    });
  }

  public deleteUser(userId: string, adminId = 'admin', adminName = 'المدير'): void {
    const users = this.getUsers().filter((u) => u.id !== userId);
    this.save(STORAGE_KEYS.USERS, users);
    syncQueue.enqueue('delete', 'users', userId, { id: userId });
    this.logAudit({
      userId: adminId,
      userName: adminName,
      action: 'حذف مستخدم',
      category: 'auth',
      details: `معرف المستخدم: ${userId}`,
    });
  }

  // --- Categories ---
  public getCategories(): Category[] {
    return this.load<Category[]>(STORAGE_KEYS.CATEGORIES, initialCategories);
  }

  public saveCategory(category: Category): void {
    const cats = this.getCategories();
    const idx = cats.findIndex((c) => c.id === category.id);
    if (idx >= 0) {
      cats[idx] = category;
    } else {
      cats.push(category);
    }
    this.save(STORAGE_KEYS.CATEGORIES, cats);
    syncQueue.enqueue(idx >= 0 ? 'update' : 'create', 'categories', category.id, category);
  }

  public deleteCategory(categoryId: string): void {
    const cats = this.getCategories().filter((c) => c.id !== categoryId);
    this.save(STORAGE_KEYS.CATEGORIES, cats);
    syncQueue.enqueue('delete', 'categories', categoryId, { id: categoryId });
  }

  public loadOfficialBashaMenu(_force = false): void {
    // Deprecated for Clean Production. No demo data is seeded.
  }

  // --- Products ---
  public getProducts(options?: { includeArchived?: boolean }): Product[] {
    const prods = this.load<Product[]>(STORAGE_KEYS.PRODUCTS, initialProducts);
    if (options?.includeArchived) return prods;
    return prods.filter(
      (p) => p.isActive !== false && p.status !== 'archived' && !p.deletedAt && !p.isArchived
    );
  }

  public getArchivedProducts(): Product[] {
    const prods = this.getProducts({ includeArchived: true });
    return prods.filter(
      (p) => p.isActive === false || p.status === 'archived' || !!p.deletedAt || !!p.isArchived
    );
  }

  public getProductById(id: string): Product | undefined {
    const prods = this.getProducts({ includeArchived: true });
    return prods.find((p) => p.id === id);
  }

  public isProductInUse(productId: string): { inUse: boolean; reasons: string[] } {
    const reasons: string[] = [];
    const orders = this.getOrders();
    const usingOrders = orders.filter((o) => o.items?.some((it) => it.productId === productId));
    if (usingOrders.length > 0) {
      reasons.push(`مرتبط بـ ${usingOrders.length} طلب بيع`);
    }
    const recipes = this.getRecipes();
    const recipe = recipes.find((r) => r.productId === productId);
    if (recipe) {
      reasons.push('مرتبط ببطاقة وصفة تحضير');
    }
    return { inUse: reasons.length > 0, reasons };
  }

  public saveProduct(product: Product, userId = 'admin', userName = 'المدير العام'): void {
    const prods = this.getProducts({ includeArchived: true });
    const idx = prods.findIndex((p) => p.id === product.id);
    let oldProduct: Product | null = null;

    if (idx >= 0) {
      oldProduct = { ...prods[idx] };
      prods[idx] = {
        ...prods[idx],
        ...product,
      };
    } else {
      prods.push({
        ...product,
        isActive: product.isActive ?? true,
      });
    }
    this.save(STORAGE_KEYS.PRODUCTS, prods);
    syncQueue.enqueue(idx >= 0 ? 'update' : 'create', 'products', product.id, product);

    if (oldProduct) {
      this.logAudit({
        userId,
        userName,
        action: 'UPDATE_INVENTORY_ITEM',
        category: 'inventory',
        details: `تعديل منتج [${product.nameAr}] (ID: ${product.id}): التكلفة: ${oldProduct.costPrice} -> ${product.costPrice} | السعر: ${oldProduct.price} -> ${product.price} | الرصيد: ${oldProduct.currentStock ?? 0} -> ${product.currentStock ?? 0}`,
      });
    } else {
      this.logAudit({
        userId,
        userName,
        action: 'CREATE_INVENTORY_ITEM',
        category: 'inventory',
        details: `إضافة منتج جديد: [${product.nameAr}] (ID: ${product.id}) بسعر ${product.price} ج.م`,
      });
    }
  }

  public deleteProduct(
    productId: string,
    userId = 'admin',
    userName = 'المدير العام',
    reason?: string
  ): { archived: boolean } {
    const prods = this.getProducts({ includeArchived: true });
    const target = prods.find((p) => p.id === productId);
    if (!target) return { archived: false };

    const usage = this.isProductInUse(productId);
    const now = new Date().toISOString();

    // Strict soft-delete (archiving) instead of hard delete:
    // Never remove records from DB to maintain relational and reporting data integrity.
    target.isActive = false;
    target.available = false;
    target.status = 'archived';
    target.isArchived = true;
    target.deletedAt = now;
    target.deletedBy = userId;

    this.save(STORAGE_KEYS.PRODUCTS, prods);
    this.sqliteEngine.softDelete('products', productId, { deletedBy: userId, reason });

    syncQueue.enqueue('delete', 'products', productId, {
      id: productId,
      name: target.nameAr,
      archived: true,
      deletedAt: now,
      deletedBy: userId,
      reason: reason || 'أرشفة من شاشة المخزون للحفاظ على سلامة التاريخ والمبيعات',
    });

    this.logAudit({
      userId,
      userName,
      action: 'ARCHIVE_INVENTORY_ITEM',
      category: 'inventory',
      details: `أرشفة المنتج وحجبه عن المخزون النشط: [${target.nameAr}] (ID: ${productId}) مع صيانة السجلات التاريخية للطلبات والتقارير ${usage.inUse ? `(${usage.reasons.join(', ')})` : ''}. السبب: ${reason || 'أرشفة بواسطة المسؤول'}`,
    });

    return { archived: true };
  }

  public restoreProduct(
    productId: string,
    userId = 'admin',
    userName = 'المدير العام'
  ): boolean {
    const prods = this.getProducts({ includeArchived: true });
    const target = prods.find((p) => p.id === productId);
    if (!target) return false;

    target.isActive = true;
    target.available = true;
    target.status = 'active';
    target.isArchived = false;
    target.deletedAt = undefined;
    target.deletedBy = undefined;

    this.save(STORAGE_KEYS.PRODUCTS, prods);
    this.sqliteEngine.restoreRecord('products', productId);

    syncQueue.enqueue('update', 'products', productId, target);

    this.logAudit({
      userId,
      userName,
      action: 'RESTORE_INVENTORY_ITEM',
      category: 'inventory',
      details: `إلغاء أرشفة واستعادة المنتج إلى المخزون النشط: [${target.nameAr}] (ID: ${productId})`,
    });

    return true;
  }

  // --- Modifier Groups ---
  public getModifierGroups(): ModifierGroup[] {
    return this.load<ModifierGroup[]>(STORAGE_KEYS.MODIFIERS, initialModifierGroups);
  }

  public saveModifierGroup(group: ModifierGroup): void {
    const groups = this.getModifierGroups();
    const idx = groups.findIndex((g) => g.id === group.id);
    if (idx >= 0) {
      groups[idx] = group;
    } else {
      groups.push(group);
    }
    this.save(STORAGE_KEYS.MODIFIERS, groups);
  }

  // --- Ingredients & Inventory ---
  public getIngredients(options?: { includeArchived?: boolean }): Ingredient[] {
    const ings = this.load<Ingredient[]>(STORAGE_KEYS.INGREDIENTS, initialIngredients);
    if (options?.includeArchived) return ings;
    return ings.filter(
      (i) => i.isActive !== false && i.status !== 'archived' && !i.deletedAt && !i.isArchived
    );
  }

  public getArchivedIngredients(): Ingredient[] {
    const ings = this.getIngredients({ includeArchived: true });
    return ings.filter(
      (i) => i.isActive === false || i.status === 'archived' || !!i.deletedAt || !!i.isArchived
    );
  }

  public getIngredientById(id: string): Ingredient | undefined {
    const ings = this.getIngredients({ includeArchived: true });
    return ings.find((i) => i.id === id);
  }

  public isIngredientInUse(ingredientId: string): { inUse: boolean; reasons: string[] } {
    const reasons: string[] = [];

    // Check recipes
    const recipes = this.getRecipes();
    const usingRecipes = recipes.filter((r) => r.items?.some((it) => it.ingredientId === ingredientId));
    if (usingRecipes.length > 0) {
      reasons.push(`مرتبط بـ ${usingRecipes.length} وصفة`);
    }

    // Check purchases
    const purchases = this.getPurchases();
    const usingPurchases = purchases.filter((p) => p.items?.some((it) => it.ingredientId === ingredientId));
    if (usingPurchases.length > 0) {
      reasons.push(`مرتبط بـ ${usingPurchases.length} أمر شراء`);
    }

    return {
      inUse: reasons.length > 0,
      reasons,
    };
  }

  public saveIngredient(ingredient: Ingredient, userId = 'admin', userName = 'المدير العام'): void {
    const ings = this.getIngredients({ includeArchived: true });
    const idx = ings.findIndex((i) => i.id === ingredient.id);
    let oldIngredient: Ingredient | null = null;

    if (idx >= 0) {
      oldIngredient = { ...ings[idx] };
      ings[idx] = {
        ...ings[idx],
        ...ingredient,
        updatedAt: new Date().toISOString(),
      };
    } else {
      ings.push({
        ...ingredient,
        isActive: ingredient.isActive ?? true,
        status: ingredient.status ?? 'active',
        updatedAt: new Date().toISOString(),
      });
    }

    this.save(STORAGE_KEYS.INGREDIENTS, ings);
    syncQueue.enqueue(idx >= 0 ? 'update' : 'create', 'ingredients', ingredient.id, ingredient);

    if (oldIngredient) {
      this.logAudit({
        userId,
        userName,
        action: 'UPDATE_INVENTORY_ITEM',
        category: 'inventory',
        details: `تعديل المادة الخام [${ingredient.name}] (ID: ${ingredient.id}): التكلفة: ${oldIngredient.costPerUnit} -> ${ingredient.costPerUnit} ج.م | الحد الأدنى: ${oldIngredient.minStock} -> ${ingredient.minStock} ${ingredient.unit} | الرصيد: ${oldIngredient.currentStock} -> ${ingredient.currentStock} ${ingredient.unit}`,
      });
    } else {
      this.logAudit({
        userId,
        userName,
        action: 'CREATE_INVENTORY_ITEM',
        category: 'inventory',
        details: `إضافة مادة خام جديدة: [${ingredient.name}] (ID: ${ingredient.id}) برصيد ${ingredient.currentStock} ${ingredient.unit} وتكلفة ${ingredient.costPerUnit} ج.م`,
      });
    }
  }

  public deleteIngredient(
    ingredientId: string,
    userId = 'admin',
    userName = 'المدير العام',
    reason?: string
  ): { archived: boolean } {
    const ings = this.getIngredients({ includeArchived: true });
    const target = ings.find((i) => i.id === ingredientId);
    if (!target) return { archived: false };

    const usage = this.isIngredientInUse(ingredientId);
    const now = new Date().toISOString();

    // Strict soft-delete (archiving) instead of hard delete:
    // Never remove records from DB to maintain relational and reporting data integrity.
    target.isActive = false;
    target.status = 'archived';
    target.isArchived = true;
    target.deletedAt = now;
    target.deletedBy = userId;

    this.save(STORAGE_KEYS.INGREDIENTS, ings);
    this.sqliteEngine.softDelete('ingredients', ingredientId, { deletedBy: userId, reason });

    syncQueue.enqueue('delete', 'ingredients', ingredientId, {
      id: ingredientId,
      name: target.name,
      archived: true,
      deletedAt: now,
      deletedBy: userId,
      reason: reason || 'أرشفة من شاشة المخزون للحفاظ على سلامة التاريخ والمشتريات',
    });

    this.logAudit({
      userId,
      userName,
      action: 'ARCHIVE_INVENTORY_ITEM',
      category: 'inventory',
      details: `أرشفة المادة الخام وحجبها عن المخزون النشط: [${target.name}] (ID: ${ingredientId}) مع صيانة السجلات التاريخية للوصفات والمشتريات ${usage.inUse ? `(${usage.reasons.join(', ')})` : ''}. السبب: ${reason || 'أرشفة بواسطة المسؤول'}`,
    });

    return { archived: true };
  }

  public restoreIngredient(
    ingredientId: string,
    userId = 'admin',
    userName = 'المدير العام'
  ): boolean {
    const ings = this.getIngredients({ includeArchived: true });
    const target = ings.find((i) => i.id === ingredientId);
    if (!target) return false;

    target.isActive = true;
    target.status = 'active';
    target.isArchived = false;
    target.deletedAt = undefined;
    target.deletedBy = undefined;

    this.save(STORAGE_KEYS.INGREDIENTS, ings);
    this.sqliteEngine.restoreRecord('ingredients', ingredientId);

    syncQueue.enqueue('update', 'ingredients', ingredientId, target);

    this.logAudit({
      userId,
      userName,
      action: 'RESTORE_INVENTORY_ITEM',
      category: 'inventory',
      details: `إلغاء أرشفة واستعادة المادة الخام إلى المخزون النشط: [${target.name}] (ID: ${ingredientId})`,
    });

    return true;
  }

  public adjustStock(
    ingredientId: string,
    quantityDelta: number,
    reasonOrType: string,
    reason?: string,
    userId = 'system',
    userName = 'النظام'
  ): void {
    const ings = this.getIngredients({ includeArchived: true });
    const target = ings.find((i) => i.id === ingredientId);
    if (!target) return;
    target.currentStock = Math.max(0, Number((target.currentStock + quantityDelta).toFixed(2)));
    this.save(STORAGE_KEYS.INGREDIENTS, ings);
    syncQueue.enqueue('update', 'ingredients', ingredientId, target);
    const effectiveReason = reason || reasonOrType;
    this.logAudit({
      userId,
      userName,
      action: 'تسوية مخزون',
      category: 'inventory',
      details: `${target.name}: تعديل بمقدار ${quantityDelta > 0 ? '+' : ''}${quantityDelta} ${target.unit} (${effectiveReason})`,
    });
  }

  public adjustProductStock(
    productId: string,
    quantityDelta: number,
    reasonOrType: string,
    reason?: string,
    userId = 'system',
    userName = 'النظام'
  ): void {
    const prods = this.getProducts({ includeArchived: true });
    const target = prods.find((p) => p.id === productId);
    if (!target) return;
    target.currentStock = Math.max(0, Number(((target.currentStock || 0) + quantityDelta).toFixed(2)));
    this.save(STORAGE_KEYS.PRODUCTS, prods);
    syncQueue.enqueue('update', 'products', productId, target);
    const effectiveReason = reason || reasonOrType;
    this.logAudit({
      userId,
      userName,
      action: 'تسوية مخزون منتج',
      category: 'inventory',
      details: `${target.nameAr}: تعديل بمقدار ${quantityDelta > 0 ? '+' : ''}${quantityDelta} (${effectiveReason})`,
    });
  }

  // --- Recipes ---
  public getRecipes(): Recipe[] {
    return this.load<Recipe[]>(STORAGE_KEYS.RECIPES, initialRecipes);
  }

  public saveRecipe(recipe: Recipe): void {
    const recipes = this.getRecipes();
    const idx = recipes.findIndex((r) => r.id === recipe.id || r.productId === recipe.productId);
    if (idx >= 0) {
      recipes[idx] = recipe;
    } else {
      recipes.push(recipe);
    }
    this.save(STORAGE_KEYS.RECIPES, recipes);
    syncQueue.enqueue(idx >= 0 ? 'update' : 'create', 'recipes', recipe.productId, recipe);
  }

  public deleteRecipe(productId: string): void {
    const recipes = this.getRecipes().filter((r) => r.productId !== productId);
    this.save(STORAGE_KEYS.RECIPES, recipes);
    syncQueue.enqueue('delete', 'recipes', productId, { productId });
  }

  // --- Automatic Recipe Deduction & Restock (Supports Regular Items & Multi-Item Offers) ---
  public deductInventoryForOrder(order: Order): void {
    const recipes = this.getRecipes();
    const ings = this.getIngredients({ includeArchived: true });
    const productsMap = new Map(this.getProducts({ includeArchived: true }).map((p) => [p.id, p]));
    let deductionsCount = 0;

    order.items.forEach((item) => {
      const expanded = expandOrderItemToComponents(item, productsMap);
      expanded.forEach((comp) => {
        const recipe = recipes.find((r) => r.productId === comp.productId);
        if (!recipe) return;

        recipe.items.forEach((recItem) => {
          const targetIng = ings.find((i) => i.id === recItem.ingredientId);
          if (targetIng) {
            const totalDeduction = roundQty(recItem.quantity * comp.quantity);
            targetIng.currentStock = Math.max(0, roundQty(targetIng.currentStock - totalDeduction));
            deductionsCount++;
          }
        });
      });
    });

    if (deductionsCount > 0) {
      this.save(STORAGE_KEYS.INGREDIENTS, ings);
      this.logAudit({
        userId: order.cashierId,
        userName: order.cashierName,
        action: 'خصم تلقائي للمخزون (وصفات)',
        category: 'inventory',
        details: `تم خصم مكونات الطلب ${order.orderNumber} تلقائياً من المستودع`,
      });
    }
  }

  public restockInventoryForOrder(
    order: Order,
    reason = 'إلغاء / استرداد طلب',
    userId = 'system',
    userName = 'النظام'
  ): number {
    const recipes = this.getRecipes();
    const ings = this.getIngredients({ includeArchived: true });
    const productsMap = new Map(this.getProducts({ includeArchived: true }).map((p) => [p.id, p]));
    let restockedCount = 0;

    order.items.forEach((item) => {
      if (item.cancelled || item.status === 'cancelled') return;
      const expanded = expandOrderItemToComponents(item, productsMap);
      expanded.forEach((comp) => {
        const recipe = recipes.find((r) => r.productId === comp.productId);
        if (!recipe) return;

        recipe.items.forEach((recItem) => {
          const targetIng = ings.find((i) => i.id === recItem.ingredientId);
          if (targetIng) {
            const qtyBack = roundQty(recItem.quantity * comp.quantity);
            targetIng.currentStock = roundQty(targetIng.currentStock + qtyBack);
            restockedCount++;
          }
        });
      });
    });

    if (restockedCount > 0) {
      this.save(STORAGE_KEYS.INGREDIENTS, ings);
      this.logAudit({
        userId,
        userName,
        action: 'إرجاع مخزون الطلب (Restock)',
        category: 'inventory',
        details: `تم إرجاع مكونات الطلب ${order.orderNumber} إلى المستودع (${reason})`,
      });
    }
    return restockedCount;
  }

  /**
   * Apply net incremental recipe inventory deltas safely without double deduction.
   * quantityDelta > 0 deducts ingredients; quantityDelta < 0 restores ingredients.
   */
  public applyIncrementalRecipeInventoryDelta(
    deltas: Array<{ productId: string; quantityDelta: number }>,
    reason: string,
    userId = 'cashier',
    userName = 'الكاشير'
  ): number {
    if (!deltas || deltas.length === 0) return 0;
    const recipes = this.getRecipes();
    const ings = this.getIngredients({ includeArchived: true });
    let touched = 0;

    deltas.forEach(({ productId, quantityDelta }) => {
      if (!quantityDelta || Math.abs(quantityDelta) < 0.0001) return;
      const recipe = recipes.find((r) => r.productId === productId);
      if (!recipe) return;

      recipe.items.forEach((recItem) => {
        const targetIng = ings.find((i) => i.id === recItem.ingredientId);
        if (!targetIng) return;
        const deltaStock = roundQty(recItem.quantity * quantityDelta);
        if (deltaStock > 0) {
          targetIng.currentStock = Math.max(0, roundQty(targetIng.currentStock - deltaStock));
        } else {
          targetIng.currentStock = roundQty(targetIng.currentStock + Math.abs(deltaStock));
        }
        touched++;
      });
    });

    if (touched > 0) {
      this.save(STORAGE_KEYS.INGREDIENTS, ings);
      this.logAudit({
        userId,
        userName,
        action: 'تعديل مخزون المكونات الصافي',
        category: 'inventory',
        details: `${reason} (عدد التحديثات: ${touched})`,
      });
    }
    return touched;
  }

  // =========================================================================
  // Single-Printer Multi-Station Kitchen Management
  // =========================================================================

  public getKitchenStations(options?: { enabledOnly?: boolean }): KitchenStation[] {
    const loaded = this.load<KitchenStation[]>(STORAGE_KEYS.KITCHEN_STATIONS, DEFAULT_KITCHEN_STATIONS);
    const list = Array.isArray(loaded) && loaded.length > 0 ? loaded : DEFAULT_KITCHEN_STATIONS;
    const sorted = [...list].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    if (options?.enabledOnly) {
      return sorted.filter((s) => s.enabled !== false);
    }
    return sorted;
  }

  public saveKitchenStation(
    station: KitchenStation,
    userId = 'admin',
    userName = 'المدير العام'
  ): KitchenStation {
    const stations = this.getKitchenStations();
    const cleanCode = station.code
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_]+/g, '_');
    const normalized: KitchenStation = {
      ...station,
      id: station.id || cleanCode || `STATION_${Date.now()}`,
      code: cleanCode || station.id,
      printerId: station.printerId || 'shared_kitchen_printer',
      createdAt: station.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const idx = stations.findIndex((s) => s.id === normalized.id || s.code === normalized.code);
    if (idx >= 0) {
      stations[idx] = normalized;
    } else {
      stations.push(normalized);
    }
    this.save(STORAGE_KEYS.KITCHEN_STATIONS, stations);
    this.logAudit({
      userId,
      userName,
      action: idx >= 0 ? 'تعديل محطة مطبخ' : 'إضافة محطة مطبخ جديدة',
      category: 'settings',
      details: `${normalized.nameAr} (${normalized.code}) - الحالة: ${normalized.enabled ? 'مفعلة' : 'معطلة'}`,
    });
    return normalized;
  }

  public toggleKitchenStation(
    stationId: string,
    enabled: boolean,
    userId = 'admin',
    userName = 'المدير العام'
  ): KitchenStation | null {
    const stations = this.getKitchenStations();
    const target = stations.find((s) => s.id === stationId || s.code === stationId);
    if (!target) return null;
    if (!enabled && stations.filter((s) => s.enabled && s.id !== target.id).length === 0) {
      return target; // Keep at least one enabled station
    }
    target.enabled = enabled;
    target.updatedAt = new Date().toISOString();
    this.save(STORAGE_KEYS.KITCHEN_STATIONS, stations);
    this.logAudit({
      userId,
      userName,
      action: enabled ? 'تفعيل محطة مطبخ' : 'تعطيل محطة مطبخ',
      category: 'settings',
      details: `محطة ${target.nameAr} (${target.code}) أصبحت ${enabled ? 'مفعلة' : 'معطلة'}`,
    });
    return target;
  }

  public deleteKitchenStation(
    stationId: string,
    userId = 'admin',
    userName = 'المدير العام'
  ): boolean {
    const stations = this.getKitchenStations();
    const remaining = stations.filter((s) => s.id !== stationId);
    if (remaining.length === 0 || remaining.filter((s) => s.enabled).length === 0) {
      return false;
    }
    const target = stations.find((s) => s.id === stationId);
    this.save(STORAGE_KEYS.KITCHEN_STATIONS, remaining);
    if (target) {
      this.logAudit({
        userId,
        userName,
        action: 'حذف محطة مطبخ',
        category: 'settings',
        details: `تم حذف المحطة ${target.nameAr} (${target.code})`,
      });
    }
    return true;
  }

  public resolveStationForProductOrItem(
    rawStation?: string,
    productId?: string
  ): KitchenStation {
    const allStations = this.getKitchenStations();
    const enabledStations = allStations.filter((s) => s.enabled !== false);
    const pool = enabledStations.length > 0 ? enabledStations : allStations;

    let candidate = rawStation?.trim();
    if (!candidate && productId) {
      const prod = this.getProductById(productId);
      candidate = prod?.stationId || prod?.kitchenStation;
    }

    const legacyMap: Record<string, string> = {
      grill: 'GRILL_STATION',
      kitchen: 'GRILL_STATION',
      cold: 'SANDWICH_STATION',
      pizza: 'PIZZA_STATION',
      crepe: 'CREPE_STATION',
      sandwich: 'SANDWICH_STATION',
    };

    const normalizedKey = candidate ? (legacyMap[candidate.toLowerCase()] || candidate).toUpperCase() : 'GRILL_STATION';

    const exactEnabled = enabledStations.find(
      (s) => s.id.toUpperCase() === normalizedKey || s.code.toUpperCase() === normalizedKey
    );
    if (exactEnabled) return exactEnabled;

    const grillFallback = enabledStations.find((s) => s.id === 'GRILL_STATION' || s.code === 'GRILL_STATION');
    if (grillFallback) return grillFallback;

    return pool[0] || DEFAULT_KITCHEN_STATIONS[2];
  }

  public getKitchenTickets(filter?: { orderId?: string; stationId?: string }): KitchenTicket[] {
    let tickets = this.load<KitchenTicket[]>(STORAGE_KEYS.KITCHEN_TICKETS, []);
    if (filter?.orderId) {
      tickets = tickets.filter((t) => t.orderId === filter.orderId);
    }
    if (filter?.stationId) {
      tickets = tickets.filter((t) => t.stationId === filter.stationId);
    }
    return tickets;
  }

  public saveKitchenTicket(ticket: KitchenTicket): KitchenTicket {
    const tickets = this.getKitchenTickets();
    const idx = tickets.findIndex((t) => t.id === ticket.id);
    const updated = { ...ticket, updatedAt: new Date().toISOString() };
    if (idx >= 0) {
      tickets[idx] = updated;
    } else {
      tickets.unshift(updated);
    }
    if (tickets.length > 1000) tickets.length = 1000;
    this.save(STORAGE_KEYS.KITCHEN_TICKETS, tickets);
    return updated;
  }

  public saveKitchenTicketsBatch(newOrUpdated: KitchenTicket[]): void {
    const tickets = this.getKitchenTickets();
    const now = new Date().toISOString();
    newOrUpdated.forEach((t) => {
      const idx = tickets.findIndex((existing) => existing.id === t.id);
      const record = { ...t, updatedAt: now };
      if (idx >= 0) {
        tickets[idx] = record;
      } else {
        tickets.unshift(record);
      }
    });
    if (tickets.length > 1000) tickets.length = 1000;
    this.save(STORAGE_KEYS.KITCHEN_TICKETS, tickets);
  }

  public getKitchenPrintJobs(): KitchenPrintJobRecord[] {
    return this.load<KitchenPrintJobRecord[]>(STORAGE_KEYS.KITCHEN_PRINT_JOBS, []);
  }

  public saveKitchenPrintJob(job: KitchenPrintJobRecord): KitchenPrintJobRecord {
    const jobs = this.getKitchenPrintJobs();
    const idx = jobs.findIndex((j) => j.jobId === job.jobId);
    if (idx >= 0) {
      jobs[idx] = job;
    } else {
      jobs.unshift(job);
    }
    if (jobs.length > 1000) jobs.length = 1000;
    this.save(STORAGE_KEYS.KITCHEN_PRINT_JOBS, jobs);
    return job;
  }

  public saveKitchenPrintJobsBatch(newOrUpdated: KitchenPrintJobRecord[]): void {
    const jobs = this.getKitchenPrintJobs();
    newOrUpdated.forEach((job) => {
      const idx = jobs.findIndex((existing) => existing.jobId === job.jobId);
      if (idx >= 0) {
        jobs[idx] = job;
      } else {
        jobs.unshift(job);
      }
    });
    if (jobs.length > 1000) jobs.length = 1000;
    this.save(STORAGE_KEYS.KITCHEN_PRINT_JOBS, jobs);
  }

  public getKitchenModifications(orderId?: string): KitchenModificationRecord[] {
    const list = this.load<KitchenModificationRecord[]>(STORAGE_KEYS.KITCHEN_MODIFICATIONS, []);
    return orderId ? list.filter((m) => m.orderId === orderId) : list;
  }

  public saveKitchenModification(record: KitchenModificationRecord): void {
    const list = this.getKitchenModifications();
    list.unshift(record);
    if (list.length > 500) list.length = 500;
    this.save(STORAGE_KEYS.KITCHEN_MODIFICATIONS, list);
  }

  public getOrderCancellations(orderId?: string): CancellationRecord[] {
    const list = this.load<CancellationRecord[]>(STORAGE_KEYS.ORDER_CANCELLATIONS, []);
    return orderId ? list.filter((c) => c.orderId === orderId) : list;
  }

  public saveOrderCancellation(record: CancellationRecord): void {
    const list = this.getOrderCancellations();
    list.unshift(record);
    if (list.length > 500) list.length = 500;
    this.save(STORAGE_KEYS.ORDER_CANCELLATIONS, list);
  }

  public getKitchenReprints(orderId?: string): KitchenReprintRecord[] {
    const list = this.load<KitchenReprintRecord[]>(STORAGE_KEYS.KITCHEN_REPRINTS, []);
    return orderId ? list.filter((r) => r.orderId === orderId) : list;
  }

  public saveKitchenReprint(record: KitchenReprintRecord): void {
    const list = this.getKitchenReprints();
    list.unshift(record);
    if (list.length > 500) list.length = 500;
    this.save(STORAGE_KEYS.KITCHEN_REPRINTS, list);
  }

  public computeOverallKitchenStatus(states: OrderStationState[]): KitchenStationStatus {
    if (!states || states.length === 0) return 'NEW';
    const active = states.filter((s) => s.status !== 'CANCELLED');
    if (active.length === 0) return 'CANCELLED';
    if (active.every((s) => s.status === 'READY')) return 'READY';
    if (active.some((s) => s.status === 'PREPARING') || active.some((s) => s.status === 'READY')) {
      return 'PREPARING';
    }
    if (active.some((s) => s.status === 'PRINTED')) return 'PRINTED';
    return 'NEW';
  }

  public updateOrderStationStatus(
    orderId: string,
    stationId: string,
    nextStatus: KitchenStationStatus,
    userId = 'kitchen',
    userName = 'المطبخ'
  ): Order | null {
    const orders = this.getOrders();
    const order = orders.find((o) => o.id === orderId);
    if (!order) return null;

    const now = new Date().toISOString();
    const states = [...(order.stationStates || [])];
    const targetIdx = states.findIndex((s) => s.stationId === stationId);
    const stationObj = this.resolveStationForProductOrItem(stationId);

    if (targetIdx >= 0) {
      states[targetIdx] = {
        ...states[targetIdx],
        status: nextStatus,
        updatedAt: now,
        updatedBy: userName,
      };
    } else {
      states.push({
        stationId: stationObj.id,
        stationCode: stationObj.code,
        stationNameAr: stationObj.nameAr,
        stationNameEn: stationObj.nameEn,
        status: nextStatus,
        printStatus: nextStatus === 'PRINTED' ? 'completed' : 'pending',
        updatedAt: now,
        updatedBy: userName,
      });
    }

    order.stationStates = states;
    order.overallKitchenStatus = this.computeOverallKitchenStatus(states);
    order.updatedAt = now;

    // Map station item statuses carefully (expanding multi-station offer items accurately)
    order.items = order.items.map((it) => {
      if (it.cancelled || it.status === 'cancelled') return it;
      if (it.itemType === 'offer' && it.offerComponents?.length) {
        const hasStationComp = it.offerComponents.some(
          (c) => this.resolveStationForProductOrItem(c.stationId, c.productId).id === stationId
        );
        if (!hasStationComp) return it;
        const nextStatusForItem: OrderItem['status'] =
          order.overallKitchenStatus === 'READY'
            ? 'ready'
            : order.overallKitchenStatus === 'CANCELLED'
            ? 'cancelled'
            : 'preparing';
        return { ...it, status: nextStatusForItem };
      }
      const itemStation = this.resolveStationForProductOrItem(it.stationId || it.kitchenStation, it.productId);
      if (itemStation.id !== stationId) return it;
      const mappedItemStatus: OrderItem['status'] =
        nextStatus === 'CANCELLED'
          ? 'cancelled'
          : nextStatus === 'READY'
          ? 'ready'
          : nextStatus === 'PREPARING'
          ? 'preparing'
          : 'pending';
      return { ...it, status: mappedItemStatus };
    });

    // Update overall order status ONLY cleanly based on all stations
    if (order.status !== 'cancelled' && order.status !== 'refunded') {
      if (order.overallKitchenStatus === 'READY') {
        order.status = 'ready';
      } else if (order.overallKitchenStatus === 'PREPARING' || order.overallKitchenStatus === 'PRINTED') {
        if (order.status !== 'completed') {
          order.status = 'preparing';
          if (!order.prepStartedAt) order.prepStartedAt = now;
        }
      } else if (order.overallKitchenStatus === 'CANCELLED') {
        order.status = 'cancelled';
      }
    }

    // Keep station's latest tickets synced
    const tickets = this.getKitchenTickets();
    let ticketsChanged = false;
    tickets.forEach((t, idx) => {
      if (t.orderId === orderId && t.stationId === stationId && t.ticketType !== 'CANCELLATION') {
        tickets[idx] = { ...t, status: nextStatus, updatedAt: now };
        ticketsChanged = true;
      }
    });
    if (ticketsChanged) {
      this.save(STORAGE_KEYS.KITCHEN_TICKETS, tickets);
    }

    this.save(STORAGE_KEYS.ORDERS, orders);
    syncQueue.enqueue('update', 'orders', order.id, order);

    this.logAudit({
      userId,
      userName,
      action: 'تحديث حالة محطة المطبخ',
      category: 'order',
      details: `الطلب ${order.orderNumber} | محطة ${stationObj.nameAr} -> ${nextStatus} | الحالة الإجمالية: ${order.overallKitchenStatus}`,
    });

    return order;
  }

  public saveUpdatedOrder(updatedOrder: Order): Order {
    const orders = this.getOrders();
    const idx = orders.findIndex((o) => o.id === updatedOrder.id);
    if (idx >= 0) {
      orders[idx] = updatedOrder;
    } else {
      orders.unshift(updatedOrder);
    }
    this.save(STORAGE_KEYS.ORDERS, orders);
    syncQueue.enqueue('update', 'orders', updatedOrder.id, updatedOrder);
    return updatedOrder;
  }

  public updateOrderStationPrintState(
    orderId: string,
    stationId: string,
    printStatus: 'pending' | 'printing' | 'completed' | 'failed',
    latestTicketId?: string
  ): void {
    const orders = this.getOrders();
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;
    const now = new Date().toISOString();
    const states = [...(order.stationStates || [])];
    const idx = states.findIndex((s) => s.stationId === stationId);
    const stationObj = this.resolveStationForProductOrItem(stationId);

    if (idx >= 0) {
      const currentStatus = states[idx].status;
      const nextStationStatus: KitchenStationStatus =
        printStatus === 'completed' && currentStatus === 'NEW' ? 'PRINTED' : currentStatus;
      states[idx] = {
        ...states[idx],
        printStatus,
        status: nextStationStatus,
        latestTicketId: latestTicketId || states[idx].latestTicketId,
        updatedAt: now,
      };
    } else {
      states.push({
        stationId: stationObj.id,
        stationCode: stationObj.code,
        stationNameAr: stationObj.nameAr,
        stationNameEn: stationObj.nameEn,
        status: printStatus === 'completed' ? 'PRINTED' : 'NEW',
        printStatus,
        latestTicketId,
        updatedAt: now,
      });
    }

    order.stationStates = states;
    order.overallKitchenStatus = this.computeOverallKitchenStatus(states);
    this.save(STORAGE_KEYS.ORDERS, orders);
  }

  public applyShiftSalesAdjustment(
    deltaAmount: number,
    method: PaymentMethodType = 'cash',
    orderCountDelta = 0
  ): void {
    const shift = this.getActiveShift();
    if (!shift || shift.status !== 'open') return;
    const roundedDelta = roundCurrency(deltaAmount);
    if (method === 'cash') {
      shift.cashSales = Math.max(0, roundCurrency(shift.cashSales + roundedDelta));
    } else if (method === 'card') {
      shift.cardSales = Math.max(0, roundCurrency(shift.cardSales + roundedDelta));
    } else {
      shift.otherSales = Math.max(0, roundCurrency(shift.otherSales + roundedDelta));
    }
    shift.ordersCount = Math.max(0, (shift.ordersCount || 0) + orderCountDelta);
    shift.totalSales = Math.max(0, roundCurrency((shift.totalSales || 0) + roundedDelta));
    shift.expectedCash = roundCurrency(shift.startingCash + shift.cashSales - shift.expenses);
    this.saveActiveShift(shift);
  }

  // --- Tables ---
  public getTables(): RestaurantTable[] {
    return this.load<RestaurantTable[]>(STORAGE_KEYS.TABLES, initialTables);
  }

  public saveTable(table: RestaurantTable): void {
    const tables = this.getTables();
    const idx = tables.findIndex((t) => t.id === table.id);
    if (idx >= 0) {
      tables[idx] = table;
    } else {
      tables.push(table);
    }
    this.save(STORAGE_KEYS.TABLES, tables);
    syncQueue.enqueue(idx >= 0 ? 'update' : 'create', 'tables', table.id, table);
  }

  public updateTableStatus(tableId: string, status: RestaurantTable['status'], currentOrderId?: string): void {
    const tables = this.getTables();
    const target = tables.find((t) => t.id === tableId);
    if (target) {
      target.status = status;
      target.currentOrderId = currentOrderId;
      if (status === 'occupied') {
        target.lastOccupiedAt = new Date().toISOString();
      }
      this.save(STORAGE_KEYS.TABLES, tables);
      syncQueue.enqueue('update', 'tables', tableId, target);
    }
  }

  public deleteTable(tableId: string): void {
    const tables = this.getTables().filter((t) => t.id !== tableId);
    this.save(STORAGE_KEYS.TABLES, tables);
    syncQueue.enqueue('delete', 'tables', tableId, { id: tableId });
  }

  public transferTable(
    fromTableId: string,
    toTableId: string,
    userId = 'cashier',
    userName = 'الكاشير'
  ): { success: boolean; message: string } {
    if (!fromTableId || !toTableId || fromTableId === toTableId) {
      return { success: false, message: 'يرجى اختيار طاولة هدف مختلفة' };
    }
    const tables = this.getTables();
    const fromTable = tables.find((t) => t.id === fromTableId);
    const toTable = tables.find((t) => t.id === toTableId);
    if (!fromTable || !toTable) {
      return { success: false, message: 'إحدى الطاولتين غير موجودة' };
    }
    if (toTable.status === 'occupied') {
      return { success: false, message: `الطاولة الهدف (${toTable.number}) مشغولة بالفعل` };
    }

    const orderId = fromTable.currentOrderId;
    fromTable.status = 'available';
    fromTable.currentOrderId = undefined;
    toTable.status = 'occupied';
    toTable.currentOrderId = orderId;
    toTable.lastOccupiedAt = new Date().toISOString();
    this.save(STORAGE_KEYS.TABLES, tables);

    if (orderId) {
      const orders = this.getOrders();
      const targetOrder = orders.find((o) => o.id === orderId);
      if (targetOrder) {
        targetOrder.tableId = toTable.id;
        targetOrder.tableNumber = toTable.number;
        targetOrder.updatedAt = new Date().toISOString();
        this.save(STORAGE_KEYS.ORDERS, orders);
        syncQueue.enqueue('update', 'orders', targetOrder.id, targetOrder);
      }
    }

    this.logAudit({
      userId,
      userName,
      action: 'نقل طاولة',
      category: 'order',
      details: `تم نقل الطلب من (${fromTable.number}) إلى (${toTable.number})`,
    });
    return { success: true, message: `تم نقل الطلب إلى ${toTable.number} بنجاح` };
  }

  // --- Customers ---
  public getCustomers(): Customer[] {
    return this.load<Customer[]>(STORAGE_KEYS.CUSTOMERS, initialCustomers);
  }

  public saveCustomer(customer: Customer): Customer {
    const customers = this.getCustomers();
    const idx = customers.findIndex((c) => c.id === customer.id || (c.phone && c.phone === customer.phone));
    if (idx >= 0) {
      customers[idx] = { ...customers[idx], ...customer };
      this.save(STORAGE_KEYS.CUSTOMERS, customers);
      syncQueue.enqueue('update', 'customers', customers[idx].id, customers[idx]);
      return customers[idx];
    } else {
      customers.push(customer);
      this.save(STORAGE_KEYS.CUSTOMERS, customers);
      syncQueue.enqueue('create', 'customers', customer.id, customer);
      return customer;
    }
  }

  public deleteCustomer(customerId: string): void {
    const customers = this.getCustomers().filter((c) => c.id !== customerId);
    this.save(STORAGE_KEYS.CUSTOMERS, customers);
    syncQueue.enqueue('delete', 'customers', customerId, { id: customerId });
  }

  public recordCustomerOrder(customerId: string, orderTotal: number): void {
    const customers = this.getCustomers();
    const cust = customers.find((c) => c.id === customerId);
    if (cust) {
      cust.ordersCount = (cust.ordersCount || 0) + 1;
      cust.totalSpent = Number(((cust.totalSpent || 0) + orderTotal).toFixed(2));
      this.save(STORAGE_KEYS.CUSTOMERS, customers);
      syncQueue.enqueue('update', 'customers', customerId, cust);
    }
  }

  // --- Suppliers ---
  public getSuppliers(): Supplier[] {
    return this.load<Supplier[]>(STORAGE_KEYS.SUPPLIERS, []);
  }

  public saveSupplier(supplier: Supplier, userId = 'admin', userName = 'المدير العام'): void {
    const sups = this.getSuppliers();
    const idx = sups.findIndex((s) => s.id === supplier.id);
    if (idx >= 0) {
      sups[idx] = supplier;
    } else {
      sups.push(supplier);
    }
    this.save(STORAGE_KEYS.SUPPLIERS, sups);
    this.sqliteEngine.insertOrReplace('suppliers', supplier);
    syncQueue.enqueue(idx >= 0 ? 'update' : 'create', 'suppliers', supplier.id, supplier);

    this.logAudit({
      userId,
      userName,
      action: idx >= 0 ? 'UPDATE_SUPPLIER' : 'CREATE_SUPPLIER',
      category: 'inventory',
      details: `${idx >= 0 ? 'تعديل بيانات المورد' : 'إضافة مورد جديد'}: [${supplier.name}] (${supplier.phone || ''})`,
    });
  }

  public deleteSupplier(supplierId: string, userId = 'admin', userName = 'المدير العام'): void {
    const sups = this.getSuppliers();
    const target = sups.find((s) => s.id === supplierId);
    const filtered = sups.filter((s) => s.id !== supplierId);
    this.save(STORAGE_KEYS.SUPPLIERS, filtered);
    this.sqliteEngine.delete('suppliers', supplierId);
    syncQueue.enqueue('delete', 'suppliers', supplierId, { id: supplierId, name: target?.name });

    if (target) {
      this.logAudit({
        userId,
        userName,
        action: 'DELETE_SUPPLIER',
        category: 'inventory',
        details: `حذف المورد: [${target.name}] (ID: ${supplierId})`,
      });
    }
  }

  // --- Orders ---
  public getOrders(): Order[] {
    return this.load<Order[]>(STORAGE_KEYS.ORDERS, initialOrders);
  }

  public getOrderByExternalId(externalOrderId: string): Order | undefined {
    const orders = this.getOrders();
    return orders.find((o) => o.externalOrderId === externalOrderId);
  }

  public createOrder(order: Order): Order {
    const normalizedOrder: Order = {
      ...order,
      paymentStatus: order.paymentStatus || 'paid',
      channel: order.channel || 'pos',
      printStatus: order.printStatus || 'pending',
    };

    const orders = this.getOrders();
    orders.unshift(normalizedOrder);
    this.save(STORAGE_KEYS.ORDERS, orders);
    syncQueue.enqueue('create', 'orders', normalizedOrder.id, normalizedOrder);

    // If linked to a table, update table status
    if (normalizedOrder.tableId) {
      this.updateTableStatus(normalizedOrder.tableId, 'occupied', normalizedOrder.id);
    }

    // Auto deduct inventory via recipes
    this.deductInventoryForOrder(normalizedOrder);

    // Update customer stats if linked
    if (normalizedOrder.customerId) {
      this.recordCustomerOrder(normalizedOrder.customerId, normalizedOrder.total);
    }

    // Update active shift sales ONLY IF PAID
    if (normalizedOrder.paymentStatus === 'paid') {
      this.addSalesToActiveShift(normalizedOrder);
    }

    // Record Special Offers sales & redemptions count
    this.recordOfferSalesForOrder(normalizedOrder);

    // Log audit
    this.logAudit({
      userId: normalizedOrder.cashierId,
      userName: normalizedOrder.cashierName,
      action: 'إنشاء طلب جديد',
      category: 'order',
      details: `طلب رقم ${normalizedOrder.orderNumber} - إجمالي ${normalizedOrder.total} ج.م (${normalizedOrder.type}) - حالة السداد: ${normalizedOrder.paymentStatus}`,
    });

    return normalizedOrder;
  }

  // =========================================================================
  // Special Offers Management & Offer Sales Ledger
  // =========================================================================

  public getOffers(options?: { status?: OfferStatus }): SpecialOffer[] {
    const loaded = this.load<SpecialOffer[]>(STORAGE_KEYS.OFFERS, []);
    const list = Array.isArray(loaded) ? [...loaded] : [];
    const sorted = list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    if (options?.status) {
      return sorted.filter((o) => o.status === options.status);
    }
    return sorted;
  }

  public getOfferById(offerId: string): SpecialOffer | undefined {
    return this.getOffers().find((o) => o.id === offerId);
  }

  public getActiveAvailableOffers(now: Date = new Date()): SpecialOffer[] {
    return this.getOffers().filter((offer) => isOfferCurrentlyValid(offer, now).valid);
  }

  public saveOffer(
    offerInput: Omit<SpecialOffer, 'id' | 'originalPrice' | 'savingsAmount' | 'savingsPercent' | 'currentRedemptions' | 'createdAt' | 'updatedAt'> & {
      id?: string;
      originalPrice?: number;
      currentRedemptions?: number;
      createdAt?: string;
    },
    userId = 'admin',
    userName = 'المدير العام'
  ): { success: boolean; offer?: SpecialOffer; error?: string } {
    if (!offerInput.nameAr || !offerInput.nameAr.trim()) {
      return { success: false, error: 'يرجى إدخال اسم العرض.' };
    }
    if (!offerInput.components || offerInput.components.length === 0) {
      return { success: false, error: 'يجب إضافة صنف واحد على الأقل داخل العرض.' };
    }

    const productsMap = new Map(this.getProducts({ includeArchived: true }).map((p) => [p.id, p]));
    const normalizedComponents = offerInput.components
      .filter((c) => c.productId && (Number(c.quantity) || 0) > 0)
      .map((c) => {
        const prod = productsMap.get(c.productId);
        return {
          productId: c.productId,
          productNameAr: prod?.nameAr || c.productNameAr,
          productNameEn: prod?.nameEn || c.productNameEn,
          unitPrice: prod ? Number(prod.price) || 0 : Number(c.unitPrice) || 0,
          costPrice: prod ? Number(prod.costPrice) || 0 : Number(c.costPrice) || 0,
          quantity: roundQty(c.quantity),
          stationId: prod?.stationId || prod?.kitchenStation || c.stationId,
        };
      });

    if (normalizedComponents.length === 0) {
      return { success: false, error: 'كميات أصناف العرض غير صالحة.' };
    }

    const calculatedOrig = computeOfferOriginalPrice(normalizedComponents, productsMap);
    const effectiveOriginal =
      offerInput.useCustomOriginalPrice &&
      typeof offerInput.originalPrice === 'number' &&
      offerInput.originalPrice > 0
        ? roundCurrency(offerInput.originalPrice)
        : calculatedOrig;

    const pricingCheck = validateOfferPricing(effectiveOriginal, offerInput.offerPrice);
    if (!pricingCheck.valid) {
      return { success: false, error: pricingCheck.error || 'تسعير العرض غير صالح.' };
    }

    const { savingsAmount, savingsPercent } = computeOfferSavings(
      pricingCheck.originalPrice,
      pricingCheck.offerPrice
    );

    const offers = this.getOffers();
    const existingIdx = offerInput.id ? offers.findIndex((o) => o.id === offerInput.id) : -1;
    const now = new Date().toISOString();

    const normalizedOffer: SpecialOffer = {
      id: offerInput.id || `offer-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      nameAr: offerInput.nameAr.trim(),
      nameEn: offerInput.nameEn?.trim() || '',
      description: offerInput.description?.trim() || '',
      imageUrl: offerInput.imageUrl || '',
      components: normalizedComponents,
      originalPrice: pricingCheck.originalPrice,
      useCustomOriginalPrice: Boolean(offerInput.useCustomOriginalPrice),
      offerPrice: pricingCheck.offerPrice,
      savingsAmount,
      savingsPercent,
      status: offerInput.status || 'active',
      sortOrder:
        typeof offerInput.sortOrder === 'number'
          ? offerInput.sortOrder
          : existingIdx >= 0
          ? offers[existingIdx].sortOrder
          : offers.length + 1,
      startDate: offerInput.startDate?.trim() || undefined,
      endDate: offerInput.endDate?.trim() || undefined,
      validDays:
        Array.isArray(offerInput.validDays) && offerInput.validDays.length > 0
          ? [...offerInput.validDays].sort((a, b) => a - b)
          : undefined,
      startTime: offerInput.startTime?.trim() || undefined,
      endTime: offerInput.endTime?.trim() || undefined,
      maxTotalRedemptions:
        typeof offerInput.maxTotalRedemptions === 'number' && offerInput.maxTotalRedemptions > 0
          ? Math.floor(offerInput.maxTotalRedemptions)
          : undefined,
      currentRedemptions:
        existingIdx >= 0
          ? offers[existingIdx].currentRedemptions || 0
          : offerInput.currentRedemptions || 0,
      maxPerOrder:
        typeof offerInput.maxPerOrder === 'number' && offerInput.maxPerOrder > 0
          ? Math.floor(offerInput.maxPerOrder)
          : undefined,
      createdAt: existingIdx >= 0 ? offers[existingIdx].createdAt : offerInput.createdAt || now,
      updatedAt: now,
    };

    if (existingIdx >= 0) {
      offers[existingIdx] = normalizedOffer;
    } else {
      offers.push(normalizedOffer);
    }

    this.save(STORAGE_KEYS.OFFERS, offers);
    this.syncOfferItemsToSQLite(offers);

    this.logAudit({
      userId,
      userName,
      action: existingIdx >= 0 ? 'تعديل عرض ترويجي' : 'إنشاء عرض ترويجي جديد',
      category: 'settings',
      details: `${normalizedOffer.nameAr} | السعر: ${normalizedOffer.offerPrice} ج.م (بدلاً من ${normalizedOffer.originalPrice} ج.م) | عدد الأصناف: ${normalizedOffer.components.length}`,
    });

    return { success: true, offer: normalizedOffer };
  }

  public duplicateOffer(
    offerId: string,
    userId = 'admin',
    userName = 'المدير العام'
  ): SpecialOffer | null {
    const source = this.getOfferById(offerId);
    if (!source) return null;
    const copyRes = this.saveOffer(
      {
        ...source,
        id: undefined,
        nameAr: `${source.nameAr} (نسخة)`,
        status: 'paused',
        currentRedemptions: 0,
        sortOrder: this.getOffers().length + 1,
        createdAt: undefined,
      },
      userId,
      userName
    );
    return copyRes.offer || null;
  }

  public toggleOfferStatus(
    offerId: string,
    status: OfferStatus,
    userId = 'admin',
    userName = 'المدير العام'
  ): SpecialOffer | null {
    const offers = this.getOffers();
    const idx = offers.findIndex((o) => o.id === offerId);
    if (idx < 0) return null;
    offers[idx] = {
      ...offers[idx],
      status,
      updatedAt: new Date().toISOString(),
    };
    this.save(STORAGE_KEYS.OFFERS, offers);
    this.logAudit({
      userId,
      userName,
      action: status === 'active' ? 'تفعيل عرض' : 'إيقاف عرض مؤقتاً',
      category: 'settings',
      details: `العرض: ${offers[idx].nameAr} -> ${status}`,
    });
    return offers[idx];
  }

  public reorderOffers(orderedIds: string[]): void {
    const offers = this.getOffers();
    const orderIdxMap = new Map(orderedIds.map((id, i) => [id, i + 1]));
    const updated = offers
      .map((o) => ({
        ...o,
        sortOrder: orderIdxMap.get(o.id) ?? o.sortOrder ?? 999,
      }))
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    this.save(STORAGE_KEYS.OFFERS, updated);
  }

  public deleteOffer(
    offerId: string,
    userId = 'admin',
    userName = 'المدير العام'
  ): boolean {
    const offers = this.getOffers();
    const target = offers.find((o) => o.id === offerId);
    if (!target) return false;
    const remaining = offers.filter((o) => o.id !== offerId);
    this.save(STORAGE_KEYS.OFFERS, remaining);
    this.syncOfferItemsToSQLite(remaining);
    this.logAudit({
      userId,
      userName,
      action: 'حذف عرض ترويجي',
      category: 'settings',
      details: `تم حذف العرض: ${target.nameAr}`,
    });
    return true;
  }

  public getOfferSales(filter?: { offerId?: string; orderId?: string }): OfferSaleRecord[] {
    let sales = this.load<OfferSaleRecord[]>(STORAGE_KEYS.OFFER_SALES, []);
    if (!Array.isArray(sales)) sales = [];
    if (filter?.offerId) sales = sales.filter((s) => s.offerId === filter.offerId);
    if (filter?.orderId) sales = sales.filter((s) => s.orderId === filter.orderId);
    return sales;
  }

  private recordOfferSalesForOrder(order: Order): void {
    const offerItems = (order.items || []).filter(
      (it) => it.itemType === 'offer' && !it.cancelled && it.status !== 'cancelled'
    );
    if (offerItems.length === 0) return;

    const offers = this.getOffers();
    const sales = this.getOfferSales();
    const now = new Date().toISOString();
    let offersChanged = false;

    offerItems.forEach((it) => {
      const offerId = it.offerId || it.productId.replace(/^offer:/, '');
      const qty = Math.max(0, roundQty(it.quantity));
      if (qty <= 0) return;

      const offerIdx = offers.findIndex((o) => o.id === offerId);
      const origPrice = Number(
        it.originalUnitPrice ?? (offerIdx >= 0 ? offers[offerIdx].originalPrice : it.unitPrice)
      );
      const unitSavings = Math.max(0, roundCurrency(origPrice - it.unitPrice));

      sales.unshift({
        id: `osale-${order.id}-${it.id}`,
        orderId: order.id,
        orderNumber: order.orderNumber,
        offerId,
        offerName: it.productNameAr,
        quantity: qty,
        unitOfferPrice: roundCurrency(it.unitPrice),
        unitOriginalPrice: roundCurrency(origPrice),
        unitSavings,
        totalRevenue: roundCurrency(it.itemTotal),
        totalSavings: roundCurrency(unitSavings * qty),
        status: 'active',
        createdAt: order.createdAt || now,
      });

      if (offerIdx >= 0) {
        offers[offerIdx] = {
          ...offers[offerIdx],
          currentRedemptions: roundQty((offers[offerIdx].currentRedemptions || 0) + qty),
          updatedAt: now,
        };
        offersChanged = true;
      }
    });

    this.save(STORAGE_KEYS.OFFER_SALES, sales);
    if (offersChanged) {
      this.save(STORAGE_KEYS.OFFERS, offers);
    }
  }

  public adjustOfferRedemptionsOnOrderCancelOrRefund(
    order: Order,
    nextSaleStatus: 'cancelled' | 'refunded'
  ): void {
    const sales = this.getOfferSales();
    const offers = this.getOffers();
    const now = new Date().toISOString();
    let salesChanged = false;
    let offersChanged = false;

    sales.forEach((rec, idx) => {
      if (rec.orderId === order.id && rec.status === 'active') {
        sales[idx] = { ...rec, status: nextSaleStatus, updatedAt: now };
        salesChanged = true;

        const offerIdx = offers.findIndex((o) => o.id === rec.offerId);
        if (offerIdx >= 0) {
          offers[offerIdx] = {
            ...offers[offerIdx],
            currentRedemptions: Math.max(
              0,
              roundQty((offers[offerIdx].currentRedemptions || 0) - rec.quantity)
            ),
            updatedAt: now,
          };
          offersChanged = true;
        }
      }
    });

    if (salesChanged) {
      this.save(STORAGE_KEYS.OFFER_SALES, sales);
    }
    if (offersChanged) {
      this.save(STORAGE_KEYS.OFFERS, offers);
    }
  }

  /**
   * Record payment collection for a Cash on Delivery (COD) order upon delivery
   */
  public recordOrderPayment(
    orderId: string,
    paymentMethod: PaymentMethodType = 'cash',
    amount?: number,
    cashierId = 'cashier',
    cashierName = 'كاشير الفرع'
  ): Order | null {
    const orders = this.getOrders();
    const order = orders.find((o) => o.id === orderId);
    if (!order) return null;

    const payAmount = amount !== undefined ? amount : order.total;
    order.paymentStatus = 'paid';
    order.codCollected = true;
    order.paymentCollectedAt = new Date().toISOString();
    order.paymentCollectedBy = cashierName;
    order.payments = [
      {
        method: paymentMethod,
        amount: payAmount,
        reference: `COD-${order.orderNumber}`,
      },
    ];
    order.paidAmount = payAmount;
    order.changeAmount = Math.max(0, Number((payAmount - order.total).toFixed(2)));
    order.updatedAt = new Date().toISOString();

    this.save(STORAGE_KEYS.ORDERS, orders);

    // NOW update active shift sales with the collected cash
    this.addSalesToActiveShift(order);

    // Update customer totalSpent
    if (order.customerId) {
      this.recordCustomerOrder(order.customerId, payAmount);
    }

    this.logAudit({
      userId: cashierId,
      userName: cashierName,
      action: 'تحصيل سداد طلب توصيل (COD)',
      category: 'order',
      details: `تم تحصيل سداد الطلب ${order.orderNumber} بمبلغ ${payAmount} ج.م طريقة: ${paymentMethod} وإيداعه بالوردية الحالية`,
    });

    return order;
  }

  /**
   * Update print status and retry count for an order
   */
  public updateOrderPrintStatus(orderId: string, printStatus: OrderPrintStatus): void {
    const orders = this.getOrders();
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;

    order.printStatus = printStatus;
    if (printStatus === 'failed') {
      order.printRetryCount = (order.printRetryCount || 0) + 1;
    }
    this.save(STORAGE_KEYS.ORDERS, orders);

    this.logAudit({
      userId: 'printer',
      userName: 'نظام الطباعة',
      action: 'تحديث حالة الطباعة',
      category: 'order',
      details: `الطلب ${order.orderNumber}: حالة الطباعة أصبحت ${printStatus}${order.printRetryCount ? ` (محاولات: ${order.printRetryCount})` : ''}`,
    });
  }

  /**
   * Update kitchen print status and retry details for an order
   */
  public updateOrderKitchenPrintStatus(
    orderId: string,
    kitchenPrintStatus: OrderPrintStatus,
    error?: string
  ): void {
    const orders = this.getOrders();
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;

    order.kitchenPrintStatus = kitchenPrintStatus;
    if (kitchenPrintStatus === 'printed') {
      order.kitchenPrintedAt = new Date().toISOString();
      order.kitchenPrintError = undefined;
    } else if (kitchenPrintStatus === 'failed') {
      order.kitchenPrintRetryCount = (order.kitchenPrintRetryCount || 0) + 1;
      order.kitchenPrintError = error || 'فشل أمر طباعة المطبخ';
    }
    this.save(STORAGE_KEYS.ORDERS, orders);

    this.logAudit({
      userId: 'kitchen_printer',
      userName: 'طابعة بون المطبخ',
      action: 'تحديث حالة طباعة المطبخ',
      category: 'order',
      details: `الطلب ${order.orderNumber}: حالة طباعة المطبخ أصبحت [${kitchenPrintStatus}]${
        kitchenPrintStatus === 'failed' ? ` - الخطأ: ${error || 'غير محدد'}` : ''
      }`,
    });
  }

  public updateOrderStatus(orderId: string, status: Order['status'], userId = 'kitchen', userName = 'المطبخ'): void {
    const orders = this.getOrders();
    const target = orders.find((o) => o.id === orderId);
    if (!target) return;

    const previousStatus = target.status;
    target.status = status;
    target.updatedAt = new Date().toISOString();

    if (status === 'preparing' && !target.prepStartedAt) {
      target.prepStartedAt = new Date().toISOString();
    }
    if (status === 'completed') {
      target.completedAt = new Date().toISOString();
      if (target.tableId) {
        this.updateTableStatus(target.tableId, 'cleaning', undefined);
      }
    }
    if (status === 'cancelled' && previousStatus !== 'cancelled' && previousStatus !== 'refunded') {
      if (target.tableId) {
        this.updateTableStatus(target.tableId, 'available', undefined);
      }
      this.restockInventoryForOrder(target, 'إلغاء الطلب', userId, userName);
      this.adjustOfferRedemptionsOnOrderCancelOrRefund(target, 'cancelled');
      if (target.paymentStatus === 'paid') {
        this.reverseShiftSalesForOrder(target);
      }
    }

    this.save(STORAGE_KEYS.ORDERS, orders);
    syncQueue.enqueue('update', 'orders', orderId, target);
    this.logAudit({
      userId,
      userName,
      action: 'تحديث حالة الطلب',
      category: 'order',
      details: `الطلب ${target.orderNumber} أصبح ${status}`,
    });
  }

  public refundOrder(params: {
    orderId: string;
    amount: number;
    reason: string;
    method?: PaymentMethodType;
    userId?: string;
    userName?: string;
    restockInventory?: boolean;
  }): { success: boolean; order?: Order; message: string } {
    const orders = this.getOrders();
    const target = orders.find((o) => o.id === params.orderId);
    if (!target) {
      return { success: false, message: 'الطلب غير موجود' };
    }
    if (target.status === 'refunded' || target.status === 'cancelled') {
      return { success: false, message: 'هذا الطلب مسترد أو ملغي بالفعل' };
    }

    const refundAmount = roundCurrency(params.amount);
    if (refundAmount <= 0 || refundAmount > roundCurrency(target.total)) {
      return { success: false, message: 'قيمة الاسترداد غير صالحة' };
    }

    const userId = params.userId || 'admin';
    const userName = params.userName || 'المدير العام';
    const method: PaymentMethodType = params.method || target.payments?.[0]?.method || 'cash';

    target.status = 'refunded';
    target.refundedAmount = refundAmount;
    target.refundedAt = new Date().toISOString();
    target.refundReason = params.reason || 'مرتجع عميل';
    target.refundedBy = userName;
    target.refundMethod = method;
    target.updatedAt = target.refundedAt;

    if (target.tableId) {
      this.updateTableStatus(target.tableId, 'available', undefined);
    }

    if (params.restockInventory) {
      this.restockInventoryForOrder(target, `مرتجع (${target.refundReason})`, userId, userName);
    }

    this.adjustOfferRedemptionsOnOrderCancelOrRefund(target, 'refunded');

    if (target.paymentStatus === 'paid') {
      this.reverseShiftSalesForOrder(target, refundAmount, method);
    }

    this.save(STORAGE_KEYS.ORDERS, orders);
    syncQueue.enqueue('update', 'orders', target.id, target);
    this.logAudit({
      userId,
      userName,
      action: 'استرداد / مرتجع طلب',
      category: 'order',
      details: `تم استرداد الطلب ${target.orderNumber} بمبلغ ${refundAmount.toFixed(2)} ج.م (${method}) - السبب: ${target.refundReason}`,
    });

    return { success: true, order: target, message: `تم استرداد الطلب ${target.orderNumber} بنجاح` };
  }

  public deleteOrder(orderId: string, adminId = 'admin', adminName = 'المدير العام'): void {
    const orders = this.getOrders();
    const target = orders.find((o) => o.id === orderId);
    const filtered = orders.filter((o) => o.id !== orderId);
    this.save(STORAGE_KEYS.ORDERS, filtered);
    syncQueue.enqueue('delete', 'orders', orderId, { id: orderId });

    if (target?.tableId) {
      this.updateTableStatus(target.tableId, 'available', undefined);
    }

    this.logAudit({
      userId: adminId,
      userName: adminName,
      action: 'حذف طلب نهائياً',
      category: 'order',
      details: target ? `تم حذف الطلب رقم ${target.orderNumber} (بقيمة ${target.total} ج.م) نهائياً` : `حذف الطلب ${orderId}`,
    });
  }

  // --- Held Orders (تعليق الطلبات) ---
  public getHeldOrders(): HeldOrder[] {
    return this.load<HeldOrder[]>(STORAGE_KEYS.HELD_ORDERS, []);
  }

  public saveHeldOrder(heldOrder: HeldOrder): void {
    const list = this.getHeldOrders();
    const existingIdx = list.findIndex((h) => h.id === heldOrder.id);
    if (existingIdx >= 0) {
      list[existingIdx] = heldOrder;
    } else {
      list.unshift(heldOrder);
    }
    this.save(STORAGE_KEYS.HELD_ORDERS, list);
  }

  public removeHeldOrder(id: string): void {
    const list = this.getHeldOrders().filter((h) => h.id !== id);
    this.save(STORAGE_KEYS.HELD_ORDERS, list);
  }

  public clearAllHeldOrders(): void {
    this.save(STORAGE_KEYS.HELD_ORDERS, []);
  }

  // --- Purchases ---
  public getPurchases(): PurchaseOrder[] {
    return this.load<PurchaseOrder[]>(STORAGE_KEYS.PURCHASES, []);
  }

  public getPurchaseOrders(): PurchaseOrder[] {
    return this.getPurchases();
  }

  public createPurchase(po: any, userId = 'admin', userName = 'المدير'): void {
    const purchases = this.getPurchases();
    const normalized: PurchaseOrder = {
      id: po.id || `po-${Date.now()}`,
      orderNumber: po.orderNumber || `PO-${Date.now()}`,
      supplierId: po.supplierId,
      supplierName: po.supplierName,
      branchId: po.branchId,
      items: po.items.map((i: any) => ({
        ingredientId: i.ingredientId,
        ingredientName: i.ingredientName,
        quantity: i.quantity,
        unitCost: i.unitCost || i.unitPrice || 0,
        total: i.total || i.quantity * (i.unitCost || i.unitPrice || 0),
      })),
      total: po.total || po.totalAmount || 0,
      totalAmount: po.totalAmount || po.total || 0,
      paymentStatus: po.paymentStatus || 'paid',
      paidAmount: po.paidAmount || po.total || 0,
      notes: po.notes,
      createdAt: po.createdAt || new Date().toISOString(),
      status: po.status || 'received',
    };

    purchases.unshift(normalized);
    this.save(STORAGE_KEYS.PURCHASES, purchases);
    syncQueue.enqueue('create', 'purchases', normalized.id, normalized);

    // Restock ingredients
    const ings = this.getIngredients({ includeArchived: true });
    normalized.items.forEach((item) => {
      const ing = ings.find((i) => i.id === item.ingredientId);
      if (ing) {
        ing.currentStock = Number((ing.currentStock + item.quantity).toFixed(2));
        if (item.unitCost) ing.costPerUnit = item.unitCost;
      }
    });
    this.save(STORAGE_KEYS.INGREDIENTS, ings);

    this.logAudit({
      userId,
      userName,
      action: 'فاتورة شراء وتوريد',
      category: 'inventory',
      details: `فاتورة شراء ${normalized.orderNumber} من المورد ${normalized.supplierName} بإجمالي ${normalized.total} ج.م`,
    });
  }

  public createPurchaseOrder(po: any, userId = 'admin', userName = 'المدير'): void {
    this.createPurchase(po, userId, userName);
  }

  public deletePurchaseOrder(id: string): void {
    const purchases = this.getPurchases().filter((p) => p.id !== id);
    this.save(STORAGE_KEYS.PURCHASES, purchases);
    syncQueue.enqueue('delete', 'purchases', id, { id });
  }

  public deletePurchase(id: string): void {
    this.deletePurchaseOrder(id);
  }

  // --- Expenses ---
  public getExpenses(): Expense[] {
    return this.load<Expense[]>(STORAGE_KEYS.EXPENSES, initialExpenses);
  }

  public saveExpense(expense: Expense): void {
    const exps = this.getExpenses();
    const idx = exps.findIndex((e) => e.id === expense.id);
    if (idx >= 0) {
      exps[idx] = expense;
    } else {
      exps.unshift(expense);
    }
    this.save(STORAGE_KEYS.EXPENSES, exps);
    syncQueue.enqueue(idx >= 0 ? 'update' : 'create', 'expenses', expense.id, expense);
  }

  public deleteExpense(expenseId: string): void {
    const exps = this.getExpenses().filter((e) => e.id !== expenseId);
    this.save(STORAGE_KEYS.EXPENSES, exps);
    syncQueue.enqueue('delete', 'expenses', expenseId, { id: expenseId });
  }

  public recordExpense(expense: any): void {
    const exps = this.getExpenses();
    const normalized: Expense = {
      id: expense.id || `exp-${Date.now()}`,
      title: expense.title || expense.category,
      category: expense.category,
      amount: expense.amount,
      branchId: expense.branchId || 'branch-1',
      branchName: expense.branchName || 'الفرع الرئيسي',
      userId: expense.userId || 'admin',
      userName: expense.userName || 'الكاشير',
      paidTo: expense.paidTo || expense.title || 'مصروف عام',
      paidFromDrawer: expense.paidFromDrawer !== false,
      notes: expense.notes,
      recordedBy: expense.userName || expense.recordedBy || 'المسؤول',
      createdAt: expense.createdAt || new Date().toISOString(),
    };

    exps.unshift(normalized);
    this.save(STORAGE_KEYS.EXPENSES, exps);
    syncQueue.enqueue('create', 'expenses', normalized.id, normalized);

    // Deduct from active shift if recorded during shift and paidFromDrawer is true
    const shift = this.getActiveShift();
    if (shift && shift.status === 'open' && normalized.paidFromDrawer) {
      shift.expenses = Number((shift.expenses + normalized.amount).toFixed(2));
      shift.expectedCash = Number((shift.startingCash + shift.cashSales - shift.expenses).toFixed(2));
      this.saveActiveShift(shift);
    }

    this.logAudit({
      userId: normalized.userId || 'system',
      userName: normalized.userName || 'النظام',
      action: 'تسجيل مصروف',
      category: 'expense',
      details: `بند: ${normalized.category} (${normalized.title}) - مبلغ: ${normalized.amount} ج.م`,
    });
  }

  // --- Shifts ---
  public getActiveShift(): Shift | null {
    return this.load<Shift | null>(STORAGE_KEYS.SHIFTS, initialActiveShift);
  }

  public getShifts(): Shift[] {
    const active = this.getActiveShift();
    const history = this.load<Shift[]>(STORAGE_KEYS.SHIFTS_HISTORY, []);
    if (active) {
      return [active, ...history.filter((s) => s.id !== active.id)];
    }
    return history;
  }

  /**
   * Role-scoped shift visibility:
   * - Admin & Manager can inspect all active and closed/previous day shifts.
   * - Cashiers can only see the currently open shift (never closed or previous day closings).
   */
  public getVisibleShiftsForRole(role?: UserRole): Shift[] {
    if (role === 'admin' || role === 'manager') {
      return this.getShifts();
    }
    const active = this.getActiveShift();
    if (active && active.status === 'open') {
      return [active];
    }
    return [];
  }

  public saveActiveShift(shift: Shift): void {
    this.save(STORAGE_KEYS.SHIFTS, shift);
  }

  public openShift(shiftData: Omit<Shift, 'id' | 'cashSales' | 'cardSales' | 'otherSales' | 'expenses' | 'expectedCash' | 'status'>): Shift {
    const newShift: Shift = {
      ...shiftData,
      id: `shift-${Date.now()}`,
      cashSales: 0,
      cardSales: 0,
      otherSales: 0,
      expenses: 0,
      expectedCash: shiftData.startingCash,
      status: 'open',
    };
    this.saveActiveShift(newShift);
    this.logAudit({
      userId: newShift.userId,
      userName: newShift.userName,
      action: 'فتح وردية جديدة',
      category: 'shift',
      details: `عهدة افتتاحية: ${newShift.startingCash} ج.م`,
    });
    return newShift;
  }

  public closeShift(actualCash: number, notes?: string): Shift | null {
    const shift = this.getActiveShift();
    if (!shift) return null;
    shift.status = 'closed';
    shift.endTime = new Date().toISOString();
    shift.closedAt = shift.endTime;
    shift.actualCash = roundCurrency(actualCash);
    shift.cashDifference = roundCurrency(actualCash - shift.expectedCash);
    shift.difference = shift.cashDifference;
    shift.notes = notes || shift.notes;
    this.saveActiveShift(shift);

    // Save to history so it shows up in closed shifts table
    const history = this.load<Shift[]>(STORAGE_KEYS.SHIFTS_HISTORY, []);
    const existingIdx = history.findIndex((s) => s.id === shift.id);
    if (existingIdx >= 0) {
      history[existingIdx] = { ...shift };
    } else {
      history.unshift({ ...shift });
    }
    this.save(STORAGE_KEYS.SHIFTS_HISTORY, history);

    this.logAudit({
      userId: shift.userId,
      userName: shift.userName,
      action: 'إغلاق الوردية والتقفيل',
      category: 'shift',
      details: `نقد متوقع: ${shift.expectedCash} ج.م | نقد فعلي: ${actualCash} ج.م | فرق: ${shift.cashDifference} ج.م`,
    });
    return shift;
  }

  private addSalesToActiveShift(order: Order): void {
    const shift = this.getActiveShift();
    if (!shift || shift.status !== 'open') return;

    // Strict COD protection: Unpaid orders MUST NOT inflate cashSales or expectedCash
    if (order.paymentStatus === 'unpaid') {
      return;
    }

    let collectedInThisOrder = 0;
    const targetRevenue = roundCurrency(order.total);
    order.payments.forEach((p) => {
      // Cap cash contribution at net order amount if change was returned
      const rawAmt = roundCurrency(p.amount);
      collectedInThisOrder = roundCurrency(collectedInThisOrder + rawAmt);
      if (p.method === 'cash') {
        const netCash = roundCurrency(Math.max(0, rawAmt - (order.changeAmount || 0)));
        shift.cashSales = roundCurrency(shift.cashSales + netCash);
      } else if (p.method === 'card') {
        shift.cardSales = roundCurrency(shift.cardSales + rawAmt);
      } else {
        shift.otherSales = roundCurrency(shift.otherSales + rawAmt);
      }
    });

    shift.ordersCount = (shift.ordersCount || 0) + 1;
    shift.totalSales = roundCurrency((shift.totalSales || 0) + (targetRevenue || collectedInThisOrder));
    shift.expectedCash = roundCurrency(shift.startingCash + shift.cashSales - shift.expenses);
    this.saveActiveShift(shift);
  }

  private reverseShiftSalesForOrder(
    order: Order,
    amountOverride?: number,
    methodOverride?: PaymentMethodType
  ): void {
    const shift = this.getActiveShift();
    if (!shift || shift.status !== 'open' || order.paymentStatus === 'unpaid') return;

    const reversalAmt = roundCurrency(amountOverride ?? order.total);
    if (reversalAmt <= 0) return;

    if (methodOverride || order.payments.length === 0) {
      const m = methodOverride || 'cash';
      if (m === 'cash') {
        shift.cashSales = Math.max(0, roundCurrency(shift.cashSales - reversalAmt));
      } else if (m === 'card') {
        shift.cardSales = Math.max(0, roundCurrency(shift.cardSales - reversalAmt));
      } else {
        shift.otherSales = Math.max(0, roundCurrency(shift.otherSales - reversalAmt));
      }
    } else if (amountOverride !== undefined && amountOverride < order.total) {
      const primaryMethod = order.payments[0]?.method || 'cash';
      if (primaryMethod === 'cash') {
        shift.cashSales = Math.max(0, roundCurrency(shift.cashSales - reversalAmt));
      } else if (primaryMethod === 'card') {
        shift.cardSales = Math.max(0, roundCurrency(shift.cardSales - reversalAmt));
      } else {
        shift.otherSales = Math.max(0, roundCurrency(shift.otherSales - reversalAmt));
      }
    } else {
      order.payments.forEach((p) => {
        const netAmt =
          p.method === 'cash'
            ? roundCurrency(Math.max(0, p.amount - (order.changeAmount || 0)))
            : roundCurrency(p.amount);
        if (p.method === 'cash') {
          shift.cashSales = Math.max(0, roundCurrency(shift.cashSales - netAmt));
        } else if (p.method === 'card') {
          shift.cardSales = Math.max(0, roundCurrency(shift.cardSales - netAmt));
        } else {
          shift.otherSales = Math.max(0, roundCurrency(shift.otherSales - netAmt));
        }
      });
    }

    if (amountOverride === undefined || amountOverride >= order.total) {
      shift.ordersCount = Math.max(0, (shift.ordersCount || 0) - 1);
    }
    shift.totalSales = Math.max(0, roundCurrency((shift.totalSales || 0) - reversalAmt));
    shift.expectedCash = roundCurrency(shift.startingCash + shift.cashSales - shift.expenses);
    this.saveActiveShift(shift);
  }

  // --- Audit Logs ---
  public getAuditLogs(): AuditLog[] {
    return this.load<AuditLog[]>(STORAGE_KEYS.AUDIT_LOGS, []);
  }

  public logAudit(entry: Omit<AuditLog, 'id' | 'timestamp'>): void {
    const logs = this.getAuditLogs();
    const item: AuditLog = {
      ...entry,
      id: `log-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
    };
    logs.unshift(item);
    // Keep last 500 logs
    if (logs.length > 500) logs.pop();
    this.save(STORAGE_KEYS.AUDIT_LOGS, logs);
  }

  // --- Full Backup & Restore ---
  public exportFullBackup(): string {
    const dump = {
      exportedAt: new Date().toISOString(),
      version: '1.0.0',
      profile: this.getProfile(),
      branches: this.getBranches(),
      users: this.getUsers(),
      categories: this.getCategories(),
      products: this.getProducts(),
      modifiers: this.getModifierGroups(),
      ingredients: this.getIngredients(),
      recipes: this.getRecipes(),
      tables: this.getTables(),
      customers: this.getCustomers(),
      suppliers: this.getSuppliers(),
      orders: this.getOrders(),
      purchases: this.getPurchases(),
      expenses: this.getExpenses(),
      shift: this.getActiveShift(),
      auditLogs: this.getAuditLogs(),
      kitchenStations: this.getKitchenStations(),
      kitchenTickets: this.getKitchenTickets(),
      kitchenPrintJobs: this.getKitchenPrintJobs(),
      kitchenModifications: this.getKitchenModifications(),
      orderCancellations: this.getOrderCancellations(),
      kitchenReprints: this.getKitchenReprints(),
      offers: this.getOffers(),
      offerSales: this.getOfferSales(),
    };
    this.recordBackupSuccess('export');
    return JSON.stringify(dump, null, 2);
  }

  public getLastBackupTimestamp(): string | null {
    try {
      const ts = localStorage.getItem('basha_pos_last_backup_timestamp');
      if (ts) return ts;
      const historyStr = localStorage.getItem('basha_pos_backup_history_records');
      if (historyStr) {
        const history = JSON.parse(historyStr);
        if (Array.isArray(history) && history.length > 0 && history[0].timestamp) {
          return history[0].timestamp;
        }
      }
    } catch (e) {
      console.warn('Error reading last backup timestamp:', e);
    }
    return null;
  }

  public recordBackupSuccess(type: string = 'local', filename?: string): void {
    const now = new Date().toISOString();
    try {
      localStorage.setItem('basha_pos_last_backup_timestamp', now);
    } catch (e) {
      console.warn('Error storing last backup timestamp:', e);
    }
    this.notify();
  }

  public isBackupOverdue(thresholdHours = 24): boolean {
    const last = this.getLastBackupTimestamp();
    if (!last) return true; // Never backed up
    const diffMs = Date.now() - new Date(last).getTime();
    return diffMs > thresholdHours * 60 * 60 * 1000;
  }

  public importBackup(jsonString: string): { success: boolean; error?: string } {
    try {
      const data = JSON.parse(jsonString);
      if (data.profile) this.save(STORAGE_KEYS.PROFILE, data.profile);
      if (data.branches) this.save(STORAGE_KEYS.BRANCHES, data.branches);
      if (data.users) this.save(STORAGE_KEYS.USERS, data.users);
      if (data.categories) this.save(STORAGE_KEYS.CATEGORIES, data.categories);
      if (data.products) this.save(STORAGE_KEYS.PRODUCTS, data.products);
      if (data.modifiers) this.save(STORAGE_KEYS.MODIFIERS, data.modifiers);
      if (data.ingredients) this.save(STORAGE_KEYS.INGREDIENTS, data.ingredients);
      if (data.recipes) this.save(STORAGE_KEYS.RECIPES, data.recipes);
      if (data.tables) this.save(STORAGE_KEYS.TABLES, data.tables);
      if (data.customers) this.save(STORAGE_KEYS.CUSTOMERS, data.customers);
      if (data.suppliers) this.save(STORAGE_KEYS.SUPPLIERS, data.suppliers);
      if (data.orders) this.save(STORAGE_KEYS.ORDERS, data.orders);
      if (data.purchases) this.save(STORAGE_KEYS.PURCHASES, data.purchases);
      if (data.expenses) this.save(STORAGE_KEYS.EXPENSES, data.expenses);
      if (data.shift) this.save(STORAGE_KEYS.SHIFTS, data.shift);
      if (data.auditLogs) this.save(STORAGE_KEYS.AUDIT_LOGS, data.auditLogs);
      if (data.kitchenStations) this.save(STORAGE_KEYS.KITCHEN_STATIONS, data.kitchenStations);
      if (data.kitchenTickets) this.save(STORAGE_KEYS.KITCHEN_TICKETS, data.kitchenTickets);
      if (data.kitchenPrintJobs) this.save(STORAGE_KEYS.KITCHEN_PRINT_JOBS, data.kitchenPrintJobs);
      if (data.kitchenModifications) this.save(STORAGE_KEYS.KITCHEN_MODIFICATIONS, data.kitchenModifications);
      if (data.orderCancellations) this.save(STORAGE_KEYS.ORDER_CANCELLATIONS, data.orderCancellations);
      if (data.kitchenReprints) this.save(STORAGE_KEYS.KITCHEN_REPRINTS, data.kitchenReprints);
      if (data.offers) {
        this.save(STORAGE_KEYS.OFFERS, data.offers);
        this.syncOfferItemsToSQLite(data.offers);
      }
      if (data.offerSales) this.save(STORAGE_KEYS.OFFER_SALES, data.offerSales);

      this.logAudit({
        userId: 'admin',
        userName: 'المدير العام',
        action: 'استعادة نسخة احتياطية',
        category: 'settings',
        details: 'تم استعادة قاعدة البيانات بالكامل بنجاح',
      });
      return { success: true };
    } catch (e: any) {
      console.error('Error importing backup:', e);
      return { success: false, error: e?.message || 'تنسيق الملف غير صالح' };
    }
  }

  /**
   * مسح وتصفير شامل لكل البيانات التجريبية
   * يحذف جميع الطلبات والمبيعات والمصروفات والمشتريات والعملاء والموردين والمنيو والمخزون والطاولات
   * ويبقي فقط على حساب المدير الرئيسي النشط وإعدادات المطعم والفرع الأساسي للبدء الفعلي
   */
  public wipeAllDemoData(options?: { keepMenu?: boolean; keepAdminUser?: boolean }): void {
    const keepMenu = options?.keepMenu ?? false;
    const keepAdminUser = options?.keepAdminUser ?? true;

    // 1. مسح جميع العمليات والحركات المالية
    this.save(STORAGE_KEYS.ORDERS, []);
    this.save(STORAGE_KEYS.HELD_ORDERS, []);
    this.save(STORAGE_KEYS.PURCHASES, []);
    this.save(STORAGE_KEYS.EXPENSES, []);

    // 2. تصفير الوردية الحالية وبدء وردية نظيفة برصيد 0
    const cleanShift: Shift = {
      id: `shift-${Date.now()}`,
      shiftNumber: '1',
      userId: 'usr-1',
      userName: 'أحمد الإداري (مدير النظام)',
      cashierId: 'usr-1',
      cashierName: 'أحمد الإداري (مدير النظام)',
      branchId: 'branch-1',
      branchName: 'الفرع الرئيسي',
      startTime: new Date().toISOString(),
      openedAt: new Date().toISOString(),
      startingCash: 0,
      cashSales: 0,
      cardSales: 0,
      otherSales: 0,
      totalSales: 0,
      ordersCount: 0,
      expenses: 0,
      expectedCash: 0,
      status: 'open',
    };
    this.save(STORAGE_KEYS.SHIFTS, cleanShift);
    this.save(STORAGE_KEYS.SHIFTS_HISTORY, []);

    // 3. مسح العملاء والموردين
    this.save(STORAGE_KEYS.CUSTOMERS, []);
    this.save(STORAGE_KEYS.SUPPLIERS, []);

    // 4. مسح أو الإبقاء على قائمة الطعام والمخزون والطاولات
    if (!keepMenu) {
      this.save(STORAGE_KEYS.PRODUCTS, []);
      this.save(STORAGE_KEYS.CATEGORIES, []);
      this.save(STORAGE_KEYS.MODIFIERS, []);
      this.save(STORAGE_KEYS.INGREDIENTS, []);
      this.save(STORAGE_KEYS.RECIPES, []);
      this.save(STORAGE_KEYS.TABLES, []);
    } else {
      const tables = this.getTables().map((t) => ({ ...t, status: 'available' as const, currentOrderId: undefined }));
      this.save(STORAGE_KEYS.TABLES, tables);
    }

    // 5. الإبقاء على حسابات المديرين فقط
    if (keepAdminUser) {
      const users = this.getUsers();
      const adminUsers = users.filter((u) => u.role === 'admin');
      if (adminUsers.length > 0) {
        this.save(STORAGE_KEYS.USERS, adminUsers);
      } else {
        this.save(STORAGE_KEYS.USERS, [initialUsers[0]]);
      }
    }

    // 6. تسجيل قيد تدقيق افتتاحي للتشغيل الفعلي
    const inauguralAudit: AuditLog[] = [
      {
        id: `audit-${Date.now()}`,
        userId: 'admin',
        userName: 'المدير العام',
        action: 'تصفير شامل للبيانات التجريبية',
        category: 'system',
        details: 'تم مسح وتصفير كافة البيانات التجريبية بنجاح للبدء في التشغيل الفعلي للمطعم',
        timestamp: new Date().toISOString(),
      },
    ];
    this.save(STORAGE_KEYS.AUDIT_LOGS, inauguralAudit);

    this.notify();
  }

  /**
   * مسح وتصفير شامل لكافة البيانات التجريبية والتدريبية (Zero Demo Data - Clean Production Database)
   * يحذف جميع المنتجات، التصنيفات، الطاولات، المخزون، الوصفات، المشتريات، المصروفات، العملاء، الموردين، والطلبات
   * ويبقي فقط على هيكل النظام الأساسي وحساب المدير العام الفعلي المطلوب لتشغيل النظام
   */
  public purgeAllDemoDataNow(): void {
    windowsBridge.log('info', 'DB', 'تصفير شامل وحذف كافة البيانات التجريبية والتدريبية بنجاح للتشغيل الفعلي');

    // 1. مسح جميع المنتجات والتصنيفات والإضافات
    this.save(STORAGE_KEYS.PRODUCTS, []);
    this.save(STORAGE_KEYS.CATEGORIES, []);
    this.save(STORAGE_KEYS.MODIFIERS, []);

    // 2. مسح جميع عناصر المخزون والمكونات والوصفات
    this.save(STORAGE_KEYS.INGREDIENTS, []);
    this.save(STORAGE_KEYS.RECIPES, []);

    // 3. مسح الطاولات وخريطة الصالة
    this.save(STORAGE_KEYS.TABLES, []);

    // 4. مسح جميع العمليات والطلبات والحركات المالية
    this.save(STORAGE_KEYS.ORDERS, []);
    this.save(STORAGE_KEYS.HELD_ORDERS, []);
    this.save(STORAGE_KEYS.PURCHASES, []);
    this.save(STORAGE_KEYS.EXPENSES, []);
    this.save(STORAGE_KEYS.SHIFTS_HISTORY, []);

    // 5. مسح العملاء والموردين التجريبيين
    this.save(STORAGE_KEYS.CUSTOMERS, []);
    this.save(STORAGE_KEYS.SUPPLIERS, []);

    // 6. الإبقاء فقط على حساب المدير العام الحقيقي
    this.save(STORAGE_KEYS.USERS, initialUsers);

    // 7. تصفير الوردية الحالية وبدء وردية نظيفة بحسابات صفرية
    const currentShift = this.getActiveShift();
    const cleanShift: Shift = {
      id: `shift-${Date.now()}`,
      shiftNumber: '1',
      userId: currentShift?.userId || 'user-admin',
      userName: currentShift?.userName || 'المدير العام',
      cashierId: currentShift?.cashierId || 'user-admin',
      cashierName: currentShift?.cashierName || 'المدير العام',
      branchId: currentShift?.branchId || 'branch-1',
      branchName: currentShift?.branchName || 'الفرع الرئيسي',
      startTime: new Date().toISOString(),
      openedAt: new Date().toISOString(),
      startingCash: 0,
      cashSales: 0,
      cardSales: 0,
      otherSales: 0,
      totalSales: 0,
      ordersCount: 0,
      expenses: 0,
      expectedCash: 0,
      status: 'open',
    };
    this.save(STORAGE_KEYS.SHIFTS, cleanShift);

    // 8. تنظيف أرقام الهواتف والعنوان التجريبية مع الحفاظ على إعدادات الطابعتين Rongta RP350
    try {
      const prof = this.getProfile();
      if (prof) {
        prof.phone = '';
        prof.phone2 = '';
        prof.address = '';
        prof.taxNumber = '';
        prof.crNumber = '';
        prof.vatNumber = '';
        prof.slogan = prof.slogan || 'مشويات الباشا ... انت الباشا';
        prof.kitchenPrinterIp = prof.kitchenPrinterIp || '192.168.1.200';
        prof.kitchenPrinterPort = prof.kitchenPrinterPort || 9100;
        prof.printingMode = prof.printingMode || 'escpos_raw';
        if (prof.receiptSettings) {
          prof.receiptSettings.phones = [];
          prof.receiptSettings.addressDetails = '';
          prof.receiptSettings.taxNumber = '';
          prof.receiptSettings.crNumber = '';
          prof.receiptSettings.vatNumber = '';
          prof.receiptSettings.sloganArabic = prof.receiptSettings.sloganArabic || 'مشويات الباشا ... انت الباشا';
          prof.receiptSettings.printingMode = prof.receiptSettings.printingMode || 'escpos_raw';
        }
        this.save(STORAGE_KEYS.PROFILE, prof);
        this.sqliteEngine.insertOrReplace('restaurant_profile', { ...prof, id: 'profile_main' });
        windowsBridge.saveData(STORAGE_KEYS.PROFILE, JSON.stringify(prof));
      }
    } catch (e) {
      console.warn('Profile clean error:', e);
    }

    // 9. تفريغ محرك SQLite الداخلي
    try {
      this.sqliteEngine.clearTable('products');
      this.sqliteEngine.clearTable('categories');
      this.sqliteEngine.clearTable('modifier_groups');
      this.sqliteEngine.clearTable('ingredients');
      this.sqliteEngine.clearTable('recipes');
      this.sqliteEngine.clearTable('restaurant_tables');
      this.sqliteEngine.clearTable('orders');
      this.sqliteEngine.clearTable('held_orders');
      this.sqliteEngine.clearTable('expenses');
      this.sqliteEngine.clearTable('purchase_orders');
      this.sqliteEngine.clearTable('shifts_history');
      this.sqliteEngine.clearTable('customers');
      this.sqliteEngine.clearTable('suppliers');
      this.sqliteEngine.clearTable('users');
      this.sqliteEngine.bulkInsertOrReplace('users', initialUsers);
    } catch (e) {
      console.warn('SQLite clear table error:', e);
    }

    // 10. تفريغ طابور المزامنة
    try {
      syncQueue.clear();
    } catch (e) {
      console.warn('Sync queue clear error:', e);
    }

    // 11. مزامنة الحالة النظيفة مع ملفات قرص Windows
    try {
      windowsBridge.saveData(STORAGE_KEYS.PRODUCTS, '[]');
      windowsBridge.saveData(STORAGE_KEYS.CATEGORIES, '[]');
      windowsBridge.saveData(STORAGE_KEYS.MODIFIERS, '[]');
      windowsBridge.saveData(STORAGE_KEYS.INGREDIENTS, '[]');
      windowsBridge.saveData(STORAGE_KEYS.RECIPES, '[]');
      windowsBridge.saveData(STORAGE_KEYS.TABLES, '[]');
      windowsBridge.saveData(STORAGE_KEYS.CUSTOMERS, '[]');
      windowsBridge.saveData(STORAGE_KEYS.SUPPLIERS, '[]');
      windowsBridge.saveData(STORAGE_KEYS.ORDERS, '[]');
      windowsBridge.saveData(STORAGE_KEYS.HELD_ORDERS, '[]');
      windowsBridge.saveData(STORAGE_KEYS.PURCHASES, '[]');
      windowsBridge.saveData(STORAGE_KEYS.EXPENSES, '[]');
      windowsBridge.saveData(STORAGE_KEYS.SHIFTS_HISTORY, '[]');
      windowsBridge.saveData(STORAGE_KEYS.USERS, JSON.stringify(initialUsers));
    } catch (e) {
      console.warn('Windows bridge save error:', e);
    }

    // 12. تسجيل قيد تدقيق نظيف لافتتاح النظام
    const inauguralAudit: AuditLog[] = [
      {
        id: `audit-${Date.now()}`,
        userId: 'admin',
        userName: 'المدير العام',
        action: 'تهيئة قاعدة البيانات الإنتاجية النظيفة',
        category: 'system',
        details: 'تم تفريغ كافة البيانات التجريبية والتدريبية بنجاح، والنظام في وضع الإنتاج الفعلي النظيف (Zero Demo Data)',
        timestamp: new Date().toISOString(),
      },
    ];
    this.save(STORAGE_KEYS.AUDIT_LOGS, inauguralAudit);

    this.notify();
  }

  /**
   * مسح حركات البيع والعمليات التجريبية فقط (Orders, Expenses, Shifts)
   * مع الإبقاء الكامل على المنيو والتصنيفات والمخزون والطاولات والعملاء
   */
  public wipeDemoTransactionsOnly(adminId = 'admin', adminName = 'المدير العام'): void {
    this.save(STORAGE_KEYS.ORDERS, []);
    this.save(STORAGE_KEYS.HELD_ORDERS, []);
    this.save(STORAGE_KEYS.PURCHASES, []);
    this.save(STORAGE_KEYS.EXPENSES, []);
    this.save(STORAGE_KEYS.KITCHEN_TICKETS, []);
    this.save(STORAGE_KEYS.KITCHEN_PRINT_JOBS, []);
    this.save(STORAGE_KEYS.KITCHEN_MODIFICATIONS, []);
    this.save(STORAGE_KEYS.ORDER_CANCELLATIONS, []);
    this.save(STORAGE_KEYS.KITCHEN_REPRINTS, []);
    this.save(STORAGE_KEYS.OFFER_SALES, []);
    // Reset currentRedemptions on offers while preserving offer definitions
    const resetOffers = this.getOffers().map((o) => ({ ...o, currentRedemptions: 0 }));
    this.save(STORAGE_KEYS.OFFERS, resetOffers);

    // تصفير إحصائيات مشتريات العملاء
    const customers = this.getCustomers().map((c) => ({
      ...c,
      ordersCount: 0,
      totalSpent: 0,
    }));
    this.save(STORAGE_KEYS.CUSTOMERS, customers);

    // تحرير كافة الطاولات وتجهيزها
    const tables = this.getTables().map((t) => ({
      ...t,
      status: 'available' as const,
      currentOrderId: undefined,
    }));
    this.save(STORAGE_KEYS.TABLES, tables);

    // تصفير الوردية الحالية
    const currentShift = this.getActiveShift();
    const cleanShift: Shift = {
      id: `shift-${Date.now()}`,
      shiftNumber: '1',
      userId: currentShift?.userId || currentShift?.cashierId || adminId,
      userName: currentShift?.userName || currentShift?.cashierName || adminName,
      cashierId: currentShift?.cashierId || currentShift?.userId || adminId,
      cashierName: currentShift?.cashierName || currentShift?.userName || adminName,
      branchId: currentShift?.branchId || 'branch-1',
      branchName: currentShift?.branchName || 'الفرع الرئيسي',
      startTime: new Date().toISOString(),
      openedAt: new Date().toISOString(),
      startingCash: 0,
      cashSales: 0,
      cardSales: 0,
      otherSales: 0,
      totalSales: 0,
      ordersCount: 0,
      expenses: 0,
      expectedCash: 0,
      status: 'open',
    };
    this.save(STORAGE_KEYS.SHIFTS, cleanShift);
    this.save(STORAGE_KEYS.SHIFTS_HISTORY, []);

    this.logAudit({
      userId: adminId,
      userName: adminName,
      action: 'تصفير مبيعات وفواتير التجربة',
      category: 'system',
      details: 'تم مسح كافة الفواتير والطلبات والمصروفات التجريبية وتصفير الوردية مع الاحتفاظ بقائمة المنيو والطاولات',
    });

    this.notify();
  }

  // --- تصفير مخصص حسب القطاع ---
  public clearAllOrders(): void {
    this.save(STORAGE_KEYS.ORDERS, []);
    this.save(STORAGE_KEYS.HELD_ORDERS, []);
    this.save(STORAGE_KEYS.KITCHEN_TICKETS, []);
    this.save(STORAGE_KEYS.KITCHEN_PRINT_JOBS, []);
    this.save(STORAGE_KEYS.KITCHEN_MODIFICATIONS, []);
    this.save(STORAGE_KEYS.ORDER_CANCELLATIONS, []);
    this.save(STORAGE_KEYS.KITCHEN_REPRINTS, []);
    this.save(STORAGE_KEYS.OFFER_SALES, []);
    const resetOffers = this.getOffers().map((o) => ({ ...o, currentRedemptions: 0 }));
    this.save(STORAGE_KEYS.OFFERS, resetOffers);
    const tables = this.getTables().map((t) => ({ ...t, status: 'available' as const, currentOrderId: undefined }));
    this.save(STORAGE_KEYS.TABLES, tables);
    this.notify();
  }

  public clearAllExpenses(): void {
    this.save(STORAGE_KEYS.EXPENSES, []);
    this.notify();
  }

  public clearAllPurchases(): void {
    this.save(STORAGE_KEYS.PURCHASES, []);
    this.notify();
  }

  public clearAllCustomers(): void {
    this.save(STORAGE_KEYS.CUSTOMERS, []);
    this.notify();
  }

  public clearAllSuppliers(): void {
    this.save(STORAGE_KEYS.SUPPLIERS, []);
    this.notify();
  }

  public clearAllMenu(): void {
    this.save(STORAGE_KEYS.PRODUCTS, []);
    this.save(STORAGE_KEYS.CATEGORIES, []);
    this.save(STORAGE_KEYS.MODIFIERS, []);
    this.save(STORAGE_KEYS.RECIPES, []);
    this.save(STORAGE_KEYS.INGREDIENTS, []);
    this.notify();
  }

  public clearAllTables(): void {
    this.save(STORAGE_KEYS.TABLES, []);
    this.notify();
  }

  public getDatabaseStats() {
    return {
      ordersCount: this.getOrders().length,
      productsCount: this.getProducts().length,
      categoriesCount: this.getCategories().length,
      ingredientsCount: this.getIngredients().length,
      customersCount: this.getCustomers().length,
      suppliersCount: this.getSuppliers().length,
      expensesCount: this.getExpenses().length,
      purchasesCount: this.getPurchases().length,
      tablesCount: this.getTables().length,
      usersCount: this.getUsers().length,
    };
  }

  public resetToCleanState(): void {
    this.save(STORAGE_KEYS.PROFILE, initialProfile);
    this.save(STORAGE_KEYS.BRANCHES, initialBranches);
    this.save(STORAGE_KEYS.USERS, initialUsers);
    this.save(STORAGE_KEYS.CATEGORIES, []);
    this.save(STORAGE_KEYS.PRODUCTS, []);
    this.save(STORAGE_KEYS.MODIFIERS, []);
    this.save(STORAGE_KEYS.INGREDIENTS, []);
    this.save(STORAGE_KEYS.RECIPES, []);
    this.save(STORAGE_KEYS.TABLES, []);
    this.save(STORAGE_KEYS.CUSTOMERS, []);
    this.save(STORAGE_KEYS.SUPPLIERS, []);
    this.save(STORAGE_KEYS.ORDERS, []);
    this.save(STORAGE_KEYS.PURCHASES, []);
    this.save(STORAGE_KEYS.EXPENSES, []);
    this.save(STORAGE_KEYS.SHIFTS, null);
    this.save(STORAGE_KEYS.SHIFTS_HISTORY, []);
    this.save(STORAGE_KEYS.AUDIT_LOGS, []);
    this.save(STORAGE_KEYS.HELD_ORDERS, []);
    this.save(STORAGE_KEYS.KITCHEN_STATIONS, DEFAULT_KITCHEN_STATIONS.map((s) => ({ ...s })));
    this.save(STORAGE_KEYS.KITCHEN_TICKETS, []);
    this.save(STORAGE_KEYS.KITCHEN_PRINT_JOBS, []);
    this.save(STORAGE_KEYS.KITCHEN_MODIFICATIONS, []);
    this.save(STORAGE_KEYS.ORDER_CANCELLATIONS, []);
    this.save(STORAGE_KEYS.KITCHEN_REPRINTS, []);
    this.save(STORAGE_KEYS.OFFERS, []);
    this.save(STORAGE_KEYS.OFFER_SALES, []);

    this.sqliteEngine.clearTable('orders');
    this.sqliteEngine.clearTable('held_orders');
    this.sqliteEngine.clearTable('kitchen_tickets');
    this.sqliteEngine.clearTable('kitchen_print_jobs');
    this.sqliteEngine.clearTable('kitchen_modifications');
    this.sqliteEngine.clearTable('order_cancellations');
    this.sqliteEngine.clearTable('kitchen_reprints');
    this.sqliteEngine.clearTable('offers');
    this.sqliteEngine.clearTable('offer_items');
    this.sqliteEngine.clearTable('offer_sales');
    this.sqliteEngine.clearTable('products');
    this.sqliteEngine.clearTable('categories');
    this.sqliteEngine.clearTable('modifier_groups');
    this.sqliteEngine.clearTable('recipes');
    this.sqliteEngine.clearTable('ingredients');
    this.sqliteEngine.clearTable('restaurant_tables');
    this.sqliteEngine.clearTable('customers');
    this.sqliteEngine.clearTable('suppliers');
    this.sqliteEngine.clearTable('purchase_orders');
    this.sqliteEngine.clearTable('expenses');
    this.sqliteEngine.clearTable('shifts');
    this.sqliteEngine.clearTable('shifts_history');
    this.sqliteEngine.clearTable('audit_logs');
    this.sqliteEngine.clearTable('branches');
    this.sqliteEngine.clearTable('users');
    this.sqliteEngine.clearTable('kitchen_stations');
    this.sqliteEngine.bulkInsertOrReplace('branches', initialBranches);
    this.sqliteEngine.bulkInsertOrReplace('users', initialUsers);
    this.sqliteEngine.bulkInsertOrReplace('kitchen_stations', DEFAULT_KITCHEN_STATIONS.map((s) => ({ ...s })));

    this.notify();
  }

  public resetToDefaultDemo(): void {
    this.resetToCleanState();
  }
}

export const posDb = new POSDatabase();

export { bashaSqlite, ensureBashaLocalAppDataSQLitePath };
export type { SQLitePathStatus } from './sqlite/bashaSqliteEngine';
