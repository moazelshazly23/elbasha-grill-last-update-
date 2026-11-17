/**
 * Persistent Print Logger backed by PrintJobManager telemetry store
 * Records job ID, order ID/number, printer ID/name, connection type, protocol,
 * timestamps, payload size, result, error code, sanitized error message, and retry count.
 */

import { printJobManager, PrintJobRecord, PrinterHealthSummary, PrintTargetType } from '../../services/printJobManager';
import { sanitizeDiagnosticText } from './PrintErrorHandler';

export type ConnectionType = 'usb' | 'lan' | 'driver';

export interface StartPrintLogParams {
  orderId: string;
  orderNumber: string;
  target: PrintTargetType;
  printerId: string;
  printerName: string;
  connectionType: ConnectionType;
  protocol: string;
  isReprint?: boolean;
  retryCount?: number;
}

class PrintLoggerService {
  public startJob(params: StartPrintLogParams): PrintJobRecord {
    return printJobManager.createJob({
      invoiceId: params.orderId,
      orderNumber: params.orderNumber,
      target: params.target,
      printerId: params.printerId,
      printerName: params.printerName,
      connectionType: params.connectionType,
      protocolMode: params.protocol as any,
      isReprint: params.isReprint,
      retryCount: params.retryCount,
    });
  }

  public markStarted(jobId: string): void {
    printJobManager.markPrinting(jobId);
  }

  public markSuccess(jobId: string, bytesSent: number, resolvedPrinter?: string): void {
    printJobManager.markSpoolerAccepted(jobId, bytesSent, resolvedPrinter);
  }

  public markFailure(params: {
    jobId: string;
    errorCode: string;
    errorMessage: string;
    technicalDetails?: string;
    isOffline: boolean;
  }): void {
    printJobManager.markFailed(
      params.jobId,
      sanitizeDiagnosticText(params.errorMessage),
      params.isOffline,
      params.errorCode,
      sanitizeDiagnosticText(params.technicalDetails || '')
    );
  }

  public getLogs(limit = 100): PrintJobRecord[] {
    return printJobManager.getJobs(limit);
  }

  public getHealth(): Record<'cashier' | 'kitchen', PrinterHealthSummary> {
    return printJobManager.getHealth();
  }

  public subscribe(listener: () => void): () => void {
    return printJobManager.subscribe(listener);
  }

  public clearLogs(): void {
    printJobManager.clearJobs();
  }

  public exportLogsText(): string {
    return sanitizeDiagnosticText(printJobManager.exportPrintLogsText());
  }

  public exportLogsJson(): string {
    return sanitizeDiagnosticText(printJobManager.exportPrintLogsJson());
  }
}

export const printLogger = new PrintLoggerService();
