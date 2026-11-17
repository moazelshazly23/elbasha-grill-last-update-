import { windowsBridge, PrinterTestConnectionResult } from '../../services/windowsBridge';
import { printJobManager } from '../../services/printJobManager';
import { classifyLanError } from '../core/PrintErrorHandler';
import { validateClientLanTarget } from '../drivers/TcpPrinterDriver';

export interface NetworkDiagnosticResult extends PrinterTestConnectionResult {
  checkedAt: string;
  ip: string;
  port: number;
  checkType: 'network' | 'port';
}

export class NetworkDiagnosticsService {
  public async testEndpoint(options: {
    ip: string;
    port: number;
    timeoutMs?: number;
    checkType?: 'network' | 'port';
  }): Promise<NetworkDiagnosticResult> {
    const checkType = options.checkType || 'port';
    const checkedAt = new Date().toISOString();
    const validation = validateClientLanTarget(options.ip, options.port);

    if (!validation.valid) {
      const err = validation.error!;
      printJobManager.updateConnectionStatus(
        'kitchen',
        'offline',
        `${validation.ip}:${validation.port}`,
        err.userMessageAr,
        err.code
      );
      return {
        success: false,
        reachable: false,
        printerName: `${validation.ip}:${validation.port}`,
        ip: validation.ip,
        port: validation.port,
        checkType,
        checkedAt,
        errorCode: err.code,
        details: err.userMessageAr,
        technicalDetails: err.suggestedFixAr,
      };
    }

    const res = await windowsBridge.testPrinterConnection({
      target: 'kitchen_lan',
      ip: validation.ip,
      port: validation.port,
      timeoutMs: options.timeoutMs || 3000,
      checkType,
    });

    if (res.reachable) {
      printJobManager.updateConnectionStatus('kitchen', 'connected', `${validation.ip}:${validation.port}`);
    } else {
      const classified = classifyLanError(
        res.details,
        res.errorCode,
        validation.ip,
        validation.port,
        res.technicalDetails
      );
      printJobManager.updateConnectionStatus(
        'kitchen',
        classified.isOffline ? 'offline' : 'error',
        `${validation.ip}:${validation.port}`,
        classified.userMessageAr,
        classified.code
      );
    }

    return {
      ...res,
      ip: validation.ip,
      port: validation.port,
      checkType,
      checkedAt,
    };
  }
}

export const networkDiagnostics = new NetworkDiagnosticsService();
