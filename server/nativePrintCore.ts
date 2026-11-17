import net from 'net';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';

export interface LanEndpointValidation {
  valid: boolean;
  ip: string;
  port: number;
  errorCode?: string;
  error?: string;
}

export interface TcpSendResult {
  ok: boolean;
  bytesSent: number;
  latencyMs: number;
  errorCode?: string;
  error?: string;
  technicalDetails?: string;
}

export interface TcpProbeResult {
  reachable: boolean;
  latencyMs: number;
  errorCode?: string;
  error?: string;
  technicalDetails?: string;
}

export interface Win32SpoolerResult {
  ok: boolean;
  errorCode?: string;
  error?: string;
  technicalDetails?: string;
  stage?: string;
  win32Error?: number;
  resolvedPrinter?: string;
  driverName?: string;
  portName?: string;
  printerStatus?: string;
  workOffline?: boolean;
  spoolerStatus?: string;
  bytesSent?: number;
  installedPrinters?: string[];
}

const IPV4_REGEX =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export function validateLanEndpoint(rawIp: string, rawPort: number | string): LanEndpointValidation {
  const ip = String(rawIp || '').trim();
  const port = Number(rawPort);

  if (!ip || ip.toLowerCase() === 'offline' || ip === '0.0.0.0') {
    return {
      valid: false,
      ip,
      port: Number.isFinite(port) ? port : 9100,
      errorCode: ip.toLowerCase() === 'offline' || ip === '0.0.0.0' ? 'LAN_OFFLINE_CONFIGURED' : 'LAN_INVALID_IP',
      error:
        ip.toLowerCase() === 'offline' || ip === '0.0.0.0'
          ? `طابعة المطبخ LAN مهيأة حالياً كغير متصلة (${ip}).`
          : 'عنوان IP لطابعة المطبخ غير صالح أو فارغ.',
    };
  }

  const isLocalHost = ip.toLowerCase() === 'localhost' || ip === '::1';
  if (!isLocalHost && !IPV4_REGEX.test(ip)) {
    return {
      valid: false,
      ip,
      port: Number.isFinite(port) ? port : 9100,
      errorCode: 'LAN_INVALID_IP',
      error: `صيغة عنوان IP غير صحيحة: "${ip}". الصيغة المطلوبة مثل 192.168.1.200`,
    };
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return {
      valid: false,
      ip,
      port,
      errorCode: 'LAN_INVALID_PORT',
      error: `رقم المنفذ TCP غير صالح: "${rawPort}". يجب أن يكون بين 1 و 65535 (الافتراضي 9100).`,
    };
  }

  return { valid: true, ip, port };
}

export function classifySocketError(
  err: any,
  ip: string,
  port: number
): { errorCode: string; error: string; technicalDetails: string } {
  const sysCode = String(err?.code || '').toUpperCase();
  const rawMsg = String(err?.message || err || 'Unknown socket error');

  if (sysCode === 'ETIMEDOUT' || rawMsg.toLowerCase().includes('timeout')) {
    return {
      errorCode: 'LAN_TIMEOUT',
      error: `انتهت مهلة الاتصال بطابعة المطبخ (${ip}:${port}). تأكد من تشغيل الطابعة واتصالها بنفس الشبكة الفرعية.`,
      technicalDetails: `TCP timeout on ${ip}:${port} (${rawMsg})`,
    };
  }
  if (sysCode === 'ECONNREFUSED') {
    return {
      errorCode: 'LAN_CONNECTION_REFUSED',
      error: `طابعة المطبخ (${ip}:${port}) رفضت الاتصال بالمنفذ ${port}. تأكد من تفعيل Raw TCP Port ${port} وعدم حظره بجدار الحماية.`,
      technicalDetails: `ECONNREFUSED on ${ip}:${port} (${rawMsg})`,
    };
  }
  if (sysCode === 'EHOSTUNREACH' || sysCode === 'ENETUNREACH') {
    return {
      errorCode: 'LAN_NETWORK_UNREACHABLE',
      error: `الشبكة أو المضيف (${ip}) غير قابل للوصول من هذا الجهاز (${sysCode}). راجع كابل الإيثرنت أو إعدادات Subnet/Gateway.`,
      technicalDetails: `${sysCode} targeting ${ip}:${port} (${rawMsg})`,
    };
  }
  if (sysCode === 'ECONNRESET' || sysCode === 'EPIPE' || sysCode === 'ERR_STREAM_WRITE_AFTER_END') {
    return {
      errorCode: 'LAN_DISCONNECTED',
      error: `انقطع الاتصال بطابعة المطبخ (${ip}:${port}) أثناء إرسال البيانات (${sysCode}).`,
      technicalDetails: `${sysCode} during write to ${ip}:${port} (${rawMsg})`,
    };
  }
  if (sysCode === 'EINVAL' || sysCode === 'ENOTFOUND' || sysCode === 'EAI_AGAIN') {
    return {
      errorCode: 'LAN_INVALID_IP',
      error: `عنوان الشبكة غير صالح أو غير قابل للحل (${ip}:${port}).`,
      technicalDetails: `${sysCode}: ${rawMsg}`,
    };
  }

  return {
    errorCode: 'LAN_WRITE_ERROR',
    error: `فشل إرسال البيانات عبر الشبكة إلى ${ip}:${port}: ${rawMsg}`,
    technicalDetails: `${sysCode || 'TCP_ERR'}: ${rawMsg}`,
  };
}

function sendRawTcpOnce(
  ip: string,
  port: number,
  payload: Buffer,
  connectTimeoutMs: number,
  writeTimeoutMs: number
): Promise<TcpSendResult> {
  return new Promise((resolve) => {
    const startAt = Date.now();
    const socket = new net.Socket();
    let settled = false;
    let connected = false;

    const cleanup = () => {
      socket.removeAllListeners();
      if (!socket.destroyed) {
        socket.destroy();
      }
    };

    const finishSuccess = () => {
      if (settled) return;
      settled = true;
      const latencyMs = Date.now() - startAt;
      cleanup();
      resolve({
        ok: true,
        bytesSent: payload.length,
        latencyMs,
      });
    };

    const finishError = (err: any) => {
      if (settled) return;
      settled = true;
      const latencyMs = Date.now() - startAt;
      cleanup();
      const classified = classifySocketError(err, ip, port);
      resolve({
        ok: false,
        bytesSent: 0,
        latencyMs,
        errorCode: classified.errorCode,
        error: classified.error,
        technicalDetails: classified.technicalDetails,
      });
    };

    socket.setTimeout(connectTimeoutMs);

    socket.on('timeout', () => {
      const stage = connected ? 'write' : 'connect';
      finishError(
        Object.assign(new Error(`TCP ${stage} timeout after ${connected ? writeTimeoutMs : connectTimeoutMs}ms`), {
          code: 'ETIMEDOUT',
        })
      );
    });

    socket.on('error', (err) => {
      finishError(err);
    });

    socket.connect(port, ip, () => {
      connected = true;
      socket.setTimeout(writeTimeoutMs);
      socket.write(payload, (writeErr) => {
        if (writeErr) {
          finishError(writeErr);
          return;
        }
        socket.end(() => {
          finishSuccess();
        });
      });
    });
  });
}

export async function sendRawTcpSocket(
  rawIp: string,
  rawPort: number,
  payload: Buffer,
  options?: {
    connectTimeoutMs?: number;
    writeTimeoutMs?: number;
    retries?: number;
    retryDelayMs?: number;
  }
): Promise<TcpSendResult> {
  const validation = validateLanEndpoint(rawIp, rawPort);
  if (!validation.valid) {
    return {
      ok: false,
      bytesSent: 0,
      latencyMs: 0,
      errorCode: validation.errorCode,
      error: validation.error,
      technicalDetails: `Endpoint validation failed for "${rawIp}:${rawPort}"`,
    };
  }

  const connectTimeoutMs = Math.max(300, Math.min(15000, options?.connectTimeoutMs ?? 3000));
  const writeTimeoutMs = Math.max(500, Math.min(20000, options?.writeTimeoutMs ?? 4500));
  const maxRetries = Math.max(0, Math.min(3, options?.retries ?? 1));
  const retryDelayMs = Math.max(50, Math.min(2000, options?.retryDelayMs ?? 250));

  let lastResult: TcpSendResult = {
    ok: false,
    bytesSent: 0,
    latencyMs: 0,
    errorCode: 'LAN_WRITE_ERROR',
    error: 'لم يبدأ الإرسال الشبكي.',
  };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    lastResult = await sendRawTcpOnce(
      validation.ip,
      validation.port,
      payload,
      connectTimeoutMs,
      writeTimeoutMs
    );
    if (lastResult.ok) {
      return lastResult;
    }

    const transient =
      lastResult.errorCode === 'LAN_TIMEOUT' || lastResult.errorCode === 'LAN_DISCONNECTED';
    if (!transient || attempt >= maxRetries) {
      break;
    }
    await new Promise((r) => setTimeout(r, retryDelayMs * (attempt + 1)));
  }

  return lastResult;
}

export async function testTcpEndpoint(
  rawIp: string,
  rawPort: number,
  timeoutMs = 2500
): Promise<TcpProbeResult> {
  const validation = validateLanEndpoint(rawIp, rawPort);
  if (!validation.valid) {
    return {
      reachable: false,
      latencyMs: 0,
      errorCode: validation.errorCode,
      error: validation.error,
      technicalDetails: `Endpoint validation failed for "${rawIp}:${rawPort}"`,
    };
  }

  return new Promise((resolve) => {
    const startAt = Date.now();
    const socket = new net.Socket();
    let settled = false;

    const cleanup = () => {
      socket.removeAllListeners();
      if (!socket.destroyed) socket.destroy();
    };

    const done = (reachable: boolean, err?: any) => {
      if (settled) return;
      settled = true;
      const latencyMs = Date.now() - startAt;
      cleanup();
      if (reachable) {
        resolve({
          reachable: true,
          latencyMs,
        });
      } else {
        const classified = classifySocketError(err, validation.ip, validation.port);
        resolve({
          reachable: false,
          latencyMs,
          errorCode: classified.errorCode,
          error: classified.error,
          technicalDetails: classified.technicalDetails,
        });
      }
    };

    socket.setTimeout(Math.max(300, Math.min(10000, timeoutMs)));
    socket.on('timeout', () => {
      done(false, Object.assign(new Error(`TCP probe timeout after ${timeoutMs}ms`), { code: 'ETIMEDOUT' }));
    });
    socket.on('error', (err) => done(false, err));
    socket.connect(validation.port, validation.ip, () => {
      done(true);
    });
  });
}

export function resolveSpoolerScript(extraCandidates: string[] = []): string | null {
  const candidates = [
    ...extraCandidates,
    path.resolve(process.cwd(), 'server', 'rawPrintSpooler.ps1'),
    path.resolve((process as any).resourcesPath || '', 'server', 'rawPrintSpooler.ps1'),
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

export function runWindowsSpoolerAction(params: {
  printerName: string;
  payload?: Buffer;
  diagnoseOnly?: boolean;
  extraScriptCandidates?: string[];
  timeoutMs?: number;
}): Promise<Win32SpoolerResult> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve({
        ok: false,
        errorCode: 'USB_HOST_NOT_WINDOWS',
        error: 'طباعة USB المباشرة عبر Win32 Spooler (winspool.drv) تتطلب تشغيل النظام على Windows.',
        technicalDetails: `Current Node platform is "${process.platform}" (not win32).`,
        spoolerStatus: 'NotWindows',
      });
      return;
    }

    const scriptPath = resolveSpoolerScript(params.extraScriptCandidates || []);
    if (!scriptPath) {
      resolve({
        ok: false,
        errorCode: 'USB_SPOOLER_UNAVAILABLE',
        error: 'ملف أداة الطباعة المباشرة server/rawPrintSpooler.ps1 غير موجود في حزمة التطبيق.',
        technicalDetails: 'rawPrintSpooler.ps1 not found in expected paths.',
      });
      return;
    }

    let tempFile = '';
    if (!params.diagnoseOnly) {
      if (!params.payload || params.payload.length === 0) {
        resolve({
          ok: false,
          errorCode: 'USB_WRITE_FAILED',
          error: 'بيانات الطباعة المرسلة إلى طابعة الكاشير فارغة.',
          technicalDetails: 'Empty ESC/POS payload buffer.',
        });
        return;
      }
      tempFile = path.join(
        os.tmpdir(),
        `basha_escpos_${Date.now()}_${Math.floor(Math.random() * 100000)}.bin`
      );
      try {
        fs.writeFileSync(tempFile, params.payload);
      } catch (e: any) {
        resolve({
          ok: false,
          errorCode: 'USB_WRITE_FAILED',
          error: `تعذر كتابة ملف Spooler المؤقت: ${e?.message || 'Unknown error'}`,
          technicalDetails: String(e?.stack || e?.message || e),
        });
        return;
      }
    }

    const psArgs = [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-PrinterName',
      params.printerName || 'Rongta RP350 (Cashier - USB)',
    ];
    if (params.diagnoseOnly) {
      psArgs.push('-DiagnoseOnly');
    } else {
      psArgs.push('-FilePath', tempFile);
    }

    execFile(
      'powershell.exe',
      psArgs,
      { timeout: params.timeoutMs ?? 15000 },
      (err, stdout, stderr) => {
        if (tempFile) {
          try {
            if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
          } catch {
            // ignore cleanup failure
          }
        }

        const outText = String(stdout || '');
        const jsonLine = outText
          .split(/\r?\n/)
          .find((l) => l.startsWith('WIN32_RESULT_JSON:'));

        if (jsonLine) {
          try {
            const parsed = JSON.parse(jsonLine.slice('WIN32_RESULT_JSON:'.length));
            resolve({
              ok: Boolean(parsed.ok),
              errorCode: parsed.errorCode || undefined,
              error: parsed.error || undefined,
              technicalDetails: parsed.stage
                ? `Stage=${parsed.stage}, Win32=${parsed.win32Error || 0}, Port=${parsed.portName || 'N/A'}, Status=${parsed.printerStatus || 'N/A'}`
                : undefined,
              stage: parsed.stage,
              win32Error: parsed.win32Error,
              resolvedPrinter: parsed.resolvedPrinter,
              driverName: parsed.driverName,
              portName: parsed.portName,
              printerStatus: parsed.printerStatus,
              workOffline: Boolean(parsed.workOffline),
              spoolerStatus: parsed.spoolerStatus,
              bytesSent: Number(parsed.bytesSent || 0),
              installedPrinters: Array.isArray(parsed.installedPrinters) ? parsed.installedPrinters : [],
            });
            return;
          } catch {
            // fall through to legacy parsing
          }
        }

        if (!err && outText.includes('RAW_PRINT_OK')) {
          const parts = outText.trim().split(':');
          resolve({
            ok: true,
            resolvedPrinter: parts[1] || params.printerName,
            bytesSent: Number(parts[2] || params.payload?.length || 0),
          });
          return;
        }

        const rawErr = (stderr || err?.message || 'Windows Win32 spooler failed').trim();
        resolve({
          ok: false,
          errorCode: rawErr.includes('PRINTER_NOT_FOUND')
            ? 'USB_PRINTER_NOT_FOUND'
            : rawErr.includes('BLOCKED_TSPL')
            ? 'TSPL_COMMAND_BLOCKED'
            : 'USB_WRITE_FAILED',
          error: rawErr,
          technicalDetails: rawErr,
        });
      }
    );
  });
}
