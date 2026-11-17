import {
  KitchenPrintJobRecord,
  KitchenPrintQueuePriority,
  KitchenReprintRecord,
  KitchenTicket,
  KitchenTicketType,
  RestaurantProfile,
} from '../../types';
import { posDb } from '../../services/db';
import { kitchenPrinterAdapter } from '../adapters/KitchenPrinterAdapter';
import { PrinterExecutionResult } from '../adapters/CashierPrinterAdapter';

export interface EnqueueStationTicketsResult {
  queuedJobs: KitchenPrintJobRecord[];
  dedupedCount: number;
  resultsPromise: Promise<SharedBatchPrintOutcome>;
}

export interface SharedBatchPrintOutcome {
  allOk: boolean;
  totalJobs: number;
  completedCount: number;
  failedCount: number;
  results: Array<{
    jobId: string;
    ticketId: string;
    stationId: string;
    stationNameAr: string;
    success: boolean;
    errorMessage?: string;
  }>;
}

function getTicketPriorityWeight(
  ticketType: KitchenTicketType,
  policy: KitchenPrintQueuePriority
): number {
  if (policy === 'fifo_strict') return 100;
  if (policy === 'cancellations_only') {
    return ticketType === 'CANCELLATION' ? 300 : 100;
  }
  // Default: cancellations_and_mods_first
  if (ticketType === 'CANCELLATION') return 300;
  if (ticketType === 'MODIFICATION') return 200;
  return 100;
}

class SharedKitchenPrintQueue {
  private isProcessing = false;
  private activeBatchId: string | null = null;
  private profileOverride: RestaurantProfile | null = null;
  private idleResolvers: Array<() => void> = [];
  private listeners: Set<() => void> = new Set();
  private runtimeResults: Map<string, PrinterExecutionResult> = new Map();

  public subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    this.listeners.forEach((fn) => fn());
  }

  public getSnapshot(): {
    jobs: KitchenPrintJobRecord[];
    pendingCount: number;
    printingCount: number;
    completedCount: number;
    failedCount: number;
    isProcessing: boolean;
  } {
    const jobs = posDb.getKitchenPrintJobs();
    return {
      jobs,
      pendingCount: jobs.filter((j) => j.status === 'pending').length,
      printingCount: jobs.filter((j) => j.status === 'printing').length,
      completedCount: jobs.filter((j) => j.status === 'completed').length,
      failedCount: jobs.filter((j) => j.status === 'failed').length,
      isProcessing: this.isProcessing,
    };
  }

  public async waitForIdle(): Promise<void> {
    if (!this.isProcessing) {
      const pending = posDb.getKitchenPrintJobs().some((j) => j.status === 'pending' || j.status === 'printing');
      if (!pending) return;
    }
    return new Promise((resolve) => {
      this.idleResolvers.push(resolve);
    });
  }

  private resolveIdleWaiters(): void {
    if (this.isProcessing) return;
    const resolvers = [...this.idleResolvers];
    this.idleResolvers = [];
    resolvers.forEach((r) => r());
  }

  /**
   * Enqueue a batch of station tickets onto the single shared kitchen printer queue.
   * Ensures all tickets of an order are added atomically before processing starts,
   * prevents duplicates via dedupeKey, and prevents stale NEW tickets from printing over CANCELLATION.
   */
  public enqueueTickets(
    tickets: KitchenTicket[],
    profile: RestaurantProfile,
    options?: { isReprint?: boolean; dedupePrefix?: string }
  ): EnqueueStationTicketsResult {
    this.profileOverride = profile;
    const policy: KitchenPrintQueuePriority = profile.kitchenQueuePriority || 'cancellations_and_mods_first';
    const existingJobs = posDb.getKitchenPrintJobs();
    const nowIso = new Date().toISOString();

    const newJobs: KitchenPrintJobRecord[] = [];
    const trackedJobIds: string[] = [];
    let dedupedCount = 0;

    // Step 1: Handle stale pending NEW/MODIFICATION jobs if a CANCELLATION arrives
    const cancellationTargets = tickets.filter((t) => t.ticketType === 'CANCELLATION');
    if (cancellationTargets.length > 0) {
      let supersededAny = false;
      existingJobs.forEach((job, idx) => {
        if (
          job.status === 'pending' &&
          job.ticketType !== 'CANCELLATION' &&
          cancellationTargets.some((c) => c.orderId === job.orderId && c.stationId === job.stationId)
        ) {
          existingJobs[idx] = {
            ...job,
            status: 'completed',
            completedAt: nowIso,
            errorMessage: 'تم إيقاف التذكرة المعلقة قبل الطباعة لصدور أمر إلغاء أحدث',
          };
          supersededAny = true;
        }
      });
      if (supersededAny) {
        posDb.saveKitchenPrintJobsBatch(existingJobs);
      }
    }

    // Step 2: Build jobs in strict sequence order
    const orderedTickets = [...tickets].sort((a, b) => a.sequenceIndex - b.sequenceIndex);
    orderedTickets.forEach((ticket, idx) => {
      const dedupeKey = options?.isReprint
        ? `reprint:${ticket.id}:${Date.now()}:${idx}`
        : `${options?.dedupePrefix || 'ticket'}:${ticket.orderId}:${ticket.stationId}:${ticket.ticketType}:${ticket.id}`;

      const duplicate = !options?.isReprint
        ? existingJobs.find(
            (j) =>
              j.dedupeKey === dedupeKey &&
              (j.status === 'pending' || j.status === 'printing' || j.status === 'completed')
          )
        : undefined;

      if (duplicate) {
        dedupedCount++;
        trackedJobIds.push(duplicate.jobId);
        return;
      }

      const jobId = ticket.printJobId || `kpj-${Date.now()}-${Math.floor(Math.random() * 10000)}-${idx}`;
      const job: KitchenPrintJobRecord = {
        jobId,
        orderId: ticket.orderId,
        orderNumber: ticket.orderNumber,
        orderBatchId: ticket.orderBatchId,
        ticketId: ticket.id,
        ticketType: ticket.ticketType,
        stationId: ticket.stationId,
        stationCode: ticket.stationCode,
        stationNameAr: ticket.stationNameAr,
        sequenceLabel: ticket.sequenceLabel,
        priority: getTicketPriorityWeight(ticket.ticketType, policy),
        status: 'pending',
        retryCount: 0,
        dedupeKey,
        printerId: 'shared_kitchen_printer',
        createdAt: new Date(Date.now() + idx).toISOString(),
      };

      newJobs.push(job);
      trackedJobIds.push(job.jobId);

      // Update ticket linkage
      posDb.saveKitchenTicket({
        ...ticket,
        printJobId: job.jobId,
        printStatus: 'pending',
      });
    });

    if (newJobs.length > 0) {
      posDb.saveKitchenPrintJobsBatch(newJobs);
      this.notify();
    }

    const processingPromise = this.processQueue(profile).then(() => {
      const latestJobs = posDb.getKitchenPrintJobs();
      const results = trackedJobIds.map((jid) => {
        const job = latestJobs.find((j) => j.jobId === jid);
        const runtime = this.runtimeResults.get(jid);
        const success = job ? job.status === 'completed' : Boolean(runtime?.success);
        return {
          jobId: jid,
          ticketId: job?.ticketId || '',
          stationId: job?.stationId || '',
          stationNameAr: job?.stationNameAr || '',
          success,
          errorMessage: job?.errorMessage || runtime?.errorMessage,
        };
      });
      const completedCount = results.filter((r) => r.success).length;
      const failedCount = results.length - completedCount;
      return {
        allOk: failedCount === 0,
        totalJobs: results.length,
        completedCount,
        failedCount,
        results,
      };
    });

    return {
      queuedJobs: newJobs,
      dedupedCount,
      resultsPromise: processingPromise,
    };
  }

  /**
   * Pick the next pending job respecting:
   * 1) Active batch contiguity (if kitchenGroupOrderTickets is true)
   * 2) Configured priority policy (cancellations_and_mods_first | fifo_strict | cancellations_only)
   * 3) Sequence index inside the same order batch (1/3 -> 2/3 -> 3/3)
   */
  private selectNextPendingJob(
    jobs: KitchenPrintJobRecord[],
    ticketsById: Map<string, KitchenTicket>,
    profile: RestaurantProfile
  ): KitchenPrintJobRecord | undefined {
    const pending = jobs.filter((j) => j.status === 'pending');
    if (pending.length === 0) return undefined;

    const groupBatches = profile.kitchenGroupOrderTickets !== false;
    const policy: KitchenPrintQueuePriority = profile.kitchenQueuePriority || 'cancellations_and_mods_first';

    // Keep current batch contiguous until all its pending station tickets finish
    if (groupBatches && this.activeBatchId) {
      const sameBatch = pending.filter((j) => j.orderBatchId === this.activeBatchId);
      if (sameBatch.length > 0) {
        return sameBatch.sort((a, b) => {
          const seqA = ticketsById.get(a.ticketId)?.sequenceIndex ?? 0;
          const seqB = ticketsById.get(b.ticketId)?.sequenceIndex ?? 0;
          return seqA - seqB;
        })[0];
      }
      this.activeBatchId = null;
    }

    // Also allow urgent CANCELLATION to preempt before starting a new normal batch
    const sorted = [...pending].sort((a, b) => {
      const weightA = getTicketPriorityWeight(a.ticketType, policy);
      const weightB = getTicketPriorityWeight(b.ticketType, policy);
      if (weightA !== weightB) return weightB - weightA;

      const timeA = new Date(a.createdAt).getTime();
      const timeB = new Date(b.createdAt).getTime();
      if (a.orderBatchId !== b.orderBatchId && timeA !== timeB) {
        return timeA - timeB;
      }

      const seqA = ticketsById.get(a.ticketId)?.sequenceIndex ?? 0;
      const seqB = ticketsById.get(b.ticketId)?.sequenceIndex ?? 0;
      if (seqA !== seqB) return seqA - seqB;

      return timeA - timeB;
    });

    const chosen = sorted[0];
    if (chosen && groupBatches) {
      this.activeBatchId = chosen.orderBatchId;
    }
    return chosen;
  }

  public async processQueue(profileArg?: RestaurantProfile): Promise<void> {
    if (profileArg) {
      this.profileOverride = profileArg;
    }
    if (this.isProcessing) {
      return this.waitForIdle();
    }

    this.isProcessing = true;
    this.notify();

    try {
      while (true) {
        const profile = this.profileOverride || posDb.getProfile();
        const jobs = posDb.getKitchenPrintJobs();
        const tickets = posDb.getKitchenTickets();
        const ticketsById = new Map(tickets.map((t) => [t.id, t]));

        const nextJob = this.selectNextPendingJob(jobs, ticketsById, profile);
        if (!nextJob) break;

        const ticket = ticketsById.get(nextJob.ticketId);
        if (!ticket) {
          posDb.saveKitchenPrintJob({
            ...nextJob,
            status: 'failed',
            errorCode: 'TICKET_NOT_FOUND',
            errorMessage: 'تذكرة المحطة غير موجودة في قاعدة البيانات',
            completedAt: new Date().toISOString(),
          });
          continue;
        }

        const startedAt = new Date().toISOString();
        posDb.saveKitchenPrintJob({
          ...nextJob,
          status: 'printing',
          startedAt,
        });
        posDb.saveKitchenTicket({
          ...ticket,
          printStatus: 'printing',
          printJobId: nextJob.jobId,
        });
        posDb.updateOrderStationPrintState(ticket.orderId, ticket.stationId, 'printing', ticket.id);
        this.notify();

        const res = await kitchenPrinterAdapter.printStationTicketDirect(ticket, profile, {
          retryCount: nextJob.retryCount,
          isReprint: nextJob.dedupeKey.startsWith('reprint:'),
        });
        this.runtimeResults.set(nextJob.jobId, res);

        const finishedAt = new Date().toISOString();
        if (res.success) {
          posDb.saveKitchenPrintJob({
            ...nextJob,
            status: 'completed',
            startedAt,
            completedAt: finishedAt,
            errorCode: undefined,
            errorMessage: undefined,
          });
          posDb.saveKitchenTicket({
            ...ticket,
            printStatus: 'completed',
            printError: undefined,
            lastPrintedAt: finishedAt,
            status:
              ticket.ticketType === 'CANCELLATION'
                ? 'CANCELLED'
                : ticket.status === 'NEW'
                ? 'PRINTED'
                : ticket.status,
          });
          posDb.updateOrderStationPrintState(ticket.orderId, ticket.stationId, 'completed', ticket.id);
        } else {
          posDb.saveKitchenPrintJob({
            ...nextJob,
            status: 'failed',
            startedAt,
            completedAt: finishedAt,
            errorCode: res.errorCode || 'LAN_WRITE_ERROR',
            errorMessage: res.errorMessage || 'تعذر الطباعة على طابعة المطبخ المشتركة',
          });
          posDb.saveKitchenTicket({
            ...ticket,
            printStatus: 'failed',
            printError: res.errorMessage || 'تعذر الطباعة على طابعة المطبخ المشتركة',
          });
          posDb.updateOrderStationPrintState(ticket.orderId, ticket.stationId, 'failed', ticket.id);
        }

        this.notify();

        // Small thermal spooler breathing delay between sequential station tickets
        const morePending = posDb.getKitchenPrintJobs().some((j) => j.status === 'pending');
        if (morePending) {
          const delayMs = typeof window === 'undefined' ? 5 : 180;
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    } finally {
      this.activeBatchId = null;
      this.isProcessing = false;
      this.notify();
      this.resolveIdleWaiters();
    }
  }

  public async retryFailedJobs(
    profile: RestaurantProfile,
    filterOrderId?: string
  ): Promise<SharedBatchPrintOutcome> {
    this.profileOverride = profile;
    const jobs = posDb.getKitchenPrintJobs();
    const targetJobs = jobs.filter(
      (j) => j.status === 'failed' && (!filterOrderId || j.orderId === filterOrderId)
    );

    if (targetJobs.length === 0) {
      return {
        allOk: true,
        totalJobs: 0,
        completedCount: 0,
        failedCount: 0,
        results: [],
      };
    }

    const updated = targetJobs.map((j) => ({
      ...j,
      status: 'pending' as const,
      retryCount: (j.retryCount || 0) + 1,
      errorCode: undefined,
      errorMessage: undefined,
    }));
    posDb.saveKitchenPrintJobsBatch(updated);

    const tickets = posDb.getKitchenTickets();
    updated.forEach((j) => {
      const t = tickets.find((tk) => tk.id === j.ticketId);
      if (t) {
        posDb.saveKitchenTicket({ ...t, printStatus: 'pending', printError: undefined });
      }
    });
    this.notify();

    await this.processQueue(profile);

    const refreshed = posDb.getKitchenPrintJobs();
    const results = updated.map((orig) => {
      const latest = refreshed.find((j) => j.jobId === orig.jobId) || orig;
      return {
        jobId: latest.jobId,
        ticketId: latest.ticketId,
        stationId: latest.stationId,
        stationNameAr: latest.stationNameAr,
        success: latest.status === 'completed',
        errorMessage: latest.errorMessage,
      };
    });
    const completedCount = results.filter((r) => r.success).length;
    return {
      allOk: completedCount === results.length,
      totalJobs: results.length,
      completedCount,
      failedCount: results.length - completedCount,
      results,
    };
  }

  public async reprintTicket(
    ticketId: string,
    profile: RestaurantProfile,
    actor: { userId?: string; userName?: string },
    reason?: string
  ): Promise<{ success: boolean; ticket?: KitchenTicket; result?: PrinterExecutionResult }> {
    const ticket = posDb.getKitchenTickets().find((t) => t.id === ticketId);
    if (!ticket) {
      return { success: false };
    }

    const { resultsPromise } = this.enqueueTickets([ticket], profile, { isReprint: true });
    const outcome = await resultsPromise;
    const itemOutcome = outcome.results[0];
    const success = Boolean(itemOutcome?.success);

    const latestTicket = posDb.getKitchenTickets().find((t) => t.id === ticketId) || ticket;
    const updatedTicket: KitchenTicket = {
      ...latestTicket,
      reprintCount: (latestTicket.reprintCount || 0) + (success ? 1 : 0),
      lastPrintedAt: success ? new Date().toISOString() : latestTicket.lastPrintedAt,
    };
    posDb.saveKitchenTicket(updatedTicket);

    const reprintRecord: KitchenReprintRecord = {
      id: `reprint-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      orderId: ticket.orderId,
      orderNumber: ticket.orderNumber,
      ticketId: ticket.id,
      stationId: ticket.stationId,
      stationNameAr: ticket.stationNameAr,
      employeeId: actor.userId || 'cashier',
      employeeName: actor.userName || 'الكاشير',
      reason: reason || 'إعادة طباعة يدوية لتذكرة محطة',
      success,
      errorMessage: itemOutcome?.errorMessage,
      timestamp: new Date().toISOString(),
    };
    posDb.saveKitchenReprint(reprintRecord);

    posDb.logAudit({
      userId: reprintRecord.employeeId,
      userName: reprintRecord.employeeName,
      action: `إعادة طباعة محطة (${ticket.stationNameAr})`,
      category: 'order',
      details: `الطلب ${ticket.orderNumber} | المحطة ${ticket.stationNameAr} (${ticket.sequenceLabel}) | النتيجة: ${
        success ? 'نجاح' : `فشل: ${itemOutcome?.errorMessage || ''}`
      }`,
    });

    return {
      success,
      ticket: updatedTicket,
      result: itemOutcome ? this.runtimeResults.get(itemOutcome.jobId) : undefined,
    };
  }
}

export const sharedKitchenPrintQueue = new SharedKitchenPrintQueue();
