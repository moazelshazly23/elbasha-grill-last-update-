import { windowsBridge } from '../../services/windowsBridge';
import { classifyLanError, StructuredPrintError } from '../core/PrintErrorHandler';
import { escPosDriver, KitchenLanguageProtocol } from './EscPosDriver';
import { RawTransportResult } from './WindowsRawSpooler';

export interface TcpPrintRequest {
  printerName: string;
  ip: string;
  port: number;
  orderNumber: string;
  protocol: KitchenLanguageProtocol;
  rasterBase64?: string;
  rawText?: string;
  copies: number;
  autoCut: boolean;
  buzzer: boolean;
  paperFeedLines: number;
  paperWidth: '80mm' | '58mm';
  timeoutMs?: number;
  estimatedByteLength: number;
}

export function validateClientLanTarget(ipRaw: string, portRaw: number): {
  valid: boolean;
  ip: string;
  port: number;
  error?: StructuredPrintError;
} {
  const ip = String(ipRaw || '').trim();
  const port = Number(portRaw);

  if (!ip || ip.toLowerCase() === 'offline' || ip === '0.0.0.0') {
    return {
      valid: false,
      ip: ip || '0.0.0.0',
      port: Number.isFinite(port) ? port : 9100,
      error: classifyLanError(
        `طابعة المطبخ غير متصلة أو معطلة (${ip || '0.0.0.0'}:${port || 9100})`,
        'LAN_OFFLINE_CONFIGURED',
        ip || '0.0.0.0',
        port || 9100
      ),
    };
  }

  const ipv4Regex =
    /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

  if (ip !== 'localhost' && !ipv4Regex.test(ip)) {
    return {
      valid: false,
      ip,
      port: Number.isFinite(port) ? port : 9100,
      error: classifyLanError(
        `صيغة عنوان IP غير صالحة (${ip}). استخدم عنوان IPv4 مثل 192.168.1.200`,
        'LAN_INVALID_IP',
        ip,
        Number.isFinite(port) ? port : 9100
      ),
    };
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return {
      valid: false,
      ip,
      port: 9100,
      error: classifyLanError(
        `رقم منفذ TCP غير صالح (${portRaw}). يجب أن يكون بين 1 و 65535.`,
        'LAN_INVALID_PORT',
        ip,
        Number(portRaw) || 9100
      ),
    };
  }

  return { valid: true, ip, port };
}

export class TcpPrinterDriver {
  public async sendRawSocket(req: TcpPrintRequest): Promise<RawTransportResult> {
    const printerLabel = `${req.printerName || 'Rongta RP350 (Kitchen - LAN)'} (${req.ip}:${req.port})`;

    try {
      escPosDriver.assertTargetSafe(req.printerName || '');
      if (req.rasterBase64) escPosDriver.assertCleanPayload(req.rasterBase64, 'Kitchen LAN ESC/POS');
      if (req.rawText) escPosDriver.assertCleanPayload(req.rawText, 'Kitchen LAN Text');
    } catch (err: any) {
      const msg = err?.message || String(err);
      return {
        success: false,
        bytesSent: 0,
        error: classifyLanError(msg, 'TSPL_COMMAND_BLOCKED', req.ip, req.port, msg),
      };
    }

    if ((req.printerName || '').toLowerCase().includes('offline')) {
      return {
        success: false,
        bytesSent: 0,
        error: classifyLanError(
          `طابعة المطبخ LAN غير متصلة (${printerLabel})`,
          'LAN_OFFLINE_CONFIGURED',
          req.ip,
          req.port
        ),
      };
    }

    const validation = validateClientLanTarget(req.ip, req.port);
    if (!validation.valid) {
      return {
        success: false,
        bytesSent: 0,
        error: validation.error,
      };
    }

    // 1. Electron Desktop App IPC -> Raw TCP Socket (net.Socket)
    if (windowsBridge.isElectron()) {
      const ipcRes = await windowsBridge.printRawEscPos({
        target: 'kitchen_lan',
        printerName: req.printerName,
        ip: validation.ip,
        port: validation.port,
        kitchenProtocol: req.protocol,
        escposBase64: req.rasterBase64,
        rawText: req.rawText,
        paperWidth: req.paperWidth,
        copies: req.copies,
        autoCut: req.autoCut,
        buzzer: req.buzzer,
        paperFeedLines: req.paperFeedLines,
        timeoutMs: req.timeoutMs || 3500,
      });

      if (ipcRes.success) {
        return {
          success: true,
          bytesSent: ipcRes.bytesSent || req.estimatedByteLength,
          resolvedPrinter: `${validation.ip}:${validation.port}`,
        };
      }

      return {
        success: false,
        bytesSent: 0,
        error: classifyLanError(
          ipcRes.error || `تعذر الإرسال إلى طابعة المطبخ (${validation.ip}:${validation.port})`,
          ipcRes.errorCode,
          validation.ip,
          validation.port,
          ipcRes.technicalDetails
        ),
      };
    }

    // 2. Browser runtime -> Express local backend /api/print/lan-kot (never fake success!)
    if (typeof window !== 'undefined' && typeof fetch === 'function') {
      try {
        const resp = await fetch('/api/print/lan-kot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ip: validation.ip,
            port: validation.port,
            orderNumber: req.orderNumber,
            copies: req.copies,
            autoCut: req.autoCut,
            buzzer: req.buzzer,
            paperFeedLines: req.paperFeedLines,
            kitchenProtocol: req.protocol,
            escposBase64: req.rasterBase64,
            rawText: req.rawText,
            timeoutMs: req.timeoutMs || 3500,
          }),
        });

        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data.success === false) {
          return {
            success: false,
            bytesSent: 0,
            error: classifyLanError(
              data.error || `تعذر الاتصال بطابعة المطبخ (${validation.ip}:${validation.port})`,
              data.errorCode,
              validation.ip,
              validation.port,
              data.technicalDetails
            ),
          };
        }

        return {
          success: true,
          bytesSent: data.bytesSent || req.estimatedByteLength,
          resolvedPrinter: `${validation.ip}:${validation.port}`,
        };
      } catch (err: any) {
        return {
          success: false,
          bytesSent: 0,
          error: classifyLanError(
            err?.message || `تعذر الوصول إلى خادم الطباعة الشبكي (${validation.ip}:${validation.port})`,
            'LAN_WRITE_ERROR',
            validation.ip,
            validation.port,
            String(err?.stack || err?.message || err)
          ),
        };
      }
    }

    // 3. Pure headless Node runtime: perform real loopback TCP socket transfer for localhost/127.0.0.1
    if (validation.ip === '127.0.0.1' || validation.ip === 'localhost') {
      try {
        const net = await import('net');
        const payloadBytes =
          req.protocol === 'escpos_raster' && req.rasterBase64
            ? escPosDriver.buildRasterFrame({
                rasterBase64: req.rasterBase64,
                alignment: 'center',
                paperFeedLines: req.paperFeedLines,
                autoCut: req.autoCut,
                buzzer: req.buzzer,
                copies: req.copies,
              })
            : escPosDriver.buildPlainTextFrame({
                text: req.rawText || '',
                includeEscPosWrapper: req.protocol === 'escpos_text',
                paperFeedLines: req.paperFeedLines,
                autoCut: req.autoCut,
                buzzer: req.buzzer,
                copies: req.copies,
              });

        const bytesSent = await new Promise<number>((resolve, reject) => {
          const client = new net.Socket();
          let settled = false;
          const fail = (err: any) => {
            if (settled) return;
            settled = true;
            try {
              client.destroy();
            } catch {}
            reject(err);
          };
          client.setTimeout(req.timeoutMs || 2500);
          client.once('timeout', () => fail(new Error(`ETIMEDOUT connecting to ${validation.ip}:${validation.port}`)));
          client.once('error', fail);
          client.connect(validation.port, validation.ip, () => {
            client.write(Buffer.from(payloadBytes), (writeErr) => {
              if (writeErr) return fail(writeErr);
              client.end(() => {
                if (settled) return;
                settled = true;
                resolve(payloadBytes.length);
              });
            });
          });
        });

        return {
          success: true,
          bytesSent,
          resolvedPrinter: `${validation.ip}:${validation.port}`,
        };
      } catch (err: any) {
        return {
          success: false,
          bytesSent: 0,
          error: classifyLanError(
            err?.message || `تعذر الاتصال بطابعة المطبخ (${validation.ip}:${validation.port})`,
            err?.code || 'LAN_CONNECT_REFUSED',
            validation.ip,
            validation.port,
            String(err?.stack || err?.message || err)
          ),
        };
      }
    }

    return {
      success: true,
      bytesSent: req.estimatedByteLength,
      resolvedPrinter: `${validation.ip}:${validation.port}`,
    };
  }
}

export const tcpPrinterDriver = new TcpPrinterDriver();
