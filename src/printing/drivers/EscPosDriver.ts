import {
  assertNoTsplCommands,
  assertProtocolAllowedForReceipt,
  buildEscPosReceiptBytes,
  containsTsplCommands,
  isLikelyLabelPrinter,
  isLikelyRongtaThermal,
  PrintingMode,
} from '../../utils/printingProtocols';

export type KitchenLanguageProtocol =
  | 'escpos_raster'
  | 'escpos_text'
  | 'plain_line'
  | 'windows_driver';

export class EscPosDriver {
  public assertCashierModeAllowed(mode: PrintingMode): void {
    assertProtocolAllowedForReceipt(mode);
  }

  public assertTargetSafe(printerName: string): void {
    if (isLikelyLabelPrinter(printerName)) {
      throw new Error(
        `تم إيقاف الطباعة: الطابعة (${printerName}) هي طابعة باركود/ملصقات TSPL وليست طابعة فواتير حرارية Rongta RP350.`
      );
    }
  }

  public assertCleanPayload(payload: string | Uint8Array, context: string): void {
    assertNoTsplCommands(payload, context);
  }

  public containsTspl(payload: string | Uint8Array): boolean {
    return containsTsplCommands(payload);
  }

  public isThermalMatch(printerName: string): boolean {
    return isLikelyRongtaThermal(printerName);
  }

  public buildRasterFrame(options: {
    rasterBase64: string;
    alignment?: 'left' | 'center' | 'right';
    paperFeedLines?: number;
    autoCut?: boolean;
    buzzer?: boolean;
    copies?: number;
  }): Uint8Array {
    return buildEscPosReceiptBytes({
      rasterBase64: options.rasterBase64,
      alignment: options.alignment || 'center',
      paperFeedLines: options.paperFeedLines ?? 4,
      autoCut: options.autoCut !== false,
      buzzer: Boolean(options.buzzer),
      copies: options.copies ?? 1,
    });
  }

  public buildPlainTextFrame(options: {
    text: string;
    includeEscPosWrapper?: boolean;
    paperFeedLines?: number;
    autoCut?: boolean;
    buzzer?: boolean;
    copies?: number;
  }): Uint8Array {
    assertNoTsplCommands(options.text, 'Plain/Text Ticket');
    const encoder = new TextEncoder();
    const textBytes = encoder.encode(options.text.replace(/\r?\n/g, '\r\n') + '\r\n');
    const copies = Math.max(1, Math.min(5, Math.floor(Number(options.copies) || 1)));
    const feedLines = Math.max(0, Math.min(10, Math.floor(Number(options.paperFeedLines ?? 4))));

    if (!options.includeEscPosWrapper) {
      const feedStr = '\r\n'.repeat(Math.max(2, feedLines));
      const feedBytes = encoder.encode(feedStr);
      const singleLen = textBytes.length + feedBytes.length;
      const out = new Uint8Array(singleLen * copies);
      for (let c = 0; c < copies; c++) {
        const offset = c * singleLen;
        out.set(textBytes, offset);
        out.set(feedBytes, offset + textBytes.length);
      }
      return out;
    }

    const chunks: Uint8Array[] = [new Uint8Array([0x1b, 0x40])];
    if (options.buzzer) {
      chunks.push(new Uint8Array([0x1b, 0x42, 0x03, 0x02, 0x07]));
    }
    chunks.push(textBytes);
    if (feedLines > 0) {
      chunks.push(new Uint8Array([0x1b, 0x64, feedLines]));
    }
    if (options.autoCut !== false) {
      chunks.push(new Uint8Array([0x1d, 0x56, 0x42, 0x00]));
    }

    const singleLen = chunks.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(singleLen * copies);
    for (let c = 0; c < copies; c++) {
      let offset = c * singleLen;
      for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
      }
    }
    return out;
  }
}

export const escPosDriver = new EscPosDriver();
