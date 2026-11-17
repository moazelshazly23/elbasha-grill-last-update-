import { Order, RestaurantProfile } from '../../types';
import { PrintingMode } from '../../utils/printingProtocols';
import { classifyUsbError } from '../core/PrintErrorHandler';
import { printJobQueue } from '../core/PrintJobQueue';
import { printLogger } from '../core/PrintLogger';
import { printJobManager } from '../../services/printJobManager';
import { escPosDriver } from '../drivers/EscPosDriver';
import { windowsRawSpooler } from '../drivers/WindowsRawSpooler';
import { windowsPrinterDriver } from '../drivers/WindowsPrinterDriver';
import {
  ditherImageToMonochromeDataUrl,
  generateReceiptQRCode,
  generateThermalReceiptHTML,
  RasterLineSpec,
  renderFullReceiptToEscPosGSv0Base64,
  renderLinesToEscPosGSv0Base64,
} from '../templates/ReceiptTemplate';

export interface PrinterExecutionResult {
  success: boolean;
  target: 'cashier' | 'kitchen' | 'test';
  jobId: string;
  printerName: string;
  resolvedPrinter?: string;
  protocol: string;
  bytesSent: number;
  errorCode?: string;
  errorMessage?: string;
  technicalDetails?: string;
  suggestedFix?: string;
  driverName?: string;
  portName?: string;
  printerStatus?: string;
  spoolerStatus?: string;
  duplicateBlocked?: boolean;
}

export class CashierPrinterAdapter {
  public async printCustomerReceipt(
    order: Order,
    profile: RestaurantProfile,
    options?: { skipBrowserDialog?: boolean; isReprint?: boolean; targetOverride?: 'cashier' | 'test'; retryCount?: number }
  ): Promise<PrinterExecutionResult> {
    const rs = profile.receiptSettings;
    const targetPrinter =
      rs?.cashierPrinterUsbName || profile.receiptPrinterName || 'Rongta RP350 (Cashier - USB)';
    const mode: PrintingMode = rs?.printingMode || profile.printingMode || 'escpos_raw';
    const paperWidth = (rs?.paperWidth || profile.thermalPaperWidth) === '58mm' ? '58mm' : '80mm';
    const copies = Math.max(1, Math.min(5, Number(rs?.cashierCopies ?? profile.cashierCopies ?? 1)));
    const autoCut = (rs?.cashierAutoCut ?? profile.cashierAutoCut) !== false;
    const feedLines = Math.max(0, Math.min(10, Number(rs?.paperFeedLines ?? 4)));
    const jobTarget = options?.targetOverride || 'cashier';
    const dupWindow = Number(rs?.preventDuplicatePrintSeconds ?? 10);

    const dupCheck = printJobManager.canDispatchJob(order.id, jobTarget, Boolean(options?.isReprint), dupWindow);
    if (!dupCheck.allowed) {
      return {
        success: true,
        target: jobTarget,
        jobId: dupCheck.existingJobId || 'dup-guard',
        printerName: targetPrinter,
        resolvedPrinter: targetPrinter,
        protocol: mode,
        bytesSent: 0,
        duplicateBlocked: true,
      };
    }

    return printJobQueue.enqueue('cashier_usb', async () => {
      const job = printLogger.startJob({
        orderId: order.id,
        orderNumber: order.orderNumber,
        target: jobTarget,
        printerId: targetPrinter,
        printerName: targetPrinter,
        connectionType: mode === 'escpos_raw' ? 'usb' : 'driver',
        protocol: mode,
        isReprint: options?.isReprint,
        retryCount: options?.retryCount,
      });
      printLogger.markStarted(job.jobId);

      try {
        escPosDriver.assertCashierModeAllowed(mode);
        escPosDriver.assertTargetSafe(targetPrinter);

        const qrDataUrl = await generateReceiptQRCode(order, profile);
        const receiptHtml = generateThermalReceiptHTML(order, profile, qrDataUrl);
        escPosDriver.assertCleanPayload(receiptHtml, 'Receipt HTML Template');

        if (typeof document !== 'undefined') {
          let printArea = document.getElementById('thermal-receipt-print-area');
          if (!printArea) {
            printArea = document.createElement('div');
            printArea.id = 'thermal-receipt-print-area';
            printArea.className = 'thermal-print-container';
            document.body.appendChild(printArea);
          } else if (printArea.classList.contains('hidden')) {
            printArea.classList.remove('hidden', 'print:block');
            printArea.classList.add('thermal-print-container');
          }
          printArea.innerHTML = receiptHtml;
        }

        if (mode === 'escpos_raw') {
          const rasterEscPosBase64 = await renderFullReceiptToEscPosGSv0Base64(order, profile, qrDataUrl);
          const rawBytes = escPosDriver.buildRasterFrame({
            rasterBase64: rasterEscPosBase64,
            alignment: 'center',
            paperFeedLines: feedLines,
            autoCut,
            buzzer: false,
            copies,
          });

          const transportRes = await windowsRawSpooler.sendRawEscPos({
            printerName: targetPrinter,
            orderNumber: order.orderNumber,
            rasterBase64: rasterEscPosBase64,
            paperWidth,
            copies,
            autoCut,
            paperFeedLines: feedLines,
            estimatedByteLength: rawBytes.length,
          });

          if (!transportRes.success) {
            const structured = transportRes.error || classifyUsbError('فشل إرسال البيانات لطابعة الكاشير', undefined, targetPrinter);
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
              printerName: targetPrinter,
              resolvedPrinter: transportRes.resolvedPrinter,
              driverName: transportRes.driverName,
              portName: transportRes.portName,
              printerStatus: transportRes.printerStatus,
              spoolerStatus: transportRes.spoolerStatus,
              protocol: mode,
              bytesSent: 0,
              errorCode: structured.code,
              errorMessage: structured.userMessageAr,
              technicalDetails: structured.technicalDetails,
              suggestedFix: structured.suggestedFixAr,
            };
          }

          printLogger.markSuccess(job.jobId, transportRes.bytesSent, transportRes.resolvedPrinter || targetPrinter);
          return {
            success: true,
            target: jobTarget,
            jobId: job.jobId,
            printerName: targetPrinter,
            resolvedPrinter: transportRes.resolvedPrinter || targetPrinter,
            driverName: transportRes.driverName,
            portName: transportRes.portName,
            printerStatus: transportRes.printerStatus,
            spoolerStatus: transportRes.spoolerStatus,
            protocol: mode,
            bytesSent: transportRes.bytesSent,
          };
        }

        const driverRes = await windowsPrinterDriver.printHtml({
          html: receiptHtml,
          printerName: targetPrinter,
          paperWidth,
          copies,
          silent: true,
          skipBrowserDialog: options?.skipBrowserDialog,
          margins: {
            top: rs?.marginTopMm ?? 2,
            bottom: rs?.marginBottomMm ?? 2,
            left: rs?.marginLeftMm ?? 2,
            right: rs?.marginRightMm ?? 2,
          },
        });

        if (!driverRes.success) {
          const structured = driverRes.error || classifyUsbError('تعذر الطباعة عبر تعريف Windows', undefined, targetPrinter);
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
            printerName: targetPrinter,
            protocol: mode,
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
          printerName: targetPrinter,
          resolvedPrinter: driverRes.resolvedPrinter || targetPrinter,
          protocol: mode,
          bytesSent: driverRes.bytesSent,
        };
      } catch (err: any) {
        const structured = classifyUsbError(err?.message || String(err), undefined, targetPrinter, String(err?.stack || ''));
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
          printerName: targetPrinter,
          protocol: mode,
          bytesSent: 0,
          errorCode: structured.code,
          errorMessage: structured.userMessageAr,
          technicalDetails: structured.technicalDetails,
          suggestedFix: structured.suggestedFixAr,
        };
      }
    });
  }

  public async printCustomLines(
    orderNumber: string,
    lines: RasterLineSpec[],
    fallbackHtml: string,
    profile: RestaurantProfile
  ): Promise<PrinterExecutionResult> {
    const rs = profile.receiptSettings;
    const targetPrinter = rs?.cashierPrinterUsbName || profile.receiptPrinterName || 'Rongta RP350 (Cashier - USB)';
    const paperWidth = (rs?.paperWidth || profile.thermalPaperWidth) === '58mm' ? '58mm' : '80mm';
    const mode: PrintingMode = rs?.printingMode || profile.printingMode || 'escpos_raw';

    return printJobQueue.enqueue('cashier_usb', async () => {
      const job = printLogger.startJob({
        orderId: `diag-${Date.now()}`,
        orderNumber,
        target: 'test',
        printerId: targetPrinter,
        printerName: targetPrinter,
        connectionType: mode === 'escpos_raw' ? 'usb' : 'driver',
        protocol: mode,
        isReprint: true,
      });
      printLogger.markStarted(job.jobId);

      try {
        if (mode === 'escpos_raw') {
          const rasterBase64 = renderLinesToEscPosGSv0Base64(lines, paperWidth);
          const rawBytes = escPosDriver.buildRasterFrame({
            rasterBase64,
            paperFeedLines: rs?.paperFeedLines ?? 4,
            autoCut: (rs?.cashierAutoCut ?? profile.cashierAutoCut) !== false,
            copies: 1,
          });
          const res = await windowsRawSpooler.sendRawEscPos({
            printerName: targetPrinter,
            orderNumber,
            rasterBase64,
            paperWidth,
            copies: 1,
            autoCut: (rs?.cashierAutoCut ?? profile.cashierAutoCut) !== false,
            paperFeedLines: rs?.paperFeedLines ?? 4,
            estimatedByteLength: rawBytes.length,
          });

          if (!res.success) {
            const structured = res.error || classifyUsbError('فشل الطباعة الاختبارية', undefined, targetPrinter);
            printLogger.markFailure({
              jobId: job.jobId,
              errorCode: structured.code,
              errorMessage: structured.userMessageAr,
              technicalDetails: structured.technicalDetails,
              isOffline: structured.isOffline,
            });
            return {
              success: false,
              target: 'test',
              jobId: job.jobId,
              printerName: targetPrinter,
              protocol: mode,
              bytesSent: 0,
              errorCode: structured.code,
              errorMessage: structured.userMessageAr,
              technicalDetails: structured.technicalDetails,
              suggestedFix: structured.suggestedFixAr,
            };
          }

          printLogger.markSuccess(job.jobId, res.bytesSent, res.resolvedPrinter || targetPrinter);
          return {
            success: true,
            target: 'test',
            jobId: job.jobId,
            printerName: targetPrinter,
            resolvedPrinter: res.resolvedPrinter || targetPrinter,
            protocol: mode,
            bytesSent: res.bytesSent,
          };
        }

        const driverRes = await windowsPrinterDriver.printHtml({
          html: fallbackHtml,
          printerName: targetPrinter,
          paperWidth,
          copies: 1,
          silent: false,
        });
        if (!driverRes.success) {
          const structured = driverRes.error || classifyUsbError('فشل الطباعة عبر التعريف', undefined, targetPrinter);
          printLogger.markFailure({
            jobId: job.jobId,
            errorCode: structured.code,
            errorMessage: structured.userMessageAr,
            technicalDetails: structured.technicalDetails,
            isOffline: structured.isOffline,
          });
          return {
            success: false,
            target: 'test',
            jobId: job.jobId,
            printerName: targetPrinter,
            protocol: mode,
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
          target: 'test',
          jobId: job.jobId,
          printerName: targetPrinter,
          resolvedPrinter: driverRes.resolvedPrinter || targetPrinter,
          protocol: mode,
          bytesSent: driverRes.bytesSent,
        };
      } catch (err: any) {
        const structured = classifyUsbError(err?.message || String(err), undefined, targetPrinter);
        printLogger.markFailure({
          jobId: job.jobId,
          errorCode: structured.code,
          errorMessage: structured.userMessageAr,
          technicalDetails: structured.technicalDetails,
          isOffline: structured.isOffline,
        });
        return {
          success: false,
          target: 'test',
          jobId: job.jobId,
          printerName: targetPrinter,
          protocol: mode,
          bytesSent: 0,
          errorCode: structured.code,
          errorMessage: structured.userMessageAr,
          technicalDetails: structured.technicalDetails,
          suggestedFix: structured.suggestedFixAr,
        };
      }
    });
  }

  public async printLogoTest(profile: RestaurantProfile): Promise<PrinterExecutionResult> {
    const rs = profile.receiptSettings;
    const targetPrinter = rs?.cashierPrinterUsbName || profile.receiptPrinterName || 'Rongta RP350 (Cashier - USB)';
    const paperWidth = (rs?.paperWidth || profile.thermalPaperWidth) === '58mm' ? '58mm' : '80mm';
    const mode: PrintingMode = rs?.printingMode || profile.printingMode || 'escpos_raw';

    if (mode === 'windows_driver') {
      const monoLogo = profile.logoUrl ? await ditherImageToMonochromeDataUrl(profile.logoUrl, 220) : '';
      const html = `<div style="font-family: 'Cairo', sans-serif; direction: rtl; text-align: center; padding: 10px; width: ${
        paperWidth === '58mm' ? '54mm' : '76mm'
      }; color: #000;">
        <div style="font-weight:900; font-size:14px; margin-bottom:6px;">اختبار طباعة الشعار (1-bit Monochrome)</div>
        ${
          monoLogo
            ? `<img src="${monoLogo}" style="max-width:${rs?.logoWidth || 120}px; margin:0 auto; display:block;" />`
            : '<div style="font-size:12px;">لا يوجد شعار مرفوع حالياً</div>'
        }
        <div style="font-weight:900; font-size:15px; margin-top:6px;">${rs?.restaurantNameArabic || profile.name}</div>
        <div style="font-size:11px;">${rs?.sloganArabic || profile.slogan || 'مشويات الباشا ... انت الباشا'}</div>
      </div>`;
      return this.printCustomLines('TEST-LOGO', [], html, profile);
    }

    const { createSampleTestOrder } = await import('../templates/ReceiptTemplate');
    const sampleOrder = createSampleTestOrder();
    sampleOrder.orderNumber = 'TEST-LOGO';
    sampleOrder.items = sampleOrder.items.slice(0, 1);
    return this.printCustomerReceipt(sampleOrder, profile, {
      isReprint: true,
      targetOverride: 'test',
    });
  }
}

export const cashierPrinterAdapter = new CashierPrinterAdapter();
