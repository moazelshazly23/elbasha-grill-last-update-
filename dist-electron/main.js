// electron/main.ts
import { app, BrowserWindow as BrowserWindow2, ipcMain } from "electron";
import path3 from "path";
import fs2 from "fs";
import { fileURLToPath as fileURLToPath2 } from "url";

// electron/printing.ts
import { BrowserWindow } from "electron";
import path2 from "path";
import { fileURLToPath } from "url";

// src/utils/printingProtocols.ts
var PRINTING_PROTOCOL_REGISTRY = {
  escpos_raw: {
    id: "escpos_raw",
    nameAr: "ESC/POS \u0645\u0628\u0627\u0634\u0631 (Rongta RP350)",
    nameEn: "ESC/POS Raw Binary (GS v 0 + GS V)",
    enabledForRongtaRP350: true,
    description: "\u0627\u0644\u0648\u0636\u0639 \u0627\u0644\u0642\u064A\u0627\u0633\u064A \u0644\u0637\u0627\u0628\u0639\u0627\u062A Rongta RP350 \u0639\u0628\u0631 USB Raw Spooler \u0623\u0648 LAN TCP/IP Port 9100."
  },
  windows_driver: {
    id: "windows_driver",
    nameAr: "\u062A\u0639\u0631\u064A\u0641 \u0648\u064A\u0646\u062F\u0648\u0632 \u0627\u0644\u0631\u0633\u0645\u064A (Windows Driver)",
    nameEn: "Windows Print Spooler Driver (HTML 80mm/58mm)",
    enabledForRongtaRP350: true,
    description: "\u0627\u0644\u0637\u0628\u0627\u0639\u0629 \u0639\u0628\u0631 \u062A\u0639\u0631\u064A\u0641 Windows \u0627\u0644\u0645\u062B\u0628\u062A \u0644\u0640 Rongta RP350 \u0645\u0639 \u0642\u0648\u0627\u0644\u0628 CSS \u0627\u0644\u062D\u0631\u0627\u0631\u064A\u0629 80mm / 58mm."
  },
  tspl: {
    id: "tspl",
    nameAr: "TSPL (\u0637\u0627\u0628\u0639\u0627\u062A \u0627\u0644\u0628\u0627\u0631\u0643\u0648\u062F \u0648\u0627\u0644\u0645\u0644\u0635\u0642\u0627\u062A \u0641\u0642\u0637 - \u0645\u062D\u0638\u0648\u0631 \u0639\u0644\u0649 \u0627\u0644\u0641\u0648\u0627\u062A\u064A\u0631)",
    nameEn: "TSPL Barcode Label Protocol (Blocked for Receipt Printers)",
    enabledForRongtaRP350: false,
    description: "\u0628\u0631\u0648\u062A\u0648\u0643\u0648\u0644 \u062E\u0627\u0635 \u0628\u0637\u0627\u0628\u0639\u0627\u062A \u0627\u0644\u0645\u0644\u0635\u0642\u0627\u062A \u0648\u0627\u0644\u0628\u0627\u0631\u0643\u0648\u062F\u061B \u0645\u0645\u0646\u0648\u0639 \u0625\u0631\u0633\u0627\u0644\u0647 \u0646\u0647\u0627\u0626\u064A\u0627\u064B \u0644\u0637\u0627\u0628\u0639\u0629 \u0627\u0644\u0641\u0648\u0627\u062A\u064A\u0631 Rongta RP350."
  }
};
var TSPL_FORBIDDEN_PATTERNS = [
  /(?:^|[\r\n])\s*SIZE\s+\d+(?:\.\d+)?\s*(?:mm)?\s*,/im,
  /(?:^|[\r\n])\s*GAP\s+\d+(?:\.\d+)?\s*(?:mm)?\s*,/im,
  /(?:^|[\r\n])\s*DIRECTION\s+\d+/im,
  /(?:^|[\r\n])\s*REFERENCE\s+\d+\s*,\s*\d+/im,
  /(?:^|[\r\n])\s*OFFSET\s+\d+/im,
  /(?:^|[\r\n])\s*SET\s+PEEL\s+(?:ON|OFF)/im,
  /(?:^|[\r\n])\s*SET\s+CUTTER\s+(?:ON|OFF|\d+)/im,
  /(?:^|[\r\n])\s*SET\s+TEAR\s+(?:ON|OFF)/im,
  /(?:^|[\r\n])\s*CLS\s*(?:$|[\r\n])/im,
  /(?:^|[\r\n])\s*PRINT\s+\d+\s*,\s*\d+/im,
  /(?:^|[\r\n])\s*(?:SPEED|DENSITY)\s+\d+/im
];
var LABEL_PRINTER_KEYWORDS = [
  "tspl",
  "tsc ",
  "tsc-",
  "zebra",
  "zd220",
  "zd230",
  "gk420",
  "xp-365",
  "xp-420",
  "xp-370",
  "barcode",
  "label",
  "sticker",
  "godex",
  "argox",
  "\u0628\u0627\u0631\u0643\u0648\u062F",
  "\u0645\u0644\u0635\u0642\u0627\u062A"
];
function isLikelyLabelPrinter(printerName) {
  const lower = String(printerName || "").toLowerCase();
  if (!lower) return false;
  return LABEL_PRINTER_KEYWORDS.some((kw) => lower.includes(kw));
}
function containsTsplCommands(payload) {
  let text = "";
  if (typeof payload === "string") {
    text = payload;
  } else if (payload instanceof Uint8Array) {
    const maxScan = Math.min(payload.length, 4096);
    const chars = [];
    for (let i = 0; i < maxScan; i++) {
      const b = payload[i];
      if (b === 10 || b === 13 || b >= 32 && b <= 126) {
        chars.push(String.fromCharCode(b));
      } else {
        chars.push(" ");
      }
    }
    text = chars.join("");
  }
  if (!text) return false;
  return TSPL_FORBIDDEN_PATTERNS.some((rx) => rx.test(text));
}
function assertNoTsplCommands(payload, context = "Rongta RP350 ESC/POS") {
  if (containsTsplCommands(payload)) {
    throw new Error(
      `\u062A\u0645 \u0631\u0641\u0636 \u0623\u0645\u0631 \u0627\u0644\u0637\u0628\u0627\u0639\u0629 (${context}): \u064A\u062D\u062A\u0648\u064A \u0639\u0644\u0649 \u0623\u0648\u0627\u0645\u0631 TSPL \u062E\u0627\u0635\u0629 \u0628\u0637\u0627\u0628\u0639\u0627\u062A \u0627\u0644\u0628\u0627\u0631\u0643\u0648\u062F \u0648\u0627\u0644\u0645\u0644\u0635\u0642\u0627\u062A\u060C \u0648\u0647\u0648 \u0645\u0627 \u064A\u0633\u0628\u0628 \u0637\u0628\u0627\u0639\u0629 \u0631\u0645\u0648\u0632 \u0623\u0648 \u0643\u0648\u062F \u062A\u0627\u0644\u0641 \u0639\u0644\u0649 \u0637\u0627\u0628\u0639\u0629 \u0627\u0644\u0641\u0648\u0627\u062A\u064A\u0631 Rongta RP350.`
    );
  }
}
function assertProtocolAllowedForReceipt(protocolId) {
  const def = PRINTING_PROTOCOL_REGISTRY[protocolId];
  if (!def || !def.enabledForRongtaRP350) {
    throw new Error(
      `\u0628\u0631\u0648\u062A\u0648\u0643\u0648\u0644 (${protocolId}) \u0645\u062D\u0638\u0648\u0631 \u0644\u0637\u0627\u0628\u0639\u0627\u062A \u0627\u0644\u0641\u0648\u0627\u062A\u064A\u0631 \u0627\u0644\u062D\u0631\u0627\u0631\u064A\u0629 Rongta RP350. \u0627\u0633\u062A\u062E\u062F\u0645 escpos_raw \u0623\u0648 windows_driver \u0641\u0642\u0637.`
    );
  }
}
function base64ToUint8Array(b64) {
  if (!b64) return new Uint8Array(0);
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
function buildEscPosReceiptBytes(options) {
  assertProtocolAllowedForReceipt("escpos_raw");
  const copies = Math.max(1, Math.min(5, Math.floor(Number(options.copies) || 1)));
  const feedLines = Math.max(0, Math.min(10, Math.floor(Number(options.paperFeedLines ?? 4))));
  const autoCut = options.autoCut !== false;
  const buzzer = Boolean(options.buzzer);
  const alignCode = options.alignment === "left" ? 0 : options.alignment === "right" ? 2 : 1;
  let rasterData = options.rasterBytes || new Uint8Array(0);
  if (rasterData.length === 0 && options.rasterBase64) {
    rasterData = base64ToUint8Array(options.rasterBase64);
  }
  if (rasterData.length > 0) {
    const isStandardGsV0 = rasterData.length >= 8 && rasterData[0] === 29 && rasterData[1] === 118 && rasterData[2] === 48;
    if (!isStandardGsV0) {
      assertNoTsplCommands(rasterData, "ESC/POS Buffer Validation");
    }
  }
  const singleChunks = [
    // ESC @ (Initialize printer)
    new Uint8Array([27, 64])
  ];
  if (buzzer) {
    singleChunks.push(new Uint8Array([27, 66, 3, 2, 7]));
  }
  singleChunks.push(new Uint8Array([27, 97, alignCode]));
  if (rasterData.length > 0) {
    singleChunks.push(rasterData);
  }
  if (feedLines > 0) {
    singleChunks.push(new Uint8Array([27, 100, feedLines]));
  }
  if (autoCut) {
    singleChunks.push(new Uint8Array([29, 86, 66, 0]));
  }
  const singleLength = singleChunks.reduce((sum, c) => sum + c.length, 0);
  const totalBytes = new Uint8Array(singleLength * copies);
  for (let c = 0; c < copies; c++) {
    let offset = c * singleLength;
    for (const chunk of singleChunks) {
      totalBytes.set(chunk, offset);
      offset += chunk.length;
    }
  }
  return totalBytes;
}

// server/nativePrintCore.ts
import net from "net";
import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
var IPV4_REGEX = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
function validateLanEndpoint(rawIp, rawPort) {
  const ip = String(rawIp || "").trim();
  const port = Number(rawPort);
  if (!ip || ip.toLowerCase() === "offline" || ip === "0.0.0.0") {
    return {
      valid: false,
      ip,
      port: Number.isFinite(port) ? port : 9100,
      errorCode: ip.toLowerCase() === "offline" || ip === "0.0.0.0" ? "LAN_OFFLINE_CONFIGURED" : "LAN_INVALID_IP",
      error: ip.toLowerCase() === "offline" || ip === "0.0.0.0" ? `\u0637\u0627\u0628\u0639\u0629 \u0627\u0644\u0645\u0637\u0628\u062E LAN \u0645\u0647\u064A\u0623\u0629 \u062D\u0627\u0644\u064A\u0627\u064B \u0643\u063A\u064A\u0631 \u0645\u062A\u0635\u0644\u0629 (${ip}).` : "\u0639\u0646\u0648\u0627\u0646 IP \u0644\u0637\u0627\u0628\u0639\u0629 \u0627\u0644\u0645\u0637\u0628\u062E \u063A\u064A\u0631 \u0635\u0627\u0644\u062D \u0623\u0648 \u0641\u0627\u0631\u063A."
    };
  }
  const isLocalHost = ip.toLowerCase() === "localhost" || ip === "::1";
  if (!isLocalHost && !IPV4_REGEX.test(ip)) {
    return {
      valid: false,
      ip,
      port: Number.isFinite(port) ? port : 9100,
      errorCode: "LAN_INVALID_IP",
      error: `\u0635\u064A\u063A\u0629 \u0639\u0646\u0648\u0627\u0646 IP \u063A\u064A\u0631 \u0635\u062D\u064A\u062D\u0629: "${ip}". \u0627\u0644\u0635\u064A\u063A\u0629 \u0627\u0644\u0645\u0637\u0644\u0648\u0628\u0629 \u0645\u062B\u0644 192.168.1.200`
    };
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return {
      valid: false,
      ip,
      port,
      errorCode: "LAN_INVALID_PORT",
      error: `\u0631\u0642\u0645 \u0627\u0644\u0645\u0646\u0641\u0630 TCP \u063A\u064A\u0631 \u0635\u0627\u0644\u062D: "${rawPort}". \u064A\u062C\u0628 \u0623\u0646 \u064A\u0643\u0648\u0646 \u0628\u064A\u0646 1 \u0648 65535 (\u0627\u0644\u0627\u0641\u062A\u0631\u0627\u0636\u064A 9100).`
    };
  }
  return { valid: true, ip, port };
}
function classifySocketError(err, ip, port) {
  const sysCode = String(err?.code || "").toUpperCase();
  const rawMsg = String(err?.message || err || "Unknown socket error");
  if (sysCode === "ETIMEDOUT" || rawMsg.toLowerCase().includes("timeout")) {
    return {
      errorCode: "LAN_TIMEOUT",
      error: `\u0627\u0646\u062A\u0647\u062A \u0645\u0647\u0644\u0629 \u0627\u0644\u0627\u062A\u0635\u0627\u0644 \u0628\u0637\u0627\u0628\u0639\u0629 \u0627\u0644\u0645\u0637\u0628\u062E (${ip}:${port}). \u062A\u0623\u0643\u062F \u0645\u0646 \u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u0637\u0627\u0628\u0639\u0629 \u0648\u0627\u062A\u0635\u0627\u0644\u0647\u0627 \u0628\u0646\u0641\u0633 \u0627\u0644\u0634\u0628\u0643\u0629 \u0627\u0644\u0641\u0631\u0639\u064A\u0629.`,
      technicalDetails: `TCP timeout on ${ip}:${port} (${rawMsg})`
    };
  }
  if (sysCode === "ECONNREFUSED") {
    return {
      errorCode: "LAN_CONNECTION_REFUSED",
      error: `\u0637\u0627\u0628\u0639\u0629 \u0627\u0644\u0645\u0637\u0628\u062E (${ip}:${port}) \u0631\u0641\u0636\u062A \u0627\u0644\u0627\u062A\u0635\u0627\u0644 \u0628\u0627\u0644\u0645\u0646\u0641\u0630 ${port}. \u062A\u0623\u0643\u062F \u0645\u0646 \u062A\u0641\u0639\u064A\u0644 Raw TCP Port ${port} \u0648\u0639\u062F\u0645 \u062D\u0638\u0631\u0647 \u0628\u062C\u062F\u0627\u0631 \u0627\u0644\u062D\u0645\u0627\u064A\u0629.`,
      technicalDetails: `ECONNREFUSED on ${ip}:${port} (${rawMsg})`
    };
  }
  if (sysCode === "EHOSTUNREACH" || sysCode === "ENETUNREACH") {
    return {
      errorCode: "LAN_NETWORK_UNREACHABLE",
      error: `\u0627\u0644\u0634\u0628\u0643\u0629 \u0623\u0648 \u0627\u0644\u0645\u0636\u064A\u0641 (${ip}) \u063A\u064A\u0631 \u0642\u0627\u0628\u0644 \u0644\u0644\u0648\u0635\u0648\u0644 \u0645\u0646 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632 (${sysCode}). \u0631\u0627\u062C\u0639 \u0643\u0627\u0628\u0644 \u0627\u0644\u0625\u064A\u062B\u0631\u0646\u062A \u0623\u0648 \u0625\u0639\u062F\u0627\u062F\u0627\u062A Subnet/Gateway.`,
      technicalDetails: `${sysCode} targeting ${ip}:${port} (${rawMsg})`
    };
  }
  if (sysCode === "ECONNRESET" || sysCode === "EPIPE" || sysCode === "ERR_STREAM_WRITE_AFTER_END") {
    return {
      errorCode: "LAN_DISCONNECTED",
      error: `\u0627\u0646\u0642\u0637\u0639 \u0627\u0644\u0627\u062A\u0635\u0627\u0644 \u0628\u0637\u0627\u0628\u0639\u0629 \u0627\u0644\u0645\u0637\u0628\u062E (${ip}:${port}) \u0623\u062B\u0646\u0627\u0621 \u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A (${sysCode}).`,
      technicalDetails: `${sysCode} during write to ${ip}:${port} (${rawMsg})`
    };
  }
  if (sysCode === "EINVAL" || sysCode === "ENOTFOUND" || sysCode === "EAI_AGAIN") {
    return {
      errorCode: "LAN_INVALID_IP",
      error: `\u0639\u0646\u0648\u0627\u0646 \u0627\u0644\u0634\u0628\u0643\u0629 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D \u0623\u0648 \u063A\u064A\u0631 \u0642\u0627\u0628\u0644 \u0644\u0644\u062D\u0644 (${ip}:${port}).`,
      technicalDetails: `${sysCode}: ${rawMsg}`
    };
  }
  return {
    errorCode: "LAN_WRITE_ERROR",
    error: `\u0641\u0634\u0644 \u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A \u0639\u0628\u0631 \u0627\u0644\u0634\u0628\u0643\u0629 \u0625\u0644\u0649 ${ip}:${port}: ${rawMsg}`,
    technicalDetails: `${sysCode || "TCP_ERR"}: ${rawMsg}`
  };
}
function sendRawTcpOnce(ip, port, payload, connectTimeoutMs, writeTimeoutMs) {
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
        latencyMs
      });
    };
    const finishError = (err) => {
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
        technicalDetails: classified.technicalDetails
      });
    };
    socket.setTimeout(connectTimeoutMs);
    socket.on("timeout", () => {
      const stage = connected ? "write" : "connect";
      finishError(
        Object.assign(new Error(`TCP ${stage} timeout after ${connected ? writeTimeoutMs : connectTimeoutMs}ms`), {
          code: "ETIMEDOUT"
        })
      );
    });
    socket.on("error", (err) => {
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
async function sendRawTcpSocket(rawIp, rawPort, payload, options) {
  const validation = validateLanEndpoint(rawIp, rawPort);
  if (!validation.valid) {
    return {
      ok: false,
      bytesSent: 0,
      latencyMs: 0,
      errorCode: validation.errorCode,
      error: validation.error,
      technicalDetails: `Endpoint validation failed for "${rawIp}:${rawPort}"`
    };
  }
  const connectTimeoutMs = Math.max(300, Math.min(15e3, options?.connectTimeoutMs ?? 3e3));
  const writeTimeoutMs = Math.max(500, Math.min(2e4, options?.writeTimeoutMs ?? 4500));
  const maxRetries = Math.max(0, Math.min(3, options?.retries ?? 1));
  const retryDelayMs = Math.max(50, Math.min(2e3, options?.retryDelayMs ?? 250));
  let lastResult = {
    ok: false,
    bytesSent: 0,
    latencyMs: 0,
    errorCode: "LAN_WRITE_ERROR",
    error: "\u0644\u0645 \u064A\u0628\u062F\u0623 \u0627\u0644\u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0634\u0628\u0643\u064A."
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
    const transient = lastResult.errorCode === "LAN_TIMEOUT" || lastResult.errorCode === "LAN_DISCONNECTED";
    if (!transient || attempt >= maxRetries) {
      break;
    }
    await new Promise((r) => setTimeout(r, retryDelayMs * (attempt + 1)));
  }
  return lastResult;
}
async function testTcpEndpoint(rawIp, rawPort, timeoutMs = 2500) {
  const validation = validateLanEndpoint(rawIp, rawPort);
  if (!validation.valid) {
    return {
      reachable: false,
      latencyMs: 0,
      errorCode: validation.errorCode,
      error: validation.error,
      technicalDetails: `Endpoint validation failed for "${rawIp}:${rawPort}"`
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
    const done = (reachable, err) => {
      if (settled) return;
      settled = true;
      const latencyMs = Date.now() - startAt;
      cleanup();
      if (reachable) {
        resolve({
          reachable: true,
          latencyMs
        });
      } else {
        const classified = classifySocketError(err, validation.ip, validation.port);
        resolve({
          reachable: false,
          latencyMs,
          errorCode: classified.errorCode,
          error: classified.error,
          technicalDetails: classified.technicalDetails
        });
      }
    };
    socket.setTimeout(Math.max(300, Math.min(1e4, timeoutMs)));
    socket.on("timeout", () => {
      done(false, Object.assign(new Error(`TCP probe timeout after ${timeoutMs}ms`), { code: "ETIMEDOUT" }));
    });
    socket.on("error", (err) => done(false, err));
    socket.connect(validation.port, validation.ip, () => {
      done(true);
    });
  });
}
function resolveSpoolerScript(extraCandidates = []) {
  const candidates = [
    ...extraCandidates,
    path.resolve(process.cwd(), "server", "rawPrintSpooler.ps1"),
    path.resolve(process.resourcesPath || "", "server", "rawPrintSpooler.ps1")
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}
function runWindowsSpoolerAction(params) {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      resolve({
        ok: false,
        errorCode: "USB_HOST_NOT_WINDOWS",
        error: "\u0637\u0628\u0627\u0639\u0629 USB \u0627\u0644\u0645\u0628\u0627\u0634\u0631\u0629 \u0639\u0628\u0631 Win32 Spooler (winspool.drv) \u062A\u062A\u0637\u0644\u0628 \u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u0646\u0638\u0627\u0645 \u0639\u0644\u0649 Windows.",
        technicalDetails: `Current Node platform is "${process.platform}" (not win32).`,
        spoolerStatus: "NotWindows"
      });
      return;
    }
    const scriptPath = resolveSpoolerScript(params.extraScriptCandidates || []);
    if (!scriptPath) {
      resolve({
        ok: false,
        errorCode: "USB_SPOOLER_UNAVAILABLE",
        error: "\u0645\u0644\u0641 \u0623\u062F\u0627\u0629 \u0627\u0644\u0637\u0628\u0627\u0639\u0629 \u0627\u0644\u0645\u0628\u0627\u0634\u0631\u0629 server/rawPrintSpooler.ps1 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F \u0641\u064A \u062D\u0632\u0645\u0629 \u0627\u0644\u062A\u0637\u0628\u064A\u0642.",
        technicalDetails: "rawPrintSpooler.ps1 not found in expected paths."
      });
      return;
    }
    let tempFile = "";
    if (!params.diagnoseOnly) {
      if (!params.payload || params.payload.length === 0) {
        resolve({
          ok: false,
          errorCode: "USB_WRITE_FAILED",
          error: "\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0637\u0628\u0627\u0639\u0629 \u0627\u0644\u0645\u0631\u0633\u0644\u0629 \u0625\u0644\u0649 \u0637\u0627\u0628\u0639\u0629 \u0627\u0644\u0643\u0627\u0634\u064A\u0631 \u0641\u0627\u0631\u063A\u0629.",
          technicalDetails: "Empty ESC/POS payload buffer."
        });
        return;
      }
      tempFile = path.join(
        os.tmpdir(),
        `basha_escpos_${Date.now()}_${Math.floor(Math.random() * 1e5)}.bin`
      );
      try {
        fs.writeFileSync(tempFile, params.payload);
      } catch (e) {
        resolve({
          ok: false,
          errorCode: "USB_WRITE_FAILED",
          error: `\u062A\u0639\u0630\u0631 \u0643\u062A\u0627\u0628\u0629 \u0645\u0644\u0641 Spooler \u0627\u0644\u0645\u0624\u0642\u062A: ${e?.message || "Unknown error"}`,
          technicalDetails: String(e?.stack || e?.message || e)
        });
        return;
      }
    }
    const psArgs = [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-PrinterName",
      params.printerName || "Rongta RP350 (Cashier - USB)"
    ];
    if (params.diagnoseOnly) {
      psArgs.push("-DiagnoseOnly");
    } else {
      psArgs.push("-FilePath", tempFile);
    }
    execFile(
      "powershell.exe",
      psArgs,
      { timeout: params.timeoutMs ?? 15e3 },
      (err, stdout, stderr) => {
        if (tempFile) {
          try {
            if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
          } catch {
          }
        }
        const outText = String(stdout || "");
        const jsonLine = outText.split(/\r?\n/).find((l) => l.startsWith("WIN32_RESULT_JSON:"));
        if (jsonLine) {
          try {
            const parsed = JSON.parse(jsonLine.slice("WIN32_RESULT_JSON:".length));
            resolve({
              ok: Boolean(parsed.ok),
              errorCode: parsed.errorCode || void 0,
              error: parsed.error || void 0,
              technicalDetails: parsed.stage ? `Stage=${parsed.stage}, Win32=${parsed.win32Error || 0}, Port=${parsed.portName || "N/A"}, Status=${parsed.printerStatus || "N/A"}` : void 0,
              stage: parsed.stage,
              win32Error: parsed.win32Error,
              resolvedPrinter: parsed.resolvedPrinter,
              driverName: parsed.driverName,
              portName: parsed.portName,
              printerStatus: parsed.printerStatus,
              workOffline: Boolean(parsed.workOffline),
              spoolerStatus: parsed.spoolerStatus,
              bytesSent: Number(parsed.bytesSent || 0),
              installedPrinters: Array.isArray(parsed.installedPrinters) ? parsed.installedPrinters : []
            });
            return;
          } catch {
          }
        }
        if (!err && outText.includes("RAW_PRINT_OK")) {
          const parts = outText.trim().split(":");
          resolve({
            ok: true,
            resolvedPrinter: parts[1] || params.printerName,
            bytesSent: Number(parts[2] || params.payload?.length || 0)
          });
          return;
        }
        const rawErr = (stderr || err?.message || "Windows Win32 spooler failed").trim();
        resolve({
          ok: false,
          errorCode: rawErr.includes("PRINTER_NOT_FOUND") ? "USB_PRINTER_NOT_FOUND" : rawErr.includes("BLOCKED_TSPL") ? "TSPL_COMMAND_BLOCKED" : "USB_WRITE_FAILED",
          error: rawErr,
          technicalDetails: rawErr
        });
      }
    );
  });
}

// electron/printing.ts
var __filename = fileURLToPath(import.meta.url);
var __dirname = path2.dirname(__filename);
var EXTRA_SPOOLER_CANDIDATES = [
  path2.resolve(__dirname, "..", "server", "rawPrintSpooler.ps1")
];
var NativePrintingService = class _NativePrintingService {
  /**
   * Retrieves all installed local and network printers from Windows spooler
   */
  static async getAvailablePrinters(window) {
    try {
      const printers = await window.webContents.getPrintersAsync();
      return printers.map((p) => {
        const anyP = p;
        return {
          name: p.name,
          displayName: p.displayName || p.name,
          description: p.description || "",
          status: typeof anyP.status === "number" ? anyP.status : 0,
          isDefault: Boolean(anyP.isDefault)
        };
      });
    } catch (err) {
      console.error("[NativePrintingService] Failed to get printers:", err);
      return [];
    }
  }
  /**
   * Direct Raw ESC/POS & Kitchen Protocol binary dispatch for Rongta RP350 USB & LAN
   */
  static async printRawEscPos(options) {
    try {
      if (options.escposBase64) {
        assertNoTsplCommands(options.escposBase64, "Electron Raw ESC/POS");
      }
      if (options.rawText) {
        assertNoTsplCommands(options.rawText, "Electron Raw Text");
      }
      if (options.printerName && isLikelyLabelPrinter(options.printerName)) {
        return {
          success: false,
          errorCode: "USB_LABEL_PRINTER_BLOCKED",
          error: `\u0627\u0644\u0637\u0627\u0628\u0639\u0629 (${options.printerName}) \u0647\u064A \u0637\u0627\u0628\u0639\u0629 \u0628\u0627\u0631\u0643\u0648\u062F/\u0645\u0644\u0635\u0642\u0627\u062A TSPL \u0648\u0644\u064A\u0633\u062A Rongta RP350.`
        };
      }
      let payloadBuffer;
      const kProto = options.kitchenProtocol || "escpos_raster";
      if (options.target === "kitchen_lan" && kProto === "plain_line") {
        const copies = Math.max(1, Math.min(5, options.copies ?? 1));
        const feed = Math.max(2, options.paperFeedLines ?? 4);
        const single = Buffer.from((options.rawText || "") + "\n".repeat(feed), "utf8");
        payloadBuffer = Buffer.concat(Array.from({ length: copies }, () => single));
      } else if (options.target === "kitchen_lan" && kProto === "escpos_text") {
        const copies = Math.max(1, Math.min(5, options.copies ?? 1));
        const feed = Math.max(0, Math.min(10, options.paperFeedLines ?? 4));
        const chunks = [Buffer.from([27, 64])];
        if (options.buzzer) chunks.push(Buffer.from([27, 66, 3, 2, 7]));
        chunks.push(Buffer.from((options.rawText || "") + "\n", "utf8"));
        if (feed > 0) chunks.push(Buffer.from([27, 100, feed]));
        if (options.autoCut !== false) chunks.push(Buffer.from([29, 86, 66, 0]));
        const single = Buffer.concat(chunks);
        payloadBuffer = Buffer.concat(Array.from({ length: copies }, () => single));
      } else {
        const payloadBytes = buildEscPosReceiptBytes({
          rasterBase64: options.escposBase64,
          alignment: "center",
          paperFeedLines: options.paperFeedLines ?? 4,
          autoCut: options.autoCut !== false,
          buzzer: Boolean(options.buzzer),
          copies: options.copies ?? 1
        });
        payloadBuffer = Buffer.from(payloadBytes);
      }
      if (options.target === "kitchen_lan") {
        const ip = String(options.ip || "").trim();
        const port = Number(options.port) || 9100;
        const tcpRes = await sendRawTcpSocket(ip, port, payloadBuffer, {
          connectTimeoutMs: options.timeoutMs ?? 3e3,
          writeTimeoutMs: Math.max(4e3, (options.timeoutMs ?? 3e3) + 1500),
          retries: 1
        });
        if (!tcpRes.ok) {
          return {
            success: false,
            errorCode: tcpRes.errorCode || "LAN_WRITE_ERROR",
            error: tcpRes.error || `\u062A\u0639\u0630\u0631 \u0627\u0644\u0627\u062A\u0635\u0627\u0644 \u0628\u0637\u0627\u0628\u0639\u0629 \u0627\u0644\u0645\u0637\u0628\u062E (${ip}:${port})`,
            technicalDetails: tcpRes.technicalDetails,
            printerUsed: `${ip}:${port}`
          };
        }
        return {
          success: true,
          mode: "raw-tcp-9100",
          bytesSent: tcpRes.bytesSent,
          printerUsed: `${ip}:${port}`
        };
      }
      const winResult = await runWindowsSpoolerAction({
        printerName: options.printerName || "Rongta RP350 (Cashier - USB)",
        payload: payloadBuffer,
        diagnoseOnly: false,
        extraScriptCandidates: EXTRA_SPOOLER_CANDIDATES
      });
      if (!winResult.ok) {
        return {
          success: false,
          errorCode: winResult.errorCode || "USB_WRITE_FAILED",
          error: winResult.error || "\u0641\u0634\u0644 \u0625\u0631\u0633\u0627\u0644 \u0628\u0627\u064A\u062A\u0627\u062A ESC/POS \u0639\u0628\u0631 winspool.drv",
          technicalDetails: winResult.technicalDetails,
          printerUsed: winResult.resolvedPrinter || options.printerName,
          portName: winResult.portName,
          driverName: winResult.driverName,
          printerStatus: winResult.printerStatus,
          spoolerStatus: winResult.spoolerStatus
        };
      }
      return {
        success: true,
        mode: "winspool-raw",
        bytesSent: winResult.bytesSent || payloadBuffer.length,
        printerUsed: winResult.resolvedPrinter || options.printerName,
        portName: winResult.portName,
        driverName: winResult.driverName,
        printerStatus: winResult.printerStatus,
        spoolerStatus: winResult.spoolerStatus
      };
    } catch (err) {
      return {
        success: false,
        errorCode: "UNKNOWN_PRINT_ERROR",
        error: err?.message || "\u062E\u0637\u0623 \u063A\u064A\u0631 \u0645\u062A\u0648\u0642\u0639 \u0641\u064A \u0642\u0646\u0627\u0629 \u0627\u0644\u0637\u0628\u0627\u0639\u0629 \u0627\u0644\u062E\u0627\u0645 ESC/POS",
        technicalDetails: String(err?.stack || err?.message || err)
      };
    }
  }
  /**
   * Deep USB / LAN printer diagnostics
   */
  static async testPrinterConnection(window, options) {
    if (options.target === "kitchen_lan") {
      const ip = String(options.ip || "").trim();
      const port = Number(options.port) || 9100;
      const tcpRes = await testTcpEndpoint(ip, port, options.timeoutMs ?? 2500);
      const note = options.checkType === "port" ? " (\u0641\u062D\u0635 \u0645\u0646\u0641\u0630 TCP \u0641\u0642\u0637 \u2014 \u0646\u0641\u0651\u0630 \u0627\u062E\u062A\u0628\u0627\u0631 \u0637\u0628\u0627\u0639\u0629 \u0628\u0648\u0646 \u0645\u0637\u0628\u062E \u0644\u0644\u062A\u062D\u0642\u0642 \u0645\u0646 \u062A\u0648\u0627\u0641\u0642 \u0644\u063A\u0629 \u0627\u0644\u0637\u0628\u0627\u0639\u0629)" : "";
      return {
        success: tcpRes.reachable,
        reachable: tcpRes.reachable,
        latencyMs: tcpRes.latencyMs,
        errorCode: tcpRes.errorCode,
        technicalDetails: tcpRes.technicalDetails,
        details: tcpRes.reachable ? `\u062A\u0645 \u0641\u062A\u062D \u0645\u0646\u0641\u0630 TCP ${ip}:${port} \u0628\u0646\u062C\u0627\u062D \u062E\u0644\u0627\u0644 ${tcpRes.latencyMs}ms${note}` : tcpRes.error || `\u062A\u0639\u0630\u0631 \u0627\u0644\u0648\u0635\u0648\u0644 \u0644\u0637\u0627\u0628\u0639\u0629 \u0627\u0644\u0645\u0637\u0628\u062E (${ip}:${port})`
      };
    }
    const reqName = (options.printerName || "").replace(/\s*\[.*?\]\s*$/, "").trim();
    if (reqName && isLikelyLabelPrinter(reqName)) {
      return {
        success: false,
        reachable: false,
        errorCode: "USB_LABEL_PRINTER_BLOCKED",
        details: `\u0627\u0644\u0637\u0627\u0628\u0639\u0629 (${reqName}) \u0637\u0627\u0628\u0639\u0629 \u0628\u0627\u0631\u0643\u0648\u062F/TSPL \u0648\u0644\u0627 \u062A\u0635\u0644\u062D \u0644\u0641\u0648\u0627\u062A\u064A\u0631 Rongta RP350.`
      };
    }
    if (process.platform === "win32") {
      const diag = await runWindowsSpoolerAction({
        printerName: reqName || "Rongta RP350 (Cashier - USB)",
        diagnoseOnly: true,
        extraScriptCandidates: EXTRA_SPOOLER_CANDIDATES
      });
      return {
        success: diag.ok,
        reachable: diag.ok,
        errorCode: diag.errorCode,
        technicalDetails: diag.technicalDetails,
        resolvedPrinter: diag.resolvedPrinter,
        driverName: diag.driverName,
        portName: diag.portName,
        printerStatus: diag.printerStatus,
        spoolerStatus: diag.spoolerStatus,
        installedPrinters: diag.installedPrinters,
        details: diag.ok ? `\u0627\u0644\u0637\u0627\u0628\u0639\u0629 \u062C\u0627\u0647\u0632\u0629: "${diag.resolvedPrinter}" | \u0627\u0644\u0645\u0646\u0641\u0630: ${diag.portName || "USB"} | \u0627\u0644\u062A\u0639\u0631\u064A\u0641: ${diag.driverName || "Windows Driver"} | \u0627\u0644\u062D\u0627\u0644\u0629: ${diag.printerStatus || "Normal"}` : diag.error || `\u0644\u0645 \u064A\u062A\u0645 \u0627\u0644\u0639\u062B\u0648\u0631 \u0639\u0644\u0649 \u0637\u0627\u0628\u0639\u0629 Rongta RP350 \u0645\u0637\u0627\u0628\u0642\u0629 \u0644\u0640 (${reqName || "USB"}).`
      };
    }
    const installed = await _NativePrintingService.getAvailablePrinters(window);
    const matched = installed.find((p) => {
      if (isLikelyLabelPrinter(p.name)) return false;
      const lower = p.name.toLowerCase();
      return reqName && (lower === reqName.toLowerCase() || lower.includes(reqName.toLowerCase())) || lower.includes("rp350") || lower.includes("rongta");
    });
    if (matched) {
      return {
        success: true,
        reachable: true,
        resolvedPrinter: matched.name,
        installedPrinters: installed.map((p) => p.name),
        details: `\u0627\u0644\u0637\u0627\u0628\u0639\u0629 \u0645\u062A\u0635\u0644\u0629 \u0641\u064A \u0646\u0638\u0627\u0645 \u0627\u0644\u062A\u0634\u063A\u064A\u0644: ${matched.name}`
      };
    }
    return {
      success: false,
      reachable: false,
      errorCode: "USB_PRINTER_NOT_FOUND",
      installedPrinters: installed.map((p) => p.name),
      details: `\u0644\u0645 \u064A\u062A\u0645 \u0627\u0644\u0639\u062B\u0648\u0631 \u0639\u0644\u0649 \u0637\u0627\u0628\u0639\u0629 Rongta RP350 \u0645\u0637\u0627\u0628\u0642\u0629 \u0644\u0640 (${reqName || "USB"}).`
    };
  }
  /**
   * Executes silent Windows-Driver receipt printing in an isolated background worker window
   */
  static async printSilent(options) {
    const { html, printerName, paperWidth = "80mm", silent = true, copies = 1, margins } = options;
    try {
      assertNoTsplCommands(html, "Electron Driver HTML Print");
    } catch (err) {
      return {
        success: false,
        errorCode: "TSPL_COMMAND_BLOCKED",
        error: err?.message || "Blocked invalid TSPL command in receipt"
      };
    }
    return new Promise((resolve) => {
      let printWorker = null;
      let hasFinished = false;
      const timeoutTimer = setTimeout(() => {
        if (!hasFinished) {
          hasFinished = true;
          if (printWorker && !printWorker.isDestroyed()) {
            printWorker.destroy();
          }
          resolve({
            success: false,
            errorCode: "USB_WRITE_FAILED",
            error: "\u0627\u0646\u062A\u0647\u062A \u0645\u0647\u0644\u0629 \u0625\u0631\u0633\u0627\u0644 \u0645\u0633\u062A\u0646\u062F \u0627\u0644\u0637\u0628\u0627\u0639\u0629 \u0625\u0644\u0649 Windows Spooler (20s timeout)"
          });
        }
      }, 2e4);
      const cleanup = (result) => {
        if (!hasFinished) {
          hasFinished = true;
          clearTimeout(timeoutTimer);
          if (printWorker && !printWorker.isDestroyed()) {
            printWorker.destroy();
          }
          resolve(result);
        }
      };
      try {
        printWorker = new BrowserWindow({
          show: false,
          width: paperWidth === "58mm" ? 384 : paperWidth === "80mm" ? 576 : 800,
          height: 1e3,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
          }
        });
        const mTop = Math.max(0, Math.min(15, margins?.top ?? 1));
        const mRight = Math.max(0, Math.min(15, margins?.right ?? 2));
        const mBottom = Math.max(0, Math.min(15, margins?.bottom ?? 1));
        const mLeft = Math.max(0, Math.min(15, margins?.left ?? 2));
        const styledReceiptHtml = `
          <!DOCTYPE html>
          <html dir="rtl" lang="ar">
            <head>
              <meta charset="utf-8" />
              <style>
                @page {
                  margin: 0;
                  size: ${paperWidth === "58mm" ? "58mm auto" : paperWidth === "80mm" ? "80mm auto" : "A4"};
                }
                * {
                  box-sizing: border-box;
                  -webkit-print-color-adjust: exact !important;
                  print-color-adjust: exact !important;
                }
                body {
                  margin: 0;
                  padding: ${mTop}mm ${mRight}mm ${mBottom}mm ${mLeft}mm;
                  font-family: 'Cairo', 'Segoe UI', Arial, sans-serif;
                  width: ${paperWidth === "58mm" ? "54mm" : paperWidth === "80mm" ? "76mm" : "100%"};
                  background: #ffffff;
                  color: #000000;
                }
                img {
                  max-width: 100%;
                  height: auto;
                }
              </style>
            </head>
            <body>
              ${html}
            </body>
          </html>
        `;
        printWorker.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(styledReceiptHtml)}`);
        printWorker.webContents.on("did-finish-load", async () => {
          if (!printWorker || printWorker.isDestroyed()) return;
          const reqClean = (printerName || "").replace(/\s*\[.*?\]\s*$/, "").trim();
          if (reqClean && isLikelyLabelPrinter(reqClean)) {
            cleanup({
              success: false,
              errorCode: "USB_LABEL_PRINTER_BLOCKED",
              error: `\u0627\u0644\u0637\u0627\u0628\u0639\u0629 (${reqClean}) \u0645\u0635\u0646\u0641\u0629 \u0643\u0637\u0627\u0628\u0639\u0629 \u0645\u0644\u0635\u0642\u0627\u062A/TSPL \u0648\u0644\u064A\u0633\u062A \u0637\u0627\u0628\u0639\u0629 \u0641\u0648\u0627\u062A\u064A\u0631.`,
              printerUsed: reqClean
            });
            return;
          }
          let resolvedDeviceName = "";
          let availableNames = [];
          try {
            const installed = await printWorker.webContents.getPrintersAsync();
            availableNames = installed.map((p) => p.name);
            if (Array.isArray(installed) && installed.length > 0) {
              const lowerReq = reqClean.toLowerCase();
              const normReq = lowerReq.replace(/[\s\-_()]/g, "");
              const nonLabelPrinters = installed.filter((p) => !isLikelyLabelPrinter(p.name));
              const exact = nonLabelPrinters.find(
                (p) => p.name.toLowerCase() === lowerReq || p.displayName && p.displayName.toLowerCase() === lowerReq
              );
              if (exact) {
                resolvedDeviceName = exact.name;
              } else if (lowerReq) {
                const isKitchenReq = lowerReq.includes("kitchen") || lowerReq.includes("\u0645\u0637\u0628\u062E") || lowerReq.includes("lan");
                const keywordMatch = nonLabelPrinters.find((p) => {
                  const n = `${p.name} ${p.displayName || ""}`.toLowerCase();
                  const nNorm = n.replace(/[\s\-_()]/g, "");
                  if (n.includes("pdf") || n.includes("xps") || n.includes("onenote") || n.includes("fax")) return false;
                  if (normReq && nNorm.includes(normReq)) return true;
                  if (isKitchenReq && (n.includes("kitchen") || n.includes("lan") || n.includes("\u0645\u0637\u0628\u062E"))) return true;
                  if (!isKitchenReq && (n.includes("cashier") || n.includes("usb") || n.includes("\u0643\u0627\u0634\u064A\u0631"))) return true;
                  return n.includes("rp350") || n.includes("rp-350") || n.includes("rongta") || n.includes("80mm") || n.includes("pos-80") || n.includes("pos80");
                });
                if (keywordMatch) {
                  resolvedDeviceName = keywordMatch.name;
                } else {
                  const defaultThermal = nonLabelPrinters.find((p) => {
                    const n = p.name.toLowerCase();
                    return p.isDefault && (n.includes("rp350") || n.includes("rp-350") || n.includes("rongta") || n.includes("80mm") || n.includes("pos"));
                  });
                  resolvedDeviceName = defaultThermal ? defaultThermal.name : "";
                }
              }
            }
          } catch {
            resolvedDeviceName = "";
          }
          if (!resolvedDeviceName && silent) {
            cleanup({
              success: false,
              errorCode: availableNames.length === 0 ? "USB_PRINTER_NOT_FOUND" : "USB_INCORRECT_NAME",
              error: `\u0644\u0645 \u064A\u062A\u0645 \u0627\u0644\u0639\u062B\u0648\u0631 \u0639\u0644\u0649 \u0627\u0644\u0637\u0627\u0628\u0639\u0629 \u0627\u0644\u062D\u0631\u0627\u0631\u064A\u0629 (${reqClean || "Rongta RP350"}) \u0636\u0645\u0646 \u0637\u0627\u0628\u0639\u0627\u062A Windows \u0627\u0644\u0645\u062B\u0628\u062A\u0629.`,
              technicalDetails: `Installed Windows Printers: [${availableNames.join(", ")}]`,
              printerUsed: reqClean
            });
            return;
          }
          printWorker.webContents.print(
            {
              silent,
              printBackground: true,
              deviceName: resolvedDeviceName,
              copies: Math.max(1, copies),
              margins: {
                marginType: "none"
              }
            },
            (success, failureReason) => {
              if (success) {
                cleanup({ success: true, printerUsed: resolvedDeviceName || "Selected Printer" });
              } else {
                cleanup({
                  success: false,
                  errorCode: "USB_WRITE_FAILED",
                  error: failureReason || `\u0641\u0634\u0644 \u0627\u0644\u0637\u0628\u0627\u0639\u0629 \u0639\u0628\u0631 \u062A\u0639\u0631\u064A\u0641 Windows \u0644\u0644\u0637\u0627\u0628\u0639\u0629 (${resolvedDeviceName || reqClean})`,
                  technicalDetails: `Chromium print failureReason="${failureReason}" on device="${resolvedDeviceName}"`,
                  printerUsed: resolvedDeviceName || reqClean
                });
              }
            }
          );
        });
        printWorker.webContents.on("did-fail-load", (_, errorCode, errorDescription) => {
          cleanup({
            success: false,
            errorCode: "USB_WRITE_FAILED",
            error: `Failed to load receipt template: ${errorDescription} (${errorCode})`
          });
        });
      } catch (err) {
        cleanup({
          success: false,
          errorCode: "UNKNOWN_PRINT_ERROR",
          error: err?.message || "Exception in native printing pipeline"
        });
      }
    });
  }
};

// electron/main.ts
var __filename2 = fileURLToPath2(import.meta.url);
var __dirname2 = path3.dirname(__filename2);
var APP_FOLDER_NAME = "MosawyatAlBashaPOS";
var SQLITE_FILE_NAME = "mosawyat_albasha.sqlite";
var USER_DATA_PATH = path3.join(
  process.env.LOCALAPPDATA || app.getPath("appData"),
  APP_FOLDER_NAME
);
try {
  app.setPath("userData", path3.join(USER_DATA_PATH, "profile"));
} catch (e) {
  console.warn("[Electron] Could not set custom userData path:", e);
}
var DATA_DIR = path3.join(USER_DATA_PATH, "data");
var LOGS_DIR = path3.join(USER_DATA_PATH, "logs");
var BACKUPS_DIR = path3.join(USER_DATA_PATH, "backups");
var SQLITE_DB_FILE = path3.join(DATA_DIR, SQLITE_FILE_NAME);
function ensureSystemDirectories() {
  const dirs = [USER_DATA_PATH, path3.join(USER_DATA_PATH, "profile"), DATA_DIR, LOGS_DIR, BACKUPS_DIR];
  dirs.forEach((dir) => {
    if (!fs2.existsSync(dir)) {
      try {
        fs2.mkdirSync(dir, { recursive: true });
      } catch (err) {
        console.error(`[Electron] Failed to create directory ${dir}:`, err);
      }
    }
  });
  try {
    if (!fs2.existsSync(SQLITE_DB_FILE)) {
      fs2.writeFileSync(SQLITE_DB_FILE, Buffer.from("SQLite format 3\0", "utf8"));
    }
  } catch (err) {
    console.error("[Electron] Failed to initialize SQLite header:", err);
  }
}
function logSystemError(message, error) {
  try {
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    const logFile = path3.join(LOGS_DIR, `system-errors-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.log`);
    const logLine = `[${timestamp}] ${message}: ${error?.stack || error?.message || error}
`;
    fs2.appendFileSync(logFile, logLine, "utf8");
  } catch (e) {
    console.error("[Electron Logger Error]:", e);
  }
}
var gotTheLock = app.requestSingleInstanceLock();
var mainWindow = null;
if (!gotTheLock) {
  console.warn("[Electron] Another instance of Mosawyat Al Basha POS is already running. Quitting.");
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(() => {
    ensureSystemDirectories();
    createMainWindow();
    app.on("activate", () => {
      if (BrowserWindow2.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });
}
function createMainWindow() {
  const preloadPath = path3.join(__dirname2, "preload.js");
  mainWindow = new BrowserWindow2({
    width: 1366,
    height: 768,
    minWidth: 1024,
    minHeight: 700,
    title: "\u0645\u0634\u0648\u064A\u0627\u062A \u0627\u0644\u0628\u0627\u0634\u0627 POS - Commercial Restaurant Management System",
    icon: path3.join(__dirname2, "..", "public", "favicon.svg"),
    backgroundColor: "#F8F5F0",
    autoHideMenuBar: true,
    show: false,
    // Show once ready-to-show for seamless startup
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      // Required for IPC bridge communication
      spellcheck: false
    }
  });
  mainWindow.once("ready-to-show", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
  const devServerUrl = process.env.VITE_DEV_SERVER_URL || "http://localhost:3000";
  if (isDev) {
    mainWindow.loadURL(devServerUrl).catch(() => {
      setTimeout(() => {
        mainWindow?.loadURL(devServerUrl);
      }, 1e3);
    });
  } else {
    mainWindow.loadFile(path3.join(__dirname2, "..", "dist", "index.html"));
  }
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  return mainWindow;
}
ipcMain.handle("get-system-info", () => {
  return {
    os: process.platform,
    arch: process.arch,
    appVersion: app.getVersion(),
    userDataPath: USER_DATA_PATH,
    dataDir: DATA_DIR,
    logsDir: LOGS_DIR,
    backupsDir: BACKUPS_DIR,
    sqliteFile: SQLITE_DB_FILE,
    isWindows: process.platform === "win32",
    isElevated: false
  };
});
ipcMain.handle("sqlite-ensure-path", (_event, _payload) => {
  try {
    ensureSystemDirectories();
    return {
      success: true,
      resolvedPath: SQLITE_DB_FILE,
      dataDir: DATA_DIR,
      exists: fs2.existsSync(SQLITE_DB_FILE)
    };
  } catch (err) {
    logSystemError("sqlite-ensure-path error", err);
    return {
      success: false,
      resolvedPath: SQLITE_DB_FILE,
      dataDir: DATA_DIR,
      exists: false,
      error: err?.message || "Unknown error ensuring SQLite path"
    };
  }
});
ipcMain.handle("sqlite-write-snapshot", (_event, { tableName, data }) => {
  try {
    ensureSystemDirectories();
    const tableDumpFile = path3.join(DATA_DIR, `sqlite_${tableName}.json`);
    fs2.writeFileSync(tableDumpFile, data, "utf8");
    return { success: true };
  } catch (err) {
    logSystemError(`Failed to write snapshot for table ${tableName}`, err);
    return { success: false, error: err?.message };
  }
});
ipcMain.handle("save-app-data", (_event, { key, data }) => {
  try {
    ensureSystemDirectories();
    const filePath = path3.join(DATA_DIR, `${key}.json`);
    fs2.writeFileSync(filePath, typeof data === "string" ? data : JSON.stringify(data), "utf8");
    return { success: true };
  } catch (err) {
    logSystemError(`Failed to save app data key: ${key}`, err);
    return { success: false, error: err?.message };
  }
});
ipcMain.handle("load-app-data", (_event, { key }) => {
  try {
    ensureSystemDirectories();
    const filePath = path3.join(DATA_DIR, `${key}.json`);
    if (fs2.existsSync(filePath)) {
      const raw = fs2.readFileSync(filePath, "utf8");
      return { success: true, data: JSON.parse(raw) };
    }
    return { success: false, data: null };
  } catch (err) {
    logSystemError(`Failed to load app data key: ${key}`, err);
    return { success: false, data: null, error: err?.message };
  }
});
ipcMain.handle("load-all-data", () => {
  try {
    ensureSystemDirectories();
    const result = {};
    if (fs2.existsSync(DATA_DIR)) {
      const files = fs2.readdirSync(DATA_DIR);
      for (const file of files) {
        if (file.endsWith(".json")) {
          const key = file.replace(/\.json$/, "");
          try {
            const raw = fs2.readFileSync(path3.join(DATA_DIR, file), "utf8");
            result[key] = JSON.parse(raw);
          } catch (e) {
            console.warn(`[Electron] Error parsing ${file}:`, e);
          }
        }
      }
    }
    return { success: true, data: result };
  } catch (err) {
    logSystemError("load-all-data error", err);
    return { success: false, data: {}, error: err?.message };
  }
});
ipcMain.handle("restore-database", (_event, { backupContent }) => {
  try {
    ensureSystemDirectories();
    const parsed = typeof backupContent === "string" ? JSON.parse(backupContent) : backupContent;
    for (const [key, value] of Object.entries(parsed)) {
      const fileName = key.endsWith(".json") ? key : `${key}.json`;
      const filePath = path3.join(DATA_DIR, fileName);
      fs2.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
    }
    return { success: true };
  } catch (err) {
    logSystemError("restore-database failed", err);
    return { success: false, error: err?.message };
  }
});
ipcMain.handle("backup-database", () => {
  try {
    ensureSystemDirectories();
    const dateTag = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
    const backupFileName = `basha_pos_backup_${dateTag}.json`;
    const targetFile = path3.join(BACKUPS_DIR, backupFileName);
    const files = fs2.readdirSync(DATA_DIR);
    const backupData = {};
    files.forEach((file) => {
      if (file.endsWith(".json")) {
        try {
          const content = fs2.readFileSync(path3.join(DATA_DIR, file), "utf8");
          backupData[file] = JSON.parse(content);
        } catch {
        }
      }
    });
    fs2.writeFileSync(targetFile, JSON.stringify(backupData, null, 2), "utf8");
    return { success: true, backupFile: targetFile };
  } catch (err) {
    return { success: false, error: err?.message };
  }
});
ipcMain.handle("get-printers", async () => {
  if (!mainWindow) return [];
  return NativePrintingService.getAvailablePrinters(mainWindow);
});
ipcMain.handle("print-direct", async (_event, options) => {
  try {
    return await NativePrintingService.printSilent(options);
  } catch (err) {
    logSystemError("print-direct handler failed", err);
    return {
      success: false,
      error: err?.message || "Print dispatch failed"
    };
  }
});
ipcMain.handle("print-raw-escpos", async (_event, options) => {
  try {
    return await NativePrintingService.printRawEscPos(options);
  } catch (err) {
    logSystemError("print-raw-escpos handler failed", err);
    return {
      success: false,
      error: err?.message || "Raw ESC/POS dispatch failed"
    };
  }
});
ipcMain.handle("test-printer-connection", async (_event, options) => {
  if (!mainWindow) {
    return { success: false, reachable: false, details: "No active application window" };
  }
  try {
    return await NativePrintingService.testPrinterConnection(mainWindow, options);
  } catch (err) {
    logSystemError("test-printer-connection handler failed", err);
    return {
      success: false,
      reachable: false,
      details: err?.message || "Connection test failed"
    };
  }
});
ipcMain.on("window-minimize", () => {
  mainWindow?.minimize();
});
ipcMain.on("window-maximize", () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});
ipcMain.on("window-close", () => {
  mainWindow?.close();
});
ipcMain.handle("toggle-fullscreen", () => {
  if (mainWindow) {
    const isFullScreen = !mainWindow.isFullScreen();
    mainWindow.setFullScreen(isFullScreen);
    return isFullScreen;
  }
  return false;
});
ipcMain.handle("toggle-kiosk", () => {
  if (mainWindow) {
    const isKiosk = !mainWindow.isKiosk();
    mainWindow.setKiosk(isKiosk);
    return isKiosk;
  }
  return false;
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
process.on("uncaughtException", (err) => {
  console.error("[Electron Uncaught Exception]:", err);
  logSystemError("Process uncaughtException", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[Electron Unhandled Rejection]:", reason);
  logSystemError("Process unhandledRejection", reason);
});
