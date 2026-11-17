import { Router, Request, Response, NextFunction } from 'express';
import { cloudStorage } from './storage';
import { PublishedCatalog } from './types';

export const posApiRouter = Router();

/**
 * Authentication middleware for Windows POS devices
 * Enforces least-privilege token check (never customer/user token)
 */
function authenticateDevice(req: Request, res: Response, next: NextFunction) {
  const tokenHeader =
    (req.headers['x-device-token'] as string) ||
    (req.headers['authorization'] as string);

  if (!tokenHeader) {
    return res.status(401).json({ error: 'Device authentication token missing' });
  }

  const isValid = cloudStorage.validateDeviceToken(tokenHeader);
  if (!isValid) {
    return res.status(403).json({ error: 'Invalid or revoked POS device credentials' });
  }

  next();
}

// Apply device auth to all POS routes except public health summary
posApiRouter.use((req, res, next) => {
  if (req.path === '/sync/health' && req.method === 'GET') {
    return next();
  }
  return authenticateDevice(req, res, next);
});

/**
 * Poll & Lease Pending Orders
 * POST /api/pos/orders/poll
 */
posApiRouter.post('/orders/poll', (req: Request, res: Response) => {
  const deviceId = (req.body?.deviceId as string) || (req.headers['x-device-id'] as string) || 'windows-pos-main';
  const limit = Math.min(20, Math.max(1, parseInt(req.body?.limit || '10', 10)));
  const leaseDurationSeconds = Math.max(30, parseInt(req.body?.leaseDuration || '60', 10));

  const leasedOrders = cloudStorage.leasePendingOrders(deviceId, limit, leaseDurationSeconds);

  return res.status(200).json({
    success: true,
    deviceId,
    count: leasedOrders.length,
    orders: leasedOrders,
    polledAt: new Date().toISOString(),
  });
});

/**
 * Acknowledge Order after Durable Local Persistence
 * POST /api/pos/orders/ack
 */
posApiRouter.post('/orders/ack', (req: Request, res: Response) => {
  const deviceId = (req.body?.deviceId as string) || (req.headers['x-device-id'] as string) || 'windows-pos-main';
  const { orderId, status, localSaved, printStatus, reason } = req.body;

  if (!orderId || !status) {
    return res.status(400).json({ error: 'orderId and status are required' });
  }

  if (status !== 'accepted' && status !== 'failed' && status !== 'needs_review') {
    return res.status(400).json({ error: 'status must be accepted, failed, or needs_review' });
  }

  const ackResult = cloudStorage.acknowledgeOrder(orderId, deviceId, status, {
    localSaved: Boolean(localSaved),
    printStatus,
    reason,
  });

  if (!ackResult.success) {
    return res.status(404).json({ error: ackResult.error });
  }

  return res.status(200).json({
    success: true,
    orderId,
    status: ackResult.order?.status,
    acknowledgedAt: new Date().toISOString(),
  });
});

/**
 * Publish / Sync POS Menu & Availability to Cloud
 * POST /api/pos/catalog/sync
 */
posApiRouter.post('/catalog/sync', (req: Request, res: Response) => {
  const catalogPayload = req.body as Partial<PublishedCatalog>;

  if (!catalogPayload || !Array.isArray(catalogPayload.products)) {
    return res.status(400).json({ error: 'Invalid catalog payload: products array required' });
  }

  const updatedCatalog = cloudStorage.updateCatalog(catalogPayload);

  return res.status(200).json({
    success: true,
    syncedAt: updatedCatalog.syncedAt,
    productsCount: updatedCatalog.products.length,
    branchId: updatedCatalog.branchId,
  });
});

/**
 * POS Sync Health Check
 * GET /api/pos/sync/health
 */
posApiRouter.get('/sync/health', (_req: Request, res: Response) => {
  const stats = cloudStorage.getQueueStats();
  const catalogAgeMs = Date.now() - new Date(stats.catalogSyncedAt).getTime();
  const isCatalogStale = catalogAgeMs > 24 * 60 * 60 * 1000; // > 24 hours

  return res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    queue: stats,
    catalog: {
      syncedAt: stats.catalogSyncedAt,
      ageMinutes: Math.floor(catalogAgeMs / 60000),
      isStale: isCatalogStale,
    },
  });
});
