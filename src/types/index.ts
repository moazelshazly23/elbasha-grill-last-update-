export type UserRole = 'admin' | 'cashier' | 'kitchen' | 'manager';

export interface User {
  id: string;
  name: string;
  username: string;
  pin?: string;
  password?: string;
  role: UserRole;
  branchId: string;
  active: boolean;
  avatar?: string;
  phone?: string;
  email?: string;
  createdAt: string;
  permissions?: string[];
}

export interface Branch {
  id: string;
  name: string;
  address: string;
  phone: string;
  isMain: boolean;
  active: boolean;
  createdAt: string;
}

export type ShiftStatus = 'open' | 'closed';

export interface Shift {
  id: string;
  shiftNumber?: string;
  userId: string;
  userName: string;
  cashierId?: string;
  cashierName?: string;
  branchId: string;
  branchName?: string;
  startTime: string;
  openedAt?: string;
  endTime?: string;
  closedAt?: string;
  startingCash: number;
  cashSales: number;
  cardSales: number;
  otherSales: number;
  totalSales?: number;
  ordersCount?: number;
  expenses: number;
  expectedCash: number;
  actualCash?: number;
  cashDifference?: number;
  difference?: number;
  status: ShiftStatus;
  notes?: string;
}

export interface Category {
  id: string;
  nameAr: string;
  nameEn: string;
  icon: string;
  color?: string;
  sortOrder?: number;
  order?: number;
  active?: boolean;
}

export interface ModifierOption {
  id: string;
  nameAr: string;
  nameEn: string;
  priceDelta: number;
}

export interface ModifierGroup {
  id: string;
  nameAr: string;
  nameEn: string;
  required: boolean;
  minSelections: number;
  maxSelections: number;
  options: ModifierOption[];
}

export interface Product {
  id: string;
  nameAr: string;
  nameEn: string;
  sku: string;
  barcode?: string;
  categoryId: string;
  price: number;
  costPrice: number;
  image?: string;
  description?: string;
  available: boolean;
  prepTimeMinutes: number;
  kitchenStation: string;
  stationId?: string;
  recipeId?: string;
  modifierGroupIds?: string[];
  isPopular?: boolean;
  trackInventory?: boolean;
  currentStock?: number;
  minStock?: number;
  maxStock?: number;
  unit?: string;
  isActive?: boolean;
  isArchived?: boolean;
  status?: 'active' | 'inactive' | 'archived';
  notes?: string;
  deletedAt?: string;
  deletedBy?: string;
}

export interface Ingredient {
  id: string;
  name: string;
  nameEn?: string;
  sku?: string;
  barcode?: string;
  unit: string;
  currentStock: number;
  minStock: number;
  maxStock?: number;
  costPerUnit: number;
  category?: string;
  itemType?: string;
  supplierId?: string;
  supplierName?: string;
  status?: 'active' | 'inactive' | 'archived';
  isActive?: boolean;
  isArchived?: boolean;
  notes?: string;
  updatedAt?: string;
  deletedAt?: string;
  deletedBy?: string;
}

export interface RecipeItem {
  ingredientId: string;
  ingredientName?: string;
  quantity: number; // in base units
  unit?: string;
}

export interface Recipe {
  id?: string;
  productId: string;
  productName?: string;
  items: RecipeItem[];
  totalCost?: number;
}

export type TableStatus = 'available' | 'occupied' | 'reserved' | 'cleaning';

export interface RestaurantTable {
  id: string;
  number: string;
  branchId: string;
  capacity: number;
  section: string;
  status: TableStatus;
  currentOrderId?: string;
  lastOccupiedAt?: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  address?: string;
  area?: string;
  notes?: string;
  ordersCount: number;
  totalSpent: number;
  createdAt: string;
}

export type OrderType = 'dine_in' | 'takeaway' | 'delivery' | 'pickup';
export type OrderStatus = 'new' | 'confirmed' | 'preparing' | 'ready' | 'completed' | 'cancelled' | 'refunded';

export interface SelectedModifier {
  groupId: string;
  groupNameAr: string;
  optionId: string;
  nameAr: string;
  priceDelta: number;
}

export interface OfferComponent {
  productId: string;
  productNameAr: string;
  productNameEn?: string;
  unitPrice: number;
  costPrice?: number;
  quantity: number;
  stationId?: string;
}

export type OfferStatus = 'active' | 'paused' | 'expired';

export interface SpecialOffer {
  id: string;
  nameAr: string;
  nameEn?: string;
  description?: string;
  imageUrl?: string;
  components: OfferComponent[];
  originalPrice: number;
  useCustomOriginalPrice?: boolean;
  offerPrice: number;
  savingsAmount: number;
  savingsPercent: number;
  status: OfferStatus;
  sortOrder: number;
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  validDays?: number[]; // 0=Sunday..6=Saturday
  startTime?: string; // HH:mm
  endTime?: string; // HH:mm
  maxTotalRedemptions?: number;
  currentRedemptions: number;
  maxPerOrder?: number;
  createdAt: string;
  updatedAt?: string;
}

export interface OfferSaleRecord {
  id: string;
  orderId: string;
  orderNumber: string;
  offerId: string;
  offerName: string;
  quantity: number;
  unitOfferPrice: number;
  unitOriginalPrice: number;
  unitSavings: number;
  totalRevenue: number;
  totalSavings: number;
  status: 'active' | 'cancelled' | 'refunded';
  createdAt: string;
  updatedAt?: string;
}

export interface OrderItem {
  id: string;
  itemType?: 'product' | 'offer';
  offerId?: string;
  originalUnitPrice?: number;
  savingsPerUnit?: number;
  offerComponents?: OfferComponent[];
  productId: string;
  productNameAr: string;
  productNameEn?: string;
  unitPrice: number;
  costPrice: number;
  quantity: number;
  selectedModifiers: SelectedModifier[];
  itemTotal: number;
  notes?: string;
  kitchenStation: string;
  stationId?: string;
  status: 'pending' | 'preparing' | 'ready' | 'completed' | 'cancelled';
  cancelled?: boolean;
  cancelledAt?: string;
  cancelledBy?: string;
  cancelReason?: string;
}

export type PaymentMethodType = 'cash' | 'card' | 'instapay' | 'bank_transfer' | 'other';

export interface PaymentItem {
  method: PaymentMethodType;
  amount: number;
  reference?: string;
}

export type PaymentStatus = 'unpaid' | 'partially_paid' | 'paid' | 'refunded';
export type OrderChannel = 'pos' | 'web';
export type OrderPrintStatus = 'pending' | 'printed' | 'failed';

export interface Order {
  id: string;
  orderNumber: string;
  type: OrderType;
  branchId: string;
  branchName: string;
  cashierId: string;
  cashierName: string;
  tableNumber?: string;
  tableId?: string;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  deliveryAddress?: string;
  deliveryFee?: number;
  driverName?: string;
  items: OrderItem[];
  subtotal: number;
  discountType?: 'percent' | 'fixed';
  discountValue?: number;
  discountAmount: number;
  taxPercent: number;
  taxAmount: number;
  serviceChargePercent: number;
  serviceChargeAmount: number;
  total: number;
  payments: PaymentItem[];
  paidAmount: number;
  changeAmount: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  channel?: OrderChannel;
  externalOrderId?: string;
  printStatus?: OrderPrintStatus;
  printRetryCount?: number;
  kitchenPrintStatus?: OrderPrintStatus;
  kitchenPrintedAt?: string;
  kitchenPrintRetryCount?: number;
  kitchenPrintError?: string;
  paymentCollectedAt?: string;
  paymentCollectedBy?: string;
  codCollected?: boolean;
  refundedAmount?: number;
  refundedAt?: string;
  refundReason?: string;
  refundedBy?: string;
  refundMethod?: PaymentMethodType;
  createdAt: string;
  updatedAt?: string;
  completedAt?: string;
  prepStartedAt?: string;
  notes?: string;
  stationStates?: OrderStationState[];
  overallKitchenStatus?: KitchenStationStatus;
  cancellationRecordId?: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string;
  company?: string;
  address?: string;
  category: string;
  balance: number;
  createdAt?: string;
}

export interface PurchaseOrderItem {
  ingredientId: string;
  ingredientName: string;
  quantity: number;
  unitPrice?: number;
  unitCost?: number;
  total: number;
}

export interface PurchaseOrder {
  id: string;
  orderNumber: string;
  supplierId: string;
  supplierName: string;
  branchId: string;
  date?: string;
  items: PurchaseOrderItem[];
  total: number;
  totalAmount?: number;
  status?: string;
  paymentStatus: 'paid' | 'partial' | 'unpaid';
  paidAmount: number;
  notes?: string;
  createdAt: string;
}

export interface Expense {
  id: string;
  title?: string;
  category: string;
  amount: number;
  date?: string;
  branchId: string;
  branchName?: string;
  userId?: string;
  userName?: string;
  paidTo?: string;
  paidFromDrawer?: boolean;
  notes?: string;
  recordedBy?: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  userId: string;
  userName: string;
  action: string;
  category: 'auth' | 'order' | 'inventory' | 'settings' | 'shift' | 'expense' | 'system';
  details: string;
  timestamp: string;
}

export interface ReceiptPhoneEntry {
  id: string;
  number: string;
  label?: string;
  showOnReceipt: boolean;
}

export interface ReceiptSettings {
  paperWidth: '80mm' | '58mm';
  showLogo: boolean;
  logoAlignment: 'left' | 'center' | 'right';
  logoWidth: number; // width in px (e.g. 120)
  showRestaurantName: boolean;
  restaurantNameArabic?: string;
  showEnglishName: boolean;
  restaurantNameEnglish?: string;
  showSlogan: boolean;
  sloganArabic?: string;
  sloganEnglish?: string;
  showAddress: boolean;
  addressDetails?: string;

  // Phone list
  phones: ReceiptPhoneEntry[];
  showPhone: boolean;
  showEmail: boolean;
  email?: string;
  showWebsite: boolean;
  website?: string;
  showFacebook: boolean;
  facebookUrl?: string;
  showInstagram: boolean;
  instagramUrl?: string;

  // Tax & Regulatory
  showTaxNumber: boolean;
  taxNumber?: string;
  showCrNumber: boolean;
  crNumber?: string;
  showVatNumber: boolean;
  vatNumber?: string;
  taxRate?: number;
  taxLabel?: string;

  // Order Info
  showOrderNumber: boolean;
  showDate: boolean;
  showTime: boolean;
  showCashier: boolean;
  showCustomer: boolean;
  showTable: boolean;
  showOrderType: boolean;
  showBranch: boolean;

  // Payment
  showPaymentMethod: boolean;
  showPaidAmount: boolean;
  showChange: boolean;
  showRemaining: boolean;

  // Financial
  showSubtotal: boolean;
  showDiscount: boolean;
  showTax: boolean;
  showServiceCharge?: boolean;
  showDeliveryFee: boolean;
  showTotal: boolean;

  // QR Code
  enableQrCode: boolean;
  qrType: 'website' | 'google_maps' | 'facebook' | 'instagram' | 'review' | 'custom' | 'tax_einvoice';
  qrUrl: string;
  qrLabel: string;
  qrAlignment: 'left' | 'center' | 'right';
  qrSize: number; // in px (e.g. 80, 110, 140)

  // Header Note & Footer
  showHeaderNote?: boolean;
  headerNote?: string;
  showFooter: boolean;
  footerMessage: string;
  footerMessageArabic?: string;
  footerMessageEnglish?: string;

  // Dual Thermal Printer & Typography Configuration (Rongta RP350 USB + LAN 9100)
  printingMode?: 'escpos_raw' | 'windows_driver';
  marginTopMm?: number;
  marginBottomMm?: number;
  marginLeftMm?: number;
  marginRightMm?: number;
  paperFeedLines?: number;
  receiptAlignment?: 'right' | 'center' | 'left';
  preventDuplicatePrintSeconds?: number;
  cashierPrinterUsbName?: string;
  cashierPrinterModel?: string;
  kitchenPrinterIp?: string;
  kitchenPrinterPort?: number;
  kitchenPrinterModel?: string;
  kitchenPrinterProtocol?: 'escpos_raster' | 'escpos_text' | 'plain_line' | 'windows_driver';
  kitchenConnectTimeoutMs?: number;
  cashierCopies?: number;
  kitchenCopies?: number;
  cashierAutoCut?: boolean;
  kitchenAutoCut?: boolean;
  kitchenBuzzerEnabled?: boolean;
  cashierFontSize?: 'small' | 'medium' | 'large';
  kitchenFontSize?: 'small' | 'medium' | 'large';
}

export interface RestaurantProfile {
  name: string;
  englishName: string;
  slogan: string;
  sloganEnglish?: string;
  logoUrl?: string; // base64 or URL
  useOfficialLogo: boolean;
  phone: string;
  phone2?: string;
  email?: string;
  website?: string;
  facebook?: string;
  instagram?: string;
  address: string;
  taxNumber: string;
  crNumber: string;
  vatNumber?: string;
  taxRate?: number;
  taxLabel?: string;
  currency: string;
  currencySymbol: string;
  defaultTaxPercent: number;
  defaultServicePercent: number;
  thermalPaperWidth: '80mm' | '58mm' | 'a4';
  autoPrintReceipt: boolean;
  receiptHeaderNote: string;
  receiptFooterNote: string;
  receiptSettings?: ReceiptSettings;
  primaryColor: string;
  accentColor: string;
  darkColor: string;
  bgColor: string;
  setupCompleted: boolean;
  // Windows Desktop & Hardware Configuration
  printingMode?: 'escpos_raw' | 'windows_driver';
  paperFeedLines?: number;
  preventDuplicatePrintSeconds?: number;
  receiptPrinterName?: string;
  cashierPrinterModel?: string;
  kitchenPrinterName?: string;
  kitchenPrinterModel?: string;
  kitchenPrinterProtocol?: 'escpos_raster' | 'escpos_text' | 'plain_line' | 'windows_driver';
  kitchenConnectTimeoutMs?: number;
  barPrinterName?: string;
  kitchenPrinterIp?: string;
  kitchenPrinterPort?: number;
  cashierCopies?: number;
  kitchenCopies?: number;
  cashierAutoCut?: boolean;
  kitchenAutoCut?: boolean;
  kitchenBuzzerEnabled?: boolean;
  cashierFontSize?: 'small' | 'medium' | 'large';
  kitchenFontSize?: 'small' | 'medium' | 'large';
  kitchenAutoPrint?: boolean;
  kitchenAutoPrintOnConfirmed?: boolean;
  kitchenPrintSoundAlert?: boolean;
  kitchenPrintPaperWidth?: '80mm' | '58mm';
  directPrintingEnabled?: boolean;
  posFullscreenMode?: boolean;
  singleInstanceLock?: boolean;
  appVersion?: string;
  buildNumber?: string;
  dataStoragePath?: string;
  licenseStatus?: 'active' | 'trial' | 'commercial';
  licenseKey?: string;
  cloudSyncEnabled?: boolean;
  cloudSyncEndpoint?: string;
  lastCloudSyncAt?: string;
  multiCurrencySettings?: MultiCurrencySettings;
  kitchenQueuePriority?: KitchenPrintQueuePriority;
  kitchenGroupOrderTickets?: boolean;
}

export interface HeldOrder {
  id: string;
  orderNumber: string;
  heldAt: string;
  orderType: OrderType;
  tableNumber?: string;
  tableId?: string;
  customerName?: string;
  customerId?: string;
  customerPhone?: string;
  deliveryAddress?: string;
  deliveryFee: number;
  discountMode: 'percent' | 'fixed';
  discountValue: number;
  orderNotes: string;
  items: OrderItem[];
  subtotal: number;
  total: number;
  itemCount: number;
}

// ==========================================
// Multi-Currency & Price Management Types
// ==========================================

export interface CurrencyInfo {
  code: string;
  nameAr: string;
  nameEn: string;
  symbolAr: string;
  symbolEn: string;
  exchangeRate: number; // 1 Base Currency = X Target Currency
  isBase: boolean;
  isActive: boolean;
  roundingRule?: 'none' | 'decimal2' | 'ceil' | 'round5' | 'round10';
  lastUpdated?: string;
}

export interface MultiCurrencySettings {
  baseCurrency: string;
  baseSymbol: string;
  supportedCurrencies: CurrencyInfo[];
  allowSecondaryCurrencyInPOS: boolean;
  secondaryCurrencyCode?: string;
  autoUpdatePricesOnBaseChange: boolean;
  priceRounding: 'none' | 'decimal2' | 'ceil' | 'round5' | 'round10';
  lastRateUpdate?: string;
}

// ==========================================
// Scheduled Reports (Email) Types
// ==========================================

export type ReportScheduleFrequency = 'daily' | 'weekly';
export type ReportContentType = 'financial_summary' | 'sales_data' | 'comprehensive';

export interface ReportScheduleConfig {
  id: string;
  name: string;
  enabled: boolean;
  frequency: ReportScheduleFrequency;
  timeOfDay: string; // 'HH:mm', e.g. '23:00'
  dayOfWeek?: number; // 0=Sunday, 1=Monday, ..., 5=Friday, 6=Saturday
  managerEmail: string;
  managerName?: string;
  ccEmails?: string[];
  reportType: ReportContentType;
  format: 'pdf_and_html' | 'pdf_only' | 'html_only';
  includeExecutiveCharts: boolean;
  lastRunAt?: string;
  lastStatus?: 'success' | 'failed' | 'skipped';
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReportScheduleLog {
  id: string;
  scheduleId: string;
  scheduleName: string;
  sentAt: string;
  recipientEmail: string;
  frequency: ReportScheduleFrequency;
  reportType: ReportContentType;
  status: 'sent' | 'opened_client' | 'failed';
  totalRevenue: number;
  ordersCount: number;
  periodLabel: string;
  message?: string;
}

// ==========================================
// Single-Printer Multi-Station Kitchen Types
// ==========================================

export type KitchenStationStatus = 'NEW' | 'PRINTED' | 'PREPARING' | 'READY' | 'CANCELLED';
export type KitchenTicketType = 'NEW' | 'MODIFICATION' | 'CANCELLATION';
export type KitchenPrintQueuePriority =
  | 'cancellations_and_mods_first'
  | 'fifo_strict'
  | 'cancellations_only';

export interface KitchenStation {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  enabled: boolean;
  sortOrder: number;
  printerId: string; // Always binds to the single shared kitchen printer
  color?: string;
  chefLeadName?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface KitchenTicketItem {
  orderItemId: string;
  productId: string;
  productNameAr: string;
  productNameEn?: string;
  quantity: number;
  previousQuantity?: number;
  action?: 'ADD' | 'REMOVE' | 'CHANGE' | 'KEEP';
  selectedModifiers?: SelectedModifier[];
  notes?: string;
  sourceOfferId?: string;
  sourceOfferName?: string;
}

export interface KitchenTicket {
  id: string;
  orderId: string;
  orderNumber: string;
  orderBatchId: string;
  stationId: string;
  stationCode: string;
  stationNameAr: string;
  stationNameEn: string;
  chefLeadName?: string;
  ticketType: KitchenTicketType;
  sequenceIndex: number;
  sequenceTotal: number;
  sequenceLabel: string; // e.g. '1/3'
  status: KitchenStationStatus;
  printStatus: 'pending' | 'printing' | 'completed' | 'failed';
  printJobId?: string;
  printError?: string;
  reprintCount: number;
  lastPrintedAt?: string;
  orderType: OrderType;
  tableNumber?: string;
  orderTime: string;
  orderNotes?: string;
  items: KitchenTicketItem[];
  modificationSummary?: string;
  cancellationReason?: string;
  actorUserId?: string;
  actorUserName?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface OrderStationState {
  stationId: string;
  stationCode: string;
  stationNameAr: string;
  stationNameEn: string;
  status: KitchenStationStatus;
  latestTicketId?: string;
  printStatus: 'pending' | 'printing' | 'completed' | 'failed';
  updatedAt: string;
  updatedBy?: string;
}

export interface KitchenModificationDiff {
  orderItemId: string;
  productId: string;
  productNameAr: string;
  stationId: string;
  stationNameAr: string;
  changeType: 'ADD' | 'REMOVE' | 'CHANGE';
  oldQuantity: number;
  newQuantity: number;
  notes?: string;
  selectedModifiers?: SelectedModifier[];
  sourceOfferId?: string;
  sourceOfferName?: string;
}

export interface KitchenModificationRecord {
  id: string;
  orderId: string;
  orderNumber: string;
  reason: string;
  employeeId: string;
  employeeName: string;
  approvedBy?: string;
  hadPreparingWarning: boolean;
  restockedUnusedIngredients: boolean;
  diffs: KitchenModificationDiff[];
  affectedStationIds: string[];
  generatedTicketIds: string[];
  createdAt: string;
}

export interface CancellationRecord {
  id: string;
  orderId: string;
  orderNumber: string;
  scope: 'item' | 'order';
  orderItemId?: string;
  productNameAr?: string;
  quantity?: number;
  reason: string;
  employeeId: string;
  employeeName: string;
  approvedBy?: string;
  wasPreparingOrReady: boolean;
  inventoryAction: 'restocked' | 'wastage_no_restock' | 'none';
  affectedStationIds: string[];
  generatedTicketIds: string[];
  timestamp: string;
}

export interface KitchenReprintRecord {
  id: string;
  orderId: string;
  orderNumber: string;
  ticketId: string;
  stationId: string;
  stationNameAr: string;
  employeeId: string;
  employeeName: string;
  reason?: string;
  success: boolean;
  errorMessage?: string;
  timestamp: string;
}

export interface KitchenPrintJobRecord {
  jobId: string;
  orderId: string;
  orderNumber: string;
  orderBatchId: string;
  ticketId: string;
  ticketType: KitchenTicketType;
  stationId: string;
  stationCode: string;
  stationNameAr: string;
  sequenceLabel: string;
  priority: number; // Higher executes earlier within configured policy
  status: 'pending' | 'printing' | 'completed' | 'failed';
  retryCount: number;
  dedupeKey: string;
  printerId: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

