import { KitchenTicket, Order, RestaurantProfile } from '../../types';
import { PrintingMode } from '../../utils/printingProtocols';
import { classifyLanError, classifyUsbError } from '../core/PrintErrorHandler';
import { printJobQueue } from '../core/PrintJobQueue';
import { printLogger } from '../core/PrintLogger';
import { printJobManager } from '../../services/printJobManager';
import { escPosDriver, KitchenLanguageProtocol } from '../drivers/EscPosDriver';
import { tcpPrinterDriver } from '../drivers/TcpPrinterDriver';
import { windowsPrinterDriver } from '../drivers/WindowsPrinterDriver';
import { PrinterExecutionResult } from './CashierPrinterAdapter';
import { renderLinesToEscPosGSv0Base64 } from '../templates/ReceiptTemplate';
import {
  buildKitchenKotPlainText,
  buildKitchenKotRasterLines,
  buildStationKotPlainText,
  buildStationKotRasterLines,
  generateKitchenTicketHTML,
  generateStationKitchenTicketHTML,
} from '../templates/KitchenTicketTemplate';

export class KitchenPrinterAdapter {
  public resolveProtocol(profile: RestaurantProfile): KitchenLanguageProtocol {
    const rs = profile.receiptSettings;
    const explicit = rs?.kitchenPrinterProtocol || profile.kitchenPrinterProtocol;
    if (explicit) return explicit;
    const globalMode: PrintingMode = rs?.printingMode || profile.printingMode || 'escpos_raw';
    return globalMode === 'windows_driver' ? 'windows_driver' : 'escpos_raster';
  }

  public async printStationTicketDirect(
    ticket: KitchenTicket,
    profile: RestaurantProfile,
    options?: { skipBrowserDialog?: boolean; isReprint?: boolean; retryCount?: number }
  ): Promise<PrinterExecutionResult> {
    const rs = profile.receiptSettings;
    const targetPrinter = profile.kitchenPrinterName || 'Rongta RP350 (Kitchen - LAN)';
    const kitchenIp =
      profile.kitchenPrinterIp === '0.0.0.0' || profile.kitchenPrinterIp?.toLowerCase() === 'offline'
        ? profile.kitchenPrinterIp
        : rs?.kitchenPrinterIp || profile.kitchenPrinterIp || '192.168.1.200';
    const kitchenPort = Number(rs?.kitchenPrinterPort ?? profile.kitchenPrinterPort ?? 9100) || 9100;
    const protocol = this.resolveProtocol(profile);
    const copies = Math.max(1, Math.min(5, Number(rs?.kitchenCopies ?? profile.kitchenCopies ?? 1)));
    const autoCut = (rs?.kitchenAutoCut ?? profile.kitchenAutoCut) !== false;
    const buzzer = (rs?.kitchenBuzzerEnabled ?? profile.kitchenBuzzerEnabled ?? profile.kitchenPrintSoundAlert) !== false;
    const feedLines = Math.max(2, Math.min(10, Number(rs?.paperFeedLines ?? 4)));
    const paperWidth = (profile.kitchenPrintPaperWidth || rs?.paperWidth || profile.thermalPaperWidth) === '58mm' ? '58mm' : '80mm';
    const timeoutMs = Number(rs?.kitchenConnectTimeoutMs ?? profile.kitchenConnectTimeoutMs ?? 3500);

    return printJobQueue.enqueue('kitchen_lan', async () => {
      const displayPrinter = protocol === 'windows_driver' ? targetPrinter : `${targetPrinter} (${kitchenIp}:${kitchenPort})`;
      const job = printLogger.startJob({
        orderId: `${ticket.orderId}:${ticket.stationId}`,
        orderNumber: `${ticket.orderNumber} [${ticket.stationCode} ${ticket.sequenceLabel}]`,
        target: 'kitchen',
        printerId: displayPrinter,
        printerName: displayPrinter,
        connectionType: protocol === 'windows_driver' ? 'driver' : 'lan',
        protocol,
        isReprint: options?.isReprint,
        retryCount: options?.retryCount,
      });
      printLogger.markStarted(job.jobId);

      try {
        escPosDriver.assertTargetSafe(targetPrinter);
        const ticketHtml = generateStationKitchenTicketHTML(ticket, profile);
        escPosDriver.assertCleanPayload(ticketHtml, `Station KOT HTML (${ticket.stationCode})`);

        if (protocol === 'windows_driver') {
          const driverRes = await windowsPrinterDriver.printHtml({
            html: ticketHtml,
            printerName: targetPrinter,
            paperWidth,
            copies,
            silent: true,
            skipBrowserDialog: options?.skipBrowserDialog,
          });
          if (!driverRes.success) {
            const structured = driverRes.error || classifyUsbError('تعذر طباعة تذكرة المحطة عبر تعريف Windows', undefined, targetPrinter);
            printLogger.markFailure({
              jobId: job.jobId,
              errorCode: structured.code,
              errorMessage: structured.userMessageAr,
              technicalDetails: structured.technicalDetails,
              isOffline: structured.isOffline,
            });
            return {
              success: false,
              target: 'kitchen',
              jobId: job.jobId,
              printerName: displayPrinter,
              protocol,
              bytesSent: 0,
              errorCode: structured.code,
              errorMessage: structured.userMessageAr,
              technicalDetails: structured.technicalDetails,
              suggestedFix: structured.suggestedFixAr,
            };
          }

          printLogger.markSuccess(job.jobId, driverRes.bytesSent, driverRes.resolvedPrinter || targetPrinter);
          return {
            success: true,
            target: 'kitchen',
            jobId: job.jobId,
            printerName: displayPrinter,
            resolvedPrinter: driverRes.resolvedPrinter || targetPrinter,
            protocol,
            bytesSent: driverRes.bytesSent,
          };
        }

        let escposBase64: string | undefined;
        let rawText: string | undefined;
        let estimatedByteLength = 0;

        if (protocol === 'escpos_raster') {
          const kotLines = buildStationKotRasterLines(ticket, profile);
          escposBase64 = renderLinesToEscPosGSv0Base64(kotLines, paperWidth);
          const rawBytes = escPosDriver.buildRasterFrame({
            rasterBase64: escposBase64,
            alignment: 'center',
            paperFeedLines: feedLines,
            autoCut,
            buzzer,
            copies,
          });
          estimatedByteLength = rawBytes.length;
        } else {
          rawText = buildStationKotPlainText(ticket, profile);
          const rawBytes = escPosDriver.buildPlainTextFrame({
            text: rawText,
            includeEscPosWrapper: protocol === 'escpos_text',
            paperFeedLines: feedLines,
            autoCut,
            buzzer,
            copies,
          });
          estimatedByteLength = rawBytes.length;
        }

        const tcpRes = await tcpPrinterDriver.sendRawSocket({
          printerName: targetPrinter,
          ip: kitchenIp,
          port: kitchenPort,
          orderNumber: `${ticket.orderNumber}-${ticket.stationCode}`,
          protocol,
          rasterBase64: escposBase64,
          rawText,
          copies,
          autoCut,
          buzzer,
          paperFeedLines: feedLines,
          paperWidth,
          timeoutMs,
          estimatedByteLength,
        });

        if (!tcpRes.success) {
          const structured = tcpRes.error || classifyLanError('تعذر الاتصال بطابعة المطبخ المشتركة', undefined, kitchenIp, kitchenPort);
          printLogger.markFailure({
            jobId: job.jobId,
            errorCode: structured.code,
            errorMessage: structured.userMessageAr,
            technicalDetails: structured.technicalDetails,
            isOffline: structured.isOffline,
          });
          return {
            success: false,
            target: 'kitchen',
            jobId: job.jobId,
            printerName: displayPrinter,
            protocol,
            bytesSent: 0,
            errorCode: structured.code,
            errorMessage: structured.userMessageAr,
            technicalDetails: structured.technicalDetails,
            suggestedFix: structured.suggestedFixAr,
          };
        }

        printLogger.markSuccess(job.jobId, tcpRes.bytesSent, tcpRes.resolvedPrinter || `${kitchenIp}:${kitchenPort}`);
        return {
          success: true,
          target: 'kitchen',
          jobId: job.jobId,
          printerName: displayPrinter,
          resolvedPrinter: tcpRes.resolvedPrinter || `${kitchenIp}:${kitchenPort}`,
          protocol,
          bytesSent: tcpRes.bytesSent,
        };
      } catch (err: any) {
        const structured = classifyLanError(err?.message || String(err), undefined, kitchenIp, kitchenPort, String(err?.stack || ''));
        printLogger.markFailure({
          jobId: job.jobId,
          errorCode: structured.code,
          errorMessage: structured.userMessageAr,
          technicalDetails: structured.technicalDetails,
          isOffline: structured.isOffline,
        });
        return {
          success: false,
          target: 'kitchen',
          jobId: job.jobId,
          printerName: displayPrinter,
          protocol,
          bytesSent: 0,
          errorCode: structured.code,
          errorMessage: structured.userMessageAr,
          technicalDetails: structured.technicalDetails,
          suggestedFix: structured.suggestedFixAr,
        };
      }
    });
  }

  public async printKitchenOrderTicket(
    order: Order,
    profile: RestaurantProfile,
    options?: { skipBrowserDialog?: boolean; isReprint?: boolean; targetOverride?: 'kitchen' | 'test'; retryCount?: number }
  ): Promise<PrinterExecutionResult> {
    const rs = profile.receiptSettings;
    const targetPrinter = profile.kitchenPrinterName || 'Rongta RP350 (Kitchen - LAN)';
    const kitchenIp =
      profile.kitchenPrinterIp === '0.0.0.0' || profile.kitchenPrinterIp?.toLowerCase() === 'offline'
        ? profile.kitchenPrinterIp
        : rs?.kitchenPrinterIp || profile.kitchenPrinterIp || '192.168.1.200';
    const kitchenPort = Number(rs?.kitchenPrinterPort ?? profile.kitchenPrinterPort ?? 9100) || 9100;
    const protocol = this.resolveProtocol(profile);
    const copies = Math.max(1, Math.min(5, Number(rs?.kitchenCopies ?? profile.kitchenCopies ?? 1)));
    const autoCut = (rs?.kitchenAutoCut ?? profile.kitchenAutoCut) !== false;
    const buzzer = (rs?.kitchenBuzzerEnabled ?? profile.kitchenBuzzerEnabled ?? profile.kitchenPrintSoundAlert) !== false;
    const feedLines = Math.max(0, Math.min(10, Number(rs?.paperFeedLines ?? 4)));
    const paperWidth = (profile.kitchenPrintPaperWidth || rs?.paperWidth || profile.thermalPaperWidth) === '58mm' ? '58mm' : '80mm';
    const timeoutMs = Number(rs?.kitchenConnectTimeoutMs ?? profile.kitchenConnectTimeoutMs ?? 3500);
    const dupWindow = Number(rs?.preventDuplicatePrintSeconds ?? 10);
    const jobTarget = options?.targetOverride || 'kitchen';

    const dupCheck = printJobManager.canDispatchJob(order.id, jobTarget, Boolean(options?.isReprint), dupWindow);
    if (!dupCheck.allowed) {
      return {
        success: true,
        target: jobTarget,
        jobId: dupCheck.existingJobId || 'dup-guard',
        printerName: `${targetPrinter} (${kitchenIp}:${kitchenPort})`,
        resolvedPrinter: `${kitchenIp}:${kitchenPort}`,
        protocol,
        bytesSent: 0,
        duplicateBlocked: true,
      };
    }

    return printJobQueue.enqueue('kitchen_lan', async () => {
      const displayPrinter = protocol === 'windows_driver' ? targetPrinter : `${targetPrinter} (${kitchenIp}:${kitchenPort})`;
      const job = printLogger.startJob({
        orderId: order.id,
        orderNumber: order.orderNumber,
        target: jobTarget,
        printerId: displayPrinter,
        printerName: displayPrinter,
        connectionType: protocol === 'windows_driver' ? 'driver' : 'lan',
        protocol,
        isReprint: options?.isReprint,
        retryCount: options?.retryCount,
      });
      printLogger.markStarted(job.jobId);

      try {
        escPosDriver.assertTargetSafe(targetPrinter);
        const kitchenHtml = generateKitchenTicketHTML(order, profile);
        escPosDriver.assertCleanPayload(kitchenHtml, 'Kitchen KOT HTML');

        if (protocol === 'windows_driver') {
          const driverRes = await windowsPrinterDriver.printHtml({
            html: kitchenHtml,
            printerName: targetPrinter,
            paperWidth,
            copies,
            silent: true,
            skipBrowserDialog: options?.skipBrowserDialog,
          });
          if (!driverRes.success) {
            const structured = driverRes.error || classifyUsbError('تعذر طباعة بون المطبخ عبر تعريف Windows', undefined, targetPrinter);
            printLogger.markFailure({
              jobId: job.jobId,
              errorCode: structured.code,
              errorMessage: structured.userMessageAr,
              technicalDetails: structured.technicalDetails,
              isOffline: structured.isOffline,
            });
            return {
              success: false,
              target: jobTarget,
              jobId: job.jobId,
              printerName: displayPrinter,
              protocol,
              bytesSent: 0,
              errorCode: structured.code,
              errorMessage: structured.userMessageAr,
              technicalDetails: structured.technicalDetails,
              suggestedFix: structured.suggestedFixAr,
            };
          }

          printLogger.markSuccess(job.jobId, driverRes.bytesSent, driverRes.resolvedPrinter || targetPrinter);
          return {
            success: true,
            target: jobTarget,
            jobId: job.jobId,
            printerName: displayPrinter,
            resolvedPrinter: driverRes.resolvedPrinter || targetPrinter,
            protocol,
            bytesSent: driverRes.bytesSent,
          };
        }

        let escposBase64: string | undefined;
        let rawText: string | undefined;
        let estimatedByteLength = 0;

        if (protocol === 'escpos_raster') {
          const kotLines = buildKitchenKotRasterLines(order, profile);
          escposBase64 = renderLinesToEscPosGSv0Base64(kotLines, paperWidth);
          const rawBytes = escPosDriver.buildRasterFrame({
            rasterBase64: escposBase64,
            alignment: 'center',
            paperFeedLines: feedLines,
            autoCut,
            buzzer,
            copies,
          });
          estimatedByteLength = rawBytes.length;
        } else {
          rawText = buildKitchenKotPlainText(order);
          const rawBytes = escPosDriver.buildPlainTextFrame({
            text: rawText,
            includeEscPosWrapper: protocol === 'escpos_text',
            paperFeedLines: feedLines,
            autoCut,
            buzzer,
            copies,
          });
          estimatedByteLength = rawBytes.length;
        }

        const tcpRes = await tcpPrinterDriver.sendRawSocket({
          printerName: targetPrinter,
          ip: kitchenIp,
          port: kitchenPort,
          orderNumber: order.orderNumber,
          protocol,
          rasterBase64: escposBase64,
          rawText,
          copies,
          autoCut,
          buzzer,
          paperFeedLines: feedLines,
          paperWidth,
          timeoutMs,
          estimatedByteLength,
        });

        if (!tcpRes.success) {
          const structured = tcpRes.error || classifyLanError('تعذر الاتصال بطابعة المطبخ', undefined, kitchenIp, kitchenPort);
          printLogger.markFailure({
            jobId: job.jobId,
            errorCode: structured.code,
            errorMessage: structured.userMessageAr,
            technicalDetails: structured.technicalDetails,
            isOffline: structured.isOffline,
          });
          return {
            success: false,
            target: jobTarget,
            jobId: job.jobId,
            printerName: displayPrinter,
            protocol,
            bytesSent: 0,
            errorCode: structured.code,
            errorMessage: structured.userMessageAr,
            technicalDetails: structured.technicalDetails,
            suggestedFix: structured.suggestedFixAr,
          };
        }

        printLogger.markSuccess(job.jobId, tcpRes.bytesSent, tcpRes.resolvedPrinter || `${kitchenIp}:${kitchenPort}`);
        return {
          success: true,
          target: jobTarget,
          jobId: job.jobId,
          printerName: displayPrinter,
          resolvedPrinter: tcpRes.resolvedPrinter || `${kitchenIp}:${kitchenPort}`,
          protocol,
          bytesSent: tcpRes.bytesSent,
        };
      } catch (err: any) {
        const structured = classifyLanError(err?.message || String(err), undefined, kitchenIp, kitchenPort, String(err?.stack || ''));
        printLogger.markFailure({
          jobId: job.jobId,
          errorCode: structured.code,
          errorMessage: structured.userMessageAr,
          technicalDetails: structured.technicalDetails,
          isOffline: structured.isOffline,
        });
        return {
          success: false,
          target: jobTarget,
          jobId: job.jobId,
          printerName: displayPrinter,
          protocol,
          bytesSent: 0,
          errorCode: structured.code,
          errorMessage: structured.userMessageAr,
          technicalDetails: structured.technicalDetails,
          suggestedFix: structured.suggestedFixAr,
        };
      }
    });
  }
}

export const kitchenPrinterAdapter = new KitchenPrinterAdapter();
