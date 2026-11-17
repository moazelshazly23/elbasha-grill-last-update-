export type QueueOrderStatus = 'pending' | 'leased' | 'accepted' | 'failed' | 'needs_review';

export interface PublishedCatalogItem {
  id: string;
  nameAr: string;
  nameEn?: string;
  price: number;
  costPrice?: number;
  available: boolean;
  categoryId: string;
  kitchenStation: 'grill' | 'kitchen' | 'cold';
  modifierGroupIds?: string[];
}

export interface PublishedModifierOption {
  id: string;
  nameAr: string;
  nameEn?: string;
  priceDelta: number;
}

export interface PublishedModifierGroup {
  id: string;
  nameAr: string;
  nameEn?: string;
  required: boolean;
  minSelections: number;
  maxSelections: number;
  options: PublishedModifierOption[];
}

export interface PublishedCatalog {
  syncedAt: string;
  branchId: string;
  branchName: string;
  currency: string;
  taxPercent: number;
  defaultDeliveryFee: number;
  minimumOrderAmount: number;
  deliveryAreas: string[];
  products: PublishedCatalogItem[];
  modifierGroups: PublishedModifierGroup[];
}

export interface DraftOrderItem {
  productId: string;
  productNameAr: string;
  unitPrice: number;
  quantity: number;
  selectedModifiers: Array<{
    groupId: string;
    groupNameAr: string;
    optionId: string;
    nameAr: string;
    priceDelta: number;
  }>;
  itemTotal: number;
  notes?: string;
  kitchenStation: 'grill' | 'kitchen' | 'cold';
}

export interface DraftOrder {
  version: number;
  branchId: string;
  branchName: string;
  customerName?: string;
  customerPhone: string;
  deliveryAddress?: string;
  items: DraftOrderItem[];
  subtotal: number;
  taxAmount: number;
  deliveryFee: number;
  total: number;
  notes?: string;
  formattedSummary?: string;
  createdAt: string;
  updatedAt: string;
}

export type ConversationState = 'idle' | 'drafting' | 'awaiting_confirmation' | 'confirmed' | 'human_handoff';

export interface CustomerConversation {
  customerPhone: string;
  customerName?: string;
  state: ConversationState;
  currentDraft?: DraftOrder;
  lastConfirmedOrderId?: string;
  lastConfirmedExternalId?: string;
  lastInteractionAt: string;
  history: Array<{
    role: 'customer' | 'assistant' | 'system';
    text: string;
    timestamp: string;
  }>;
}

export interface CloudQueueOrder {
  id: string;
  externalOrderId: string;
  channel: 'web' | 'pos';
  branchId: string;
  customerPhone: string;
  customerName?: string;
  deliveryAddress: string;
  status: QueueOrderStatus;
  leaseExpiresAt?: string | null;
  leasedByDevice?: string | null;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
  eventIds: string[];
  payload: any; // Complete normalized Order object
  auditLogs: Array<{
    timestamp: string;
    action: string;
    details: string;
    performedBy?: string;
  }>;
  reviewReason?: string;
}
