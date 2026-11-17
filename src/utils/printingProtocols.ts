/**
 * Printing Protocol Architecture & TSPL Isolation Guard for Rongta RP350 (80mm ESC/POS)
 *
 * - Strictly separates ESC/POS Raw Mode, Windows Driver Mode, and blocked TSPL protocol.
 * - Prevents ANY TSPL label commands (SIZE, DIRECTION, REFERENCE, OFFSET, SET PEEL, SET CUTTER, SET TEAR, CLS, PRINT 1,1)
 *   from leaking into Rongta RP350 thermal receipt workflows.
 */

export type PrintingMode = 'escpos_raw' | 'windows_driver';
export type ProtocolId = 'escpos_raw' | 'windows_driver' | 'tspl';

export interface ProtocolDefinition {
  id: ProtocolId;
  nameAr: string;
  nameEn: string;
  enabledForRongtaRP350: boolean;
  description: string;
}

export const PRINTING_PROTOCOL_REGISTRY: Record<ProtocolId, ProtocolDefinition> = {
  escpos_raw: {
    id: 'escpos_raw',
    nameAr: 'ESC/POS مباشر (Rongta RP350)',
    nameEn: 'ESC/POS Raw Binary (GS v 0 + GS V)',
    enabledForRongtaRP350: true,
    description: 'الوضع القياسي لطابعات Rongta RP350 عبر USB Raw Spooler أو LAN TCP/IP Port 9100.',
  },
  windows_driver: {
    id: 'windows_driver',
    nameAr: 'تعريف ويندوز الرسمي (Windows Driver)',
    nameEn: 'Windows Print Spooler Driver (HTML 80mm/58mm)',
    enabledForRongtaRP350: true,
    description: 'الطباعة عبر تعريف Windows المثبت لـ Rongta RP350 مع قوالب CSS الحرارية 80mm / 58mm.',
  },
  tspl: {
    id: 'tspl',
    nameAr: 'TSPL (طابعات الباركود والملصقات فقط - محظور على الفواتير)',
    nameEn: 'TSPL Barcode Label Protocol (Blocked for Receipt Printers)',
    enabledForRongtaRP350: false,
    description: 'بروتوكول خاص بطابعات الملصقات والباركود؛ ممنوع إرساله نهائياً لطابعة الفواتير Rongta RP350.',
  },
};

export const TSPL_FORBIDDEN_PATTERNS: RegExp[] = [
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
  /(?:^|[\r\n])\s*(?:SPEED|DENSITY)\s+\d+/im,
];

const LABEL_PRINTER_KEYWORDS = [
  'tspl',
  'tsc ',
  'tsc-',
  'zebra',
  'zd220',
  'zd230',
  'gk420',
  'xp-365',
  'xp-420',
  'xp-370',
  'barcode',
  'label',
  'sticker',
  'godex',
  'argox',
  'باركود',
  'ملصقات',
];

const RONGTA_THERMAL_KEYWORDS = ['rp350', 'rongta', '80mm', 'pos-80', 'rp-350', 'thermal', 'receipt'];

export function isLikelyLabelPrinter(printerName: string): boolean {
  const lower = String(printerName || '').toLowerCase();
  if (!lower) return false;
  return LABEL_PRINTER_KEYWORDS.some((kw) => lower.includes(kw));
}

export function isLikelyRongtaThermal(printerName: string): boolean {
  const lower = String(printerName || '').toLowerCase();
  if (!lower) return false;
  if (isLikelyLabelPrinter(lower)) return false;
  return RONGTA_THERMAL_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Inspect either string or raw binary bytes (as ASCII) for leaked TSPL label commands.
 * Note: Raster GS v 0 images are pure binary after header; we only check ASCII header/lines
 * or decode printable ASCII chunks safely.
 */
export function containsTsplCommands(payload: string | Uint8Array): boolean {
  let text = '';
  if (typeof payload === 'string') {
    text = payload;
  } else if (payload instanceof Uint8Array) {
    // Only inspect printable ASCII sequences; strip GS v 0 binary payload if present
    // Convert ASCII printable chars and CR/LF to inspect command prefixes
    const maxScan = Math.min(payload.length, 4096);
    const chars: string[] = [];
    for (let i = 0; i < maxScan; i++) {
      const b = payload[i];
      if (b === 0x0a || b === 0x0d || (b >= 0x20 && b <= 0x7e)) {
        chars.push(String.fromCharCode(b));
      } else {
        chars.push(' ');
      }
    }
    text = chars.join('');
  }

  if (!text) return false;
  return TSPL_FORBIDDEN_PATTERNS.some((rx) => rx.test(text));
}

export function assertNoTsplCommands(payload: string | Uint8Array, context = 'Rongta RP350 ESC/POS'): void {
  if (containsTsplCommands(payload)) {
    throw new Error(
      `تم رفض أمر الطباعة (${context}): يحتوي على أوامر TSPL خاصة بطابعات الباركود والملصقات، وهو ما يسبب طباعة رموز أو كود تالف على طابعة الفواتير Rongta RP350.`
    );
  }
}

export function assertProtocolAllowedForReceipt(protocolId: ProtocolId): void {
  const def = PRINTING_PROTOCOL_REGISTRY[protocolId];
  if (!def || !def.enabledForRongtaRP350) {
    throw new Error(
      `بروتوكول (${protocolId}) محظور لطابعات الفواتير الحرارية Rongta RP350. استخدم escpos_raw أو windows_driver فقط.`
    );
  }
}

export interface EscPosBuildOptions {
  rasterBytes?: Uint8Array;
  rasterBase64?: string;
  alignment?: 'left' | 'center' | 'right';
  paperFeedLines?: number;
  autoCut?: boolean;
  buzzer?: boolean;
  copies?: number;
}

export function base64ToUint8Array(b64: string): Uint8Array {
  if (!b64) return new Uint8Array(0);
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (!bytes || bytes.length === 0) return '';
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Pure ESC/POS Binary Frame Builder (Zero TSPL Commands)
 */
export function buildEscPosReceiptBytes(options: EscPosBuildOptions): Uint8Array {
  assertProtocolAllowedForReceipt('escpos_raw');

  const copies = Math.max(1, Math.min(5, Math.floor(Number(options.copies) || 1)));
  const feedLines = Math.max(0, Math.min(10, Math.floor(Number(options.paperFeedLines ?? 4))));
  const autoCut = options.autoCut !== false;
  const buzzer = Boolean(options.buzzer);

  const alignCode = options.alignment === 'left' ? 0x00 : options.alignment === 'right' ? 0x02 : 0x01;

  let rasterData = options.rasterBytes || new Uint8Array(0);
  if (rasterData.length === 0 && options.rasterBase64) {
    rasterData = base64ToUint8Array(options.rasterBase64);
  }

  // Reject any accidental TSPL injection inside raster/payload buffer before printing
  if (rasterData.length > 0) {
    // Only check if header isn't standard ESC/POS GS v 0 (0x1D 0x76 0x30)
    const isStandardGsV0 = rasterData.length >= 8 && rasterData[0] === 0x1d && rasterData[1] === 0x76 && rasterData[2] === 0x30;
    if (!isStandardGsV0) {
      assertNoTsplCommands(rasterData, 'ESC/POS Buffer Validation');
    }
  }

  const singleChunks: Uint8Array[] = [
    // ESC @ (Initialize printer)
    new Uint8Array([0x1b, 0x40]),
  ];

  // Optional kitchen buzzer ESC B n t + BEL
  if (buzzer) {
    singleChunks.push(new Uint8Array([0x1b, 0x42, 0x03, 0x02, 0x07]));
  }

  // ESC a n (Alignment)
  singleChunks.push(new Uint8Array([0x1b, 0x61, alignCode]));

  if (rasterData.length > 0) {
    singleChunks.push(rasterData);
  }

  // ESC d n (Paper feed n lines)
  if (feedLines > 0) {
    singleChunks.push(new Uint8Array([0x1b, 0x64, feedLines]));
  }

  // GS V 66 0 (Partial cut with feed)
  if (autoCut) {
    singleChunks.push(new Uint8Array([0x1d, 0x56, 0x42, 0x00]));
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
