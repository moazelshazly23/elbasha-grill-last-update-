/**
 * Print Job Manager & Diagnostics Telemetry for El Basha Grill POS
 *
 * Tracks every Cashier / Kitchen / Test print job with:
 * - Job ID, Order ID & Order Number, Printer ID/Name, Connection Type, Protocol
 * - Created / Started / Completed timestamps, Payload size, Error Code, Sanitized Details, Retry Count
 * - Honest spooler vs physical paper verification distinction
 * - Duplicate-print prevention guard within configurable window (unless explicit reprint or test print)
 */

import type { PrintingMode } from '../utils/printingProtocols';

export type PrintTargetType = 'cashier' | 'kitchen' | 'test';
export type PrintJobStatus = 'pending' | 'printing' | 'completed' | 'failed';
export type SpoolerStage =
  | 'queued'
  | 'dispatched'
  | 'accepted_by_spooler'
  | 'physically_verified'
  | 'failed';

export interface PrintJobRecord {
  jobId: string;
  invoiceId: string;
  orderNumber: string;
  target: PrintTargetType;
  printerId?: string;
  printerName: string;
  connectionType?: 'usb' | 'lan' | 'driver';
  protocolMode: PrintingMode | string;
  createdAt: string;
  startedAt?: string;
  status: PrintJobStatus;
  spoolerStage: SpoolerStage;
  isReprint: boolean;
  bytesSent: number;
  retryCount?: number;
  errorCode?: string;
  errorDetails?: string;
  technicalDetails?: string;
  completedAt?: string;
  physicallyVerifiedAt?: string;
}

export type PrinterConnectionState = 'connected' | 'offline' | 'error' | 'unknown';

export interface PrinterHealthSummary {
  target: 'cashier' | 'kitchen';
  status: PrinterConnectionState;
  lastPrinterUsed?: string;
  lastSuccessfulPrintAt?: string;
  lastErrorCode?: string;
  lastError?: string;
  lastCheckedAt?: string;
}

const STORAGE_KEY_JOBS = 'basha_pos_print_jobs_v1';
const STORAGE_KEY_HEALTH = 'basha_pos_printer_health_v1';
const MAX_STORED_JOBS = 150;

type Listener = () => void;

class PrintJobManager {
  private jobs: PrintJobRecord[] = [];
  private health: Record<'cashier' | 'kitchen', PrinterHealthSummary> = {
    cashier: { target: 'cashier', status: 'unknown' },
    kitchen: { target: 'kitchen', status: 'unknown' },
  };
  private listeners: Set<Listener> = new Set();

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      const rawJobs = localStorage.getItem(STORAGE_KEY_JOBS);
      if (rawJobs) {
        const parsed = JSON.parse(rawJobs);
        if (Array.isArray(parsed)) this.jobs = parsed.slice(0, MAX_STORED_JOBS);
      }
      const rawHealth = localStorage.getItem(STORAGE_KEY_HEALTH);
      if (rawHealth) {
        const parsedHealth = JSON.parse(rawHealth);
        if (parsedHealth?.cashier) this.health.cashier = parsedHealth.cashier;
        if (parsedHealth?.kitchen) this.health.kitchen = parsedHealth.kitchen;
      }
    } catch {
      // ignore corrupted localStorage telemetry
    }
  }

  private saveToStorage(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(STORAGE_KEY_JOBS, JSON.stringify(this.jobs.slice(0, MAX_STORED_JOBS)));
      localStorage.setItem(STORAGE_KEY_HEALTH, JSON.stringify(this.health));
    } catch {
      // ignore storage quota failures
    }
  }

  private notify(): void {
    this.listeners.forEach((cb) => {
      try {
        cb();
      } catch {
        // ignore subscriber errors
      }
    });
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Duplicate-Print Guard: prevents double firing of the same invoice + target within windowSeconds
   * unless `isReprint === true` or `target === 'test'`.
   */
  public canDispatchJob(
    invoiceId: string,
    target: PrintTargetType,
    isReprint = false,
    windowSeconds = 10
  ): { allowed: boolean; reason?: string; existingJobId?: string } {
    if (isReprint || target === 'test' || windowSeconds <= 0) {
      return { allowed: true };
    }

    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const recent = this.jobs.find(
      (j) =>
        j.invoiceId === invoiceId &&
        j.target === target &&
        (j.status === 'pending' || j.status === 'printing' || j.status === 'completed') &&
        now - new Date(j.createdAt).getTime() < windowMs
    );

    if (recent) {
      return {
        allowed: false,
        reason: `تم إرسال هذا الطلب (${recent.orderNumber}) للطابعة مؤخراً لتجنب تكرار الطباعة.`,
        existingJobId: recent.jobId,
      };
    }

    return { allowed: true };
  }

  public createJob(params: {
    invoiceId: string;
    orderNumber: string;
    target: PrintTargetType;
    printerId?: string;
    printerName: string;
    connectionType?: 'usb' | 'lan' | 'driver';
    protocolMode: PrintingMode | string;
    isReprint?: boolean;
    retryCount?: number;
  }): PrintJobRecord {
    const priorFailures = this.jobs.filter(
      (j) => j.invoiceId === params.invoiceId && j.target === params.target && j.status === 'failed'
    ).length;

    const record: PrintJobRecord = {
      jobId: `pj-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      invoiceId: params.invoiceId,
      orderNumber: params.orderNumber,
      target: params.target,
      printerId: params.printerId || params.printerName,
      printerName: params.printerName,
      connectionType: params.connectionType || (params.target === 'kitchen' ? 'lan' : 'usb'),
      protocolMode: params.protocolMode,
      createdAt: new Date().toISOString(),
      status: 'pending',
      spoolerStage: 'queued',
      isReprint: Boolean(params.isReprint),
      bytesSent: 0,
      retryCount: params.retryCount ?? (params.isReprint ? priorFailures : 0),
    };
    this.jobs.unshift(record);
    if (this.jobs.length > MAX_STORED_JOBS) {
      this.jobs.length = MAX_STORED_JOBS;
    }
    this.saveToStorage();
    this.notify();
    return record;
  }

  public markPrinting(jobId: string): void {
    const job = this.jobs.find((j) => j.jobId === jobId);
    if (!job) return;
    job.status = 'printing';
    job.spoolerStage = 'dispatched';
    job.startedAt = new Date().toISOString();
    this.saveToStorage();
    this.notify();
  }

  public markSpoolerAccepted(jobId: string, bytesSent = 0, resolvedPrinter?: string): void {
    const job = this.jobs.find((j) => j.jobId === jobId);
    if (!job) return;
    const now = new Date().toISOString();
    job.status = 'completed';
    job.spoolerStage = 'accepted_by_spooler';
    job.bytesSent = bytesSent;
    job.completedAt = now;
    if (resolvedPrinter) {
      job.printerName = resolvedPrinter;
      job.printerId = resolvedPrinter;
    }

    const channel = job.target === 'kitchen' ? 'kitchen' : 'cashier';
    this.health[channel] = {
      target: channel,
      status: 'connected',
      lastPrinterUsed: job.printerName,
      lastSuccessfulPrintAt: now,
      lastError: undefined,
      lastErrorCode: undefined,
      lastCheckedAt: now,
    };

    this.saveToStorage();
    this.notify();
  }

  public markFailed(
    jobId: string,
    errorDetails: string,
    isOffline = false,
    errorCode?: string,
    technicalDetails?: string
  ): void {
    const job = this.jobs.find((j) => j.jobId === jobId);
    if (!job) return;
    const now = new Date().toISOString();
    job.status = 'failed';
    job.spoolerStage = 'failed';
    job.errorCode = errorCode || 'UNKNOWN_PRINT_ERROR';
    job.errorDetails = errorDetails;
    job.technicalDetails = technicalDetails || errorDetails;
    job.completedAt = now;

    const channel = job.target === 'kitchen' ? 'kitchen' : 'cashier';
    this.health[channel] = {
      ...this.health[channel],
      target: channel,
      status: isOffline ? 'offline' : 'error',
      lastPrinterUsed: job.printerName,
      lastErrorCode: job.errorCode,
      lastError: errorDetails,
      lastCheckedAt: now,
    };

    this.saveToStorage();
    this.notify();
  }

  /**
   * Manual confirmation ONLY — called when an operator physically inspects thermal paper output.
   */
  public markPhysicallyVerified(jobId: string): void {
    const job = this.jobs.find((j) => j.jobId === jobId);
    if (!job) return;
    job.spoolerStage = 'physically_verified';
    job.physicallyVerifiedAt = new Date().toISOString();
    this.saveToStorage();
    this.notify();
  }

  public updateConnectionStatus(
    target: 'cashier' | 'kitchen',
    status: PrinterConnectionState,
    printerName: string,
    error?: string,
    errorCode?: string
  ): void {
    const now = new Date().toISOString();
    this.health[target] = {
      ...this.health[target],
      target,
      status,
      lastPrinterUsed: printerName,
      lastErrorCode: status === 'connected' ? undefined : errorCode,
      lastError: status === 'connected' ? undefined : error,
      lastCheckedAt: now,
    };
    this.saveToStorage();
    this.notify();
  }

  public getJobs(limit = 50): PrintJobRecord[] {
    return this.jobs.slice(0, limit);
  }

  public getHealth(): Record<'cashier' | 'kitchen', PrinterHealthSummary> {
    return {
      cashier: { ...this.health.cashier },
      kitchen: { ...this.health.kitchen },
    };
  }

  public clearJobs(): void {
    this.jobs = [];
    this.saveToStorage();
    this.notify();
  }

  public exportPrintLogsJson(): string {
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        health: this.health,
        jobs: this.jobs,
      },
      null,
      2
    );
  }

  public exportPrintLogsText(): string {
    const lines: string[] = [
      `=== EL BASHA GRILL POS - RONGTA RP350 PRINT LOGS ===`,
      `Exported At: ${new Date().toISOString()}`,
      `Cashier Printer Health: ${this.health.cashier.status} (${this.health.cashier.lastPrinterUsed || 'N/A'})`,
      `Kitchen Printer Health: ${this.health.kitchen.status} (${this.health.kitchen.lastPrinterUsed || 'N/A'})`,
      `----------------------------------------------------`,
    ];

    if (this.jobs.length === 0) {
      lines.push('No print jobs recorded yet.');
    } else {
      for (const j of this.jobs) {
        lines.push(
          `[${j.createdAt}] ${j.jobId} | Order=${j.orderNumber} (${j.invoiceId}) | Target=${j.target} | Conn=${j.connectionType || 'N/A'} | Mode=${j.protocolMode} | Printer="${j.printerName}" | Status=${j.status} (${j.spoolerStage}) | Bytes=${j.bytesSent} | Retry=${j.retryCount || 0} | Reprint=${j.isReprint}${j.errorCode ? ` | Code=${j.errorCode}` : ''}${j.errorDetails ? ` | Error="${j.errorDetails}"` : ''}`
        );
      }
    }

    return lines.join('\n');
  }
}

export const printJobManager = new PrintJobManager();
