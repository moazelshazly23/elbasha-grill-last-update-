import QRCode from 'qrcode';
import { Order, RestaurantProfile } from '../../types';
import { uint8ArrayToBase64 } from '../../utils/printingProtocols';
import { roundQty } from '../../utils/currency';

export interface RasterLineSpec {
  text: string;
  align?: 'right' | 'center' | 'left';
  bold?: boolean;
  fontSize?: number;
  inverted?: boolean;
  divider?: boolean;
}

export function getOrderTypeLabel(type: Order['type']): string {
  switch (type) {
    case 'dine_in':
      return 'صالات / داخلي (Dine-in)';
    case 'takeaway':
      return 'سفري / تيك أواي (Takeaway)';
    case 'delivery':
      return 'توصيل منازل (Delivery)';
    case 'pickup':
      return 'استلام من الفرع (Pickup)';
    default:
      return 'طلب مباشر';
  }
}

export function getPaymentMethodLabel(method: string): string {
  if (method === 'card') return 'بطاقة بنكية (Card)';
  if (method === 'instapay') return 'إنستاباي (InstaPay)';
  if (method === 'bank_transfer') return 'تحويل بنكي';
  if (method === 'other') return 'دفع إلكتروني';
  return 'نقدي (Cash)';
}

function loadBrowserImage(src: string, timeoutMs = 1000): Promise<HTMLImageElement | null> {
  if (!src || typeof document === 'undefined' || typeof Image === 'undefined') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => resolve(null), timeoutMs);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = src;
  });
}

function applyFloydSteinbergMonoCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  threshold = 140
): Uint8Array {
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  const lum = new Float32Array(width * height);

  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    const alpha = data[idx + 3] / 255;
    const r = data[idx] * alpha + 255 * (1 - alpha);
    const g = data[idx + 1] * alpha + 255 * (1 - alpha);
    const b = data[idx + 2] * alpha + 255 * (1 - alpha);
    lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const oldPx = lum[i];
      const newPx = oldPx < threshold ? 0 : 255;
      lum[i] = newPx;
      const err = oldPx - newPx;
      if (x + 1 < width) lum[i + 1] += (err * 7) / 16;
      if (x - 1 >= 0 && y + 1 < height) lum[i + width - 1] += (err * 3) / 16;
      if (y + 1 < height) lum[i + width] += (err * 5) / 16;
      if (x + 1 < width && y + 1 < height) lum[i + width + 1] += (err * 1) / 16;
    }
  }

  const widthBytes = width / 8;
  const xL = widthBytes & 0xff;
  const xH = (widthBytes >> 8) & 0xff;
  const yL = height & 0xff;
  const yH = (height >> 8) & 0xff;
  const header = [0x1d, 0x76, 0x30, 0x00, xL, xH, yL, yH];
  const rasterBytes = new Uint8Array(header.length + widthBytes * height);
  rasterBytes.set(header, 0);

  let offset = header.length;
  for (let row = 0; row < height; row++) {
    for (let colByte = 0; colByte < widthBytes; colByte++) {
      let byteVal = 0;
      for (let bit = 0; bit < 8; bit++) {
        const px = colByte * 8 + bit;
        if (lum[row * width + px] < 128) {
          byteVal |= 1 << (7 - bit);
        }
      }
      rasterBytes[offset++] = byteVal;
    }
  }

  return rasterBytes;
}

export async function generateReceiptQRCode(order: Order, profile: RestaurantProfile): Promise<string> {
  const rs = profile.receiptSettings;
  if (rs && !rs.enableQrCode) {
    return '';
  }

  try {
    let qrContent = '';
    const qrType = rs?.qrType || 'tax_einvoice';

    if (qrType === 'custom' && rs?.qrUrl) {
      qrContent = rs.qrUrl;
    } else if (qrType === 'website') {
      qrContent = rs?.website || profile.website || rs?.qrUrl || '';
    } else if (qrType === 'google_maps') {
      qrContent = rs?.qrUrl || '';
    } else if (qrType === 'facebook') {
      qrContent = rs?.facebookUrl || profile.facebook || rs?.qrUrl || '';
    } else if (qrType === 'instagram') {
      qrContent = rs?.instagramUrl || profile.instagram || rs?.qrUrl || '';
    } else if (qrType === 'review') {
      qrContent = rs?.qrUrl || rs?.website || profile.website || '';
    } else {
      qrContent = JSON.stringify({
        seller: rs?.restaurantNameArabic || profile.name,
        invoice: order.orderNumber,
        date: order.createdAt,
        total: `${order.total.toFixed(2)} ${profile.currency}`,
      });
    }

    if (!qrContent) {
      qrContent = JSON.stringify({
        seller: rs?.restaurantNameArabic || profile.name,
        invoice: order.orderNumber,
        total: `${order.total.toFixed(2)} ${profile.currency}`,
      });
    }

    const qrSize = rs?.qrSize || 110;
    const qrDataUrl = await QRCode.toDataURL(qrContent, {
      width: qrSize,
      margin: 1,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
      errorCorrectionLevel: 'M',
    });

    return qrDataUrl;
  } catch (err) {
    console.warn('Failed to generate QR code:', err);
    return '';
  }
}

export async function ditherImageToMonochromeDataUrl(
  imageSrc: string,
  maxWidth = 240
): Promise<string> {
  if (!imageSrc || typeof document === 'undefined') return imageSrc;
  const img = await loadBrowserImage(imageSrc, 1200);
  if (!img) return imageSrc;

  try {
    const scale = Math.min(1, maxWidth / Math.max(1, img.width));
    const w = Math.max(8, Math.round(img.width * scale));
    const h = Math.max(8, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return imageSrc;

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    const lum = new Float32Array(w * h);

    for (let i = 0; i < w * h; i++) {
      const idx = i * 4;
      const alpha = data[idx + 3] / 255;
      const r = data[idx] * alpha + 255 * (1 - alpha);
      const g = data[idx + 1] * alpha + 255 * (1 - alpha);
      const b = data[idx + 2] * alpha + 255 * (1 - alpha);
      lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const oldPixel = lum[i];
        const newPixel = oldPixel < 135 ? 0 : 255;
        lum[i] = newPixel;
        const quantError = oldPixel - newPixel;
        if (x + 1 < w) lum[i + 1] += (quantError * 7) / 16;
        if (x - 1 >= 0 && y + 1 < h) lum[i + w - 1] += (quantError * 3) / 16;
        if (y + 1 < h) lum[i + w] += (quantError * 5) / 16;
        if (x + 1 < w && y + 1 < h) lum[i + w + 1] += (quantError * 1) / 16;
      }
    }

    for (let i = 0; i < w * h; i++) {
      const v = lum[i] < 128 ? 0 : 255;
      const idx = i * 4;
      data[idx] = v;
      data[idx + 1] = v;
      data[idx + 2] = v;
      data[idx + 3] = 255;
    }

    ctx.putImageData(imgData, 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    return imageSrc;
  }
}

export function renderLinesToEscPosGSv0Base64(
  lines: RasterLineSpec[],
  paperWidth: '80mm' | '58mm' = '80mm'
): string {
  const widthDots = paperWidth === '58mm' ? 384 : 576;
  const widthBytes = widthDots / 8;

  if (typeof document === 'undefined') {
    const heightDots = Math.max(24, lines.length * 28);
    const xL = widthBytes & 0xff;
    const xH = (widthBytes >> 8) & 0xff;
    const yL = heightDots & 0xff;
    const yH = (heightDots >> 8) & 0xff;
    const header = [0x1d, 0x76, 0x30, 0x00, xL, xH, yL, yH];
    const bitmap = new Uint8Array(header.length + widthBytes * heightDots);
    bitmap.set(header, 0);
    return uint8ArrayToBase64(bitmap);
  }

  try {
    const lineHeights = lines.map((l) => (l.divider ? 12 : Math.round((l.fontSize || 22) * 1.45)));
    const totalHeight = Math.max(64, lineHeights.reduce((a, b) => a + b, 24));

    const canvas = document.createElement('canvas');
    canvas.width = widthDots;
    canvas.height = totalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, widthDots, totalHeight);
    ctx.direction = 'rtl';
    ctx.textBaseline = 'top';

    let y = 12;
    lines.forEach((line, idx) => {
      const lHeight = lineHeights[idx];
      if (line.divider) {
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(10, y + 5);
        ctx.lineTo(widthDots - 10, y + 5);
        ctx.stroke();
        y += lHeight;
        return;
      }

      const fSize = line.fontSize || 22;
      ctx.font = `${line.bold ? '900' : '600'} ${fSize}px "Cairo", "IBM Plex Sans Arabic", Tahoma, sans-serif`;

      if (line.inverted) {
        ctx.fillStyle = '#000000';
        ctx.fillRect(8, y - 2, widthDots - 16, lHeight);
        ctx.fillStyle = '#FFFFFF';
      } else {
        ctx.fillStyle = '#000000';
      }

      if (line.align === 'center') {
        ctx.textAlign = 'center';
        ctx.fillText(line.text, widthDots / 2, y);
      } else if (line.align === 'left') {
        ctx.textAlign = 'left';
        ctx.fillText(line.text, 14, y);
      } else {
        ctx.textAlign = 'right';
        ctx.fillText(line.text, widthDots - 14, y);
      }

      y += lHeight;
    });

    const rasterBytes = applyFloydSteinbergMonoCanvas(ctx, widthDots, totalHeight, 145);
    return uint8ArrayToBase64(rasterBytes);
  } catch {
    return '';
  }
}

export async function renderFullReceiptToEscPosGSv0Base64(
  order: Order,
  profile: RestaurantProfile,
  qrDataUrl = ''
): Promise<string> {
  const rs = profile.receiptSettings;
  const paperWidth = (rs?.paperWidth || profile.thermalPaperWidth) === '58mm' ? '58mm' : '80mm';
  const widthDots = paperWidth === '58mm' ? 384 : 576;

  if (typeof document === 'undefined') {
    const fallbackLines: RasterLineSpec[] = [
      { text: rs?.restaurantNameArabic || profile.name, align: 'center', bold: true, fontSize: 28 },
      { text: rs?.sloganArabic || profile.slogan || 'مشويات الباشا ... انت الباشا', align: 'center', fontSize: 18 },
      { text: `${order.orderNumber} | ${getOrderTypeLabel(order.type)}`, align: 'center', bold: true, fontSize: 22, inverted: true },
      ...order.items.map((it) => ({
        text: `${it.quantity}x ${it.productNameAr} — ${it.itemTotal.toFixed(2)} ${profile.currency}`,
        align: 'right' as const,
        bold: true,
        fontSize: 20,
      })),
      { text: `الإجمالي: ${order.total.toFixed(2)} ${profile.currency}`, align: 'center', bold: true, fontSize: 24 },
    ];
    return renderLinesToEscPosGSv0Base64(fallbackLines, paperWidth);
  }

  try {
    const showLogo = rs ? rs.showLogo : true;
    const logoImg = showLogo && profile.logoUrl ? await loadBrowserImage(profile.logoUrl, 1200) : null;
    const qrImg = qrDataUrl && (rs ? rs.enableQrCode : true) ? await loadBrowserImage(qrDataUrl, 1000) : null;

    const fontPreset = rs?.cashierFontSize || profile.cashierFontSize || 'medium';
    const fontScale = fontPreset === 'small' ? 0.9 : fontPreset === 'large' ? 1.12 : 1.0;
    const scalePx = (base: number) => Math.round((paperWidth === '58mm' ? base * 0.8 : base) * fontScale);

    const padX = Math.max(8, Math.round(((rs?.marginLeftMm ?? 2) + (rs?.marginRightMm ?? 2)) * 2));
    const padTop = Math.max(8, Math.round((rs?.marginTopMm ?? 2) * 4));
    const padBottom = Math.max(12, Math.round((rs?.marginBottomMm ?? 2) * 4));
    const contentW = widthDots - padX * 2;

    const canvas = document.createElement('canvas');
    canvas.width = widthDots;
    canvas.height = 3600;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, widthDots, canvas.height);
    ctx.direction = 'rtl';
    ctx.textBaseline = 'top';

    let y = padTop;

    const drawCenteredText = (text: string, size: number, bold = false, inverted = false) => {
      if (!text) return;
      const lineH = Math.round(size * 1.42);
      ctx.font = `${bold ? '900' : '700'} ${size}px "Cairo", "IBM Plex Sans Arabic", Tahoma, sans-serif`;
      if (inverted) {
        ctx.fillStyle = '#000000';
        ctx.fillRect(padX, y, contentW, lineH + 4);
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.fillText(text, widthDots / 2, y + 3);
        y += lineH + 8;
      } else {
        ctx.fillStyle = '#000000';
        ctx.textAlign = 'center';
        ctx.fillText(text, widthDots / 2, y);
        y += lineH;
      }
    };

    const drawDivider = (dashed = false, thickness = 2) => {
      y += 4;
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = thickness;
      ctx.setLineDash(dashed ? [6, 5] : []);
      ctx.beginPath();
      ctx.moveTo(padX, y);
      ctx.lineTo(widthDots - padX, y);
      ctx.stroke();
      ctx.setLineDash([]);
      y += 8;
    };

    const drawRowPair = (label: string, value: string, size: number, bold = false) => {
      const lineH = Math.round(size * 1.45);
      ctx.font = `${bold ? '900' : '700'} ${size}px "Cairo", "IBM Plex Sans Arabic", Tahoma, sans-serif`;
      ctx.fillStyle = '#000000';
      ctx.textAlign = 'right';
      ctx.fillText(label, widthDots - padX, y);
      ctx.textAlign = 'left';
      ctx.fillText(value, padX, y);
      y += lineH;
    };

    if (logoImg) {
      const targetLogoW = Math.min(contentW * 0.65, (rs?.logoWidth || 120) * (paperWidth === '58mm' ? 1.5 : 1.9));
      const ratio = targetLogoW / Math.max(1, logoImg.width);
      const targetLogoH = Math.min(180, Math.round(logoImg.height * ratio));
      const align = rs?.logoAlignment || 'center';
      const logoX =
        align === 'left'
          ? padX
          : align === 'right'
          ? widthDots - padX - targetLogoW
          : (widthDots - targetLogoW) / 2;
      ctx.drawImage(logoImg, logoX, y, targetLogoW, targetLogoH);
      y += targetLogoH + 10;
    }

    if (rs?.showRestaurantName !== false) {
      drawCenteredText(rs?.restaurantNameArabic || profile.name, scalePx(30), true);
    }
    if (rs?.showEnglishName !== false && (rs?.restaurantNameEnglish || profile.englishName)) {
      drawCenteredText(rs?.restaurantNameEnglish || profile.englishName, scalePx(18), true);
    }
    if (rs?.showSlogan !== false) {
      const slogan = rs?.sloganArabic || profile.slogan || 'مشويات الباشا ... انت الباشا';
      drawCenteredText(slogan, scalePx(17), true);
    }
    if (rs?.showAddress !== false && (rs?.addressDetails || profile.address)) {
      drawCenteredText(rs?.addressDetails || profile.address, scalePx(16), false);
    }
    if (rs?.showPhone !== false) {
      const phones =
        rs?.phones && rs.phones.length > 0
          ? rs.phones.filter((p) => p.showOnReceipt && p.number).map((p) => (p.label ? `${p.label}: ${p.number}` : p.number))
          : [profile.phone, profile.phone2].filter(Boolean);
      if (phones.length > 0) {
        drawCenteredText(phones.join(' - '), scalePx(16), true);
      }
    }

    drawDivider(false, 2);

    if (rs?.showOrderNumber !== false) {
      drawCenteredText(`${order.orderNumber}  |  ${getOrderTypeLabel(order.type)}`, scalePx(22), true, true);
    }
    if (rs?.showTable !== false && order.tableNumber) {
      drawCenteredText(`★ طاولة رقم: ${order.tableNumber} ★`, scalePx(19), true);
    }
    const orderDate = new Date(order.createdAt).toLocaleDateString('ar-EG');
    const orderTime = new Date(order.createdAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    if (rs?.showDate !== false || rs?.showTime !== false) {
      drawRowPair(
        rs?.showDate !== false ? `التاريخ: ${orderDate}` : '',
        rs?.showTime !== false ? `الوقت: ${orderTime}` : '',
        scalePx(16),
        false
      );
    }
    if (rs?.showCashier !== false || rs?.showBranch !== false) {
      drawRowPair(
        rs?.showCashier !== false ? `الكاشير: ${order.cashierName || 'الرئيسي'}` : '',
        rs?.showBranch !== false ? `الفرع: ${order.branchName || 'الرئيسي'}` : '',
        scalePx(16),
        false
      );
    }
    if (rs?.showCustomer !== false && (order.customerName || order.customerPhone || order.deliveryAddress)) {
      drawDivider(true, 1.5);
      if (order.customerName) drawRowPair('العميل:', order.customerName, scalePx(16), true);
      if (order.customerPhone) drawRowPair('الهاتف:', order.customerPhone, scalePx(16), false);
      if (order.deliveryAddress) drawRowPair('العنوان:', order.deliveryAddress, scalePx(15), false);
    }

    drawDivider(false, 2);

    const xItemRight = widthDots - padX;
    const xQtyCenter = padX + Math.round(contentW * 0.44);
    const xUnitCenter = padX + Math.round(contentW * 0.25);
    const xTotalLeft = padX;

    ctx.font = `900 ${scalePx(17)}px "Cairo", "IBM Plex Sans Arabic", Tahoma, sans-serif`;
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'right';
    ctx.fillText('الصنف', xItemRight, y);
    ctx.textAlign = 'center';
    ctx.fillText('ك', xQtyCenter, y);
    ctx.fillText('سعر', xUnitCenter, y);
    ctx.textAlign = 'left';
    ctx.fillText('إجمالي', xTotalLeft, y);
    y += Math.round(scalePx(17) * 1.45);
    drawDivider(false, 2);

    const itemSize = scalePx(18);
    const subSize = scalePx(14);
    order.items.forEach((item) => {
      const rowH = Math.round(itemSize * 1.45);
      ctx.font = `800 ${itemSize}px "Cairo", "IBM Plex Sans Arabic", Tahoma, sans-serif`;
      ctx.fillStyle = '#000000';

      const maxItemWidth = contentW * 0.50;
      let name = item.productNameAr;
      while (name.length > 6 && ctx.measureText(name).width > maxItemWidth) {
        name = name.slice(0, -2) + '…';
      }

      ctx.textAlign = 'right';
      ctx.fillText(name, xItemRight, y);
      ctx.textAlign = 'center';
      ctx.fillText(`${item.quantity}`, xQtyCenter, y);
      ctx.fillText(item.unitPrice.toFixed(0), xUnitCenter, y);
      ctx.textAlign = 'left';
      ctx.fillText(item.itemTotal.toFixed(2), xTotalLeft, y);
      y += rowH;

      if (item.itemType === 'offer' && item.offerComponents && item.offerComponents.length > 0) {
        ctx.font = `700 ${subSize}px "Cairo", "IBM Plex Sans Arabic", Tahoma, sans-serif`;
        ctx.textAlign = 'right';
        ctx.fillText('  محتويات العرض:', xItemRight, y);
        y += Math.round(subSize * 1.35);
        item.offerComponents.forEach((comp) => {
          const totalCompQty = roundQty((Number(comp.quantity) || 0) * item.quantity);
          ctx.fillText(`  • ${comp.productNameAr} × ${totalCompQty}`, xItemRight, y);
          y += Math.round(subSize * 1.35);
        });
      }

      if (item.selectedModifiers?.length) {
        ctx.font = `700 ${subSize}px "Cairo", "IBM Plex Sans Arabic", Tahoma, sans-serif`;
        ctx.textAlign = 'right';
        item.selectedModifiers.forEach((m) => {
          ctx.fillText(`  + ${m.nameAr}`, xItemRight, y);
          y += Math.round(subSize * 1.35);
        });
      }
      if (item.notes) {
        ctx.font = `700 ${subSize}px "Cairo", "IBM Plex Sans Arabic", Tahoma, sans-serif`;
        ctx.textAlign = 'right';
        ctx.fillText(`  ملاحظة: ${item.notes}`, xItemRight, y);
        y += Math.round(subSize * 1.35);
      }
    });

    drawDivider(false, 2);

    if (rs?.showSubtotal !== false) {
      drawRowPair('المجموع الفرعي:', `${order.subtotal.toFixed(2)} ${profile.currency}`, scalePx(18), false);
    }
    if (rs?.showDiscount !== false && order.discountAmount > 0) {
      drawRowPair('الخصم:', `-${order.discountAmount.toFixed(2)} ${profile.currency}`, scalePx(18), true);
    }
    if (rs?.showDeliveryFee !== false && order.deliveryFee && order.deliveryFee > 0) {
      drawRowPair('رسوم التوصيل:', `${order.deliveryFee.toFixed(2)} ${profile.currency}`, scalePx(18), false);
    }
    if (rs?.showTotal !== false) {
      drawDivider(true, 2);
      drawRowPair('المجموع النهائي:', `${order.total.toFixed(2)} ${profile.currency}`, scalePx(24), true);
    }

    if (rs?.showPaymentMethod !== false || rs?.showPaidAmount !== false || rs?.showChange !== false) {
      drawDivider(false, 1.5);
      if (order.paymentStatus === 'unpaid') {
        drawCenteredText(`دفع عند الاستلام — المطلوب: ${order.total.toFixed(2)} ${profile.currency}`, scalePx(17), true);
      } else {
        order.payments.forEach((p) => {
          drawRowPair(
            `${getPaymentMethodLabel(p.method)}:`,
            `${p.amount.toFixed(2)} ${profile.currency}`,
            scalePx(17),
            false
          );
        });
        if (rs?.showChange !== false && order.changeAmount > 0) {
          drawRowPair('الباقي للعميل:', `${order.changeAmount.toFixed(2)} ${profile.currency}`, scalePx(17), true);
        }
      }
    }

    if (qrImg) {
      y += 8;
      const qrDots = Math.min(200, Math.max(120, Math.round((rs?.qrSize || 110) * 1.45)));
      const qrAlign = rs?.qrAlignment || 'center';
      const qrX =
        qrAlign === 'left'
          ? padX
          : qrAlign === 'right'
          ? widthDots - padX - qrDots
          : (widthDots - qrDots) / 2;
      ctx.drawImage(qrImg, qrX, y, qrDots, qrDots);
      y += qrDots + 8;
      if (rs?.qrLabel) {
        drawCenteredText(rs.qrLabel, scalePx(15), true);
      }
    }

    if (rs?.showFooter !== false) {
      y += 4;
      const footerAr = rs?.footerMessageArabic || rs?.footerMessage || profile.receiptFooterNote;
      const footerEn = rs?.footerMessageEnglish;
      if (footerAr) drawCenteredText(footerAr, scalePx(16), true);
      if (footerEn) drawCenteredText(footerEn, scalePx(14), false);
    }

    y += padBottom;

    const finalHeight = Math.max(64, Math.min(canvas.height, y));
    const cropped = document.createElement('canvas');
    cropped.width = widthDots;
    cropped.height = finalHeight;
    const croppedCtx = cropped.getContext('2d');
    if (!croppedCtx) return '';
    croppedCtx.drawImage(canvas, 0, 0, widthDots, finalHeight, 0, 0, widthDots, finalHeight);

    const rasterBytes = applyFloydSteinbergMonoCanvas(croppedCtx, widthDots, finalHeight, 145);
    return uint8ArrayToBase64(rasterBytes);
  } catch {
    return '';
  }
}

export function generateThermalReceiptHTML(
  order: Order,
  profile: RestaurantProfile,
  qrDataUrl = ''
): string {
  const rs = profile.receiptSettings;
  const paperWidth = rs?.paperWidth || profile.thermalPaperWidth || '80mm';
  const is58mm = paperWidth === '58mm';
  const widthStyle = is58mm ? 'width: 54mm; max-width: 54mm;' : 'width: 76mm; max-width: 76mm;';

  const mTop = Math.max(0, Math.min(15, rs?.marginTopMm ?? 2));
  const mRight = Math.max(0, Math.min(15, rs?.marginRightMm ?? 2));
  const mBottom = Math.max(0, Math.min(15, rs?.marginBottomMm ?? 2));
  const mLeft = Math.max(0, Math.min(15, rs?.marginLeftMm ?? 2));

  const fontSizePreset = rs?.cashierFontSize || profile.cashierFontSize || 'medium';
  const fontScale = fontSizePreset === 'small' ? 0.9 : fontSizePreset === 'large' ? 1.15 : 1.0;
  const px = (base: number) => `${Math.round(base * fontScale * 10) / 10}px`;

  const orderDate = new Date(order.createdAt).toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
  const orderTime = new Date(order.createdAt).toLocaleTimeString('ar-EG', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  const showLogo = rs ? rs.showLogo : true;
  const logoAlign = rs?.logoAlignment || 'center';
  const logoWidth = rs?.logoWidth || (is58mm ? 90 : 120);
  const logoMargin =
    logoAlign === 'left' ? '0 auto 0 0' : logoAlign === 'right' ? '0 0 0 auto' : '0 auto';

  const showRestName = rs ? rs.showRestaurantName : true;
  const restNameArabic = rs?.restaurantNameArabic || profile.name;
  const showEngName = rs ? rs.showEnglishName : true;
  const restNameEnglish = rs?.restaurantNameEnglish || profile.englishName;

  const showSlogan = rs ? rs.showSlogan : true;
  const sloganAr = rs?.sloganArabic || profile.slogan || 'مشويات الباشا ... انت الباشا';
  const sloganEn = rs?.sloganEnglish || profile.sloganEnglish;

  const showAddress = rs ? rs.showAddress : true;
  const addressText = rs?.addressDetails || profile.address;

  const showPhone = rs ? rs.showPhone : true;
  let activePhoneNumbers: string[] = [];
  if (rs?.phones && rs.phones.length > 0) {
    activePhoneNumbers = rs.phones
      .filter((p) => p.showOnReceipt && p.number)
      .map((p) => (p.label ? `${p.label}: ${p.number}` : p.number));
  } else if (profile.phone) {
    activePhoneNumbers = [profile.phone];
    if (profile.phone2) activePhoneNumbers.push(profile.phone2);
  }

  const socialLinks: string[] = [];
  if (rs?.showEmail && (rs.email || profile.email)) socialLinks.push(`إيميل: ${rs.email || profile.email}`);
  if (rs?.showWebsite && (rs.website || profile.website)) socialLinks.push(`الموقع: ${rs.website || profile.website}`);
  if (rs?.showFacebook && (rs.facebookUrl || profile.facebook)) socialLinks.push(`فيسبوك: ${rs.facebookUrl || profile.facebook}`);
  if (rs?.showInstagram && (rs.instagramUrl || profile.instagram)) socialLinks.push(`إنستغرام: ${rs.instagramUrl || profile.instagram}`);

  const taxItems: string[] = [];
  if ((rs ? rs.showTaxNumber : false) && (rs?.taxNumber || profile.taxNumber)) {
    const label = rs?.taxLabel || profile.taxLabel || 'الرقم الضريبي';
    taxItems.push(`${label}: ${rs?.taxNumber || profile.taxNumber}`);
  }
  if ((rs ? rs.showCrNumber : false) && (rs?.crNumber || profile.crNumber)) taxItems.push(`س.ت: ${rs?.crNumber || profile.crNumber}`);
  if ((rs ? rs.showVatNumber : false) && (rs?.vatNumber || profile.vatNumber)) taxItems.push(`ض.ق.م: ${rs?.vatNumber || profile.vatNumber}`);

  const showHeaderNote = rs ? rs.showHeaderNote : true;
  const headerNoteText = rs?.headerNote || profile.receiptHeaderNote;

  const showOrderNumber = rs ? rs.showOrderNumber : true;
  const showDate = rs ? rs.showDate : true;
  const showTime = rs ? rs.showTime : true;
  const showCashier = rs ? rs.showCashier : true;
  const showCustomer = rs ? rs.showCustomer : true;
  const showTable = rs ? rs.showTable : true;
  const showOrderType = rs ? rs.showOrderType : true;
  const showBranch = rs ? rs.showBranch : true;

  const showSubtotal = rs ? rs.showSubtotal : true;
  const showDiscount = rs ? rs.showDiscount : true;
  const showTax = rs ? Boolean(rs.showTax) : false;
  const showServiceCharge = rs ? Boolean(rs.showServiceCharge) : false;
  const showDeliveryFee = rs ? rs.showDeliveryFee : true;
  const showTotal = rs ? rs.showTotal : true;

  const showPaymentMethod = rs ? rs.showPaymentMethod : true;
  const showPaidAmount = rs ? rs.showPaidAmount : true;
  const showChange = rs ? rs.showChange : true;
  const showRemaining = rs ? rs.showRemaining : false;

  const showFooter = rs ? rs.showFooter : true;
  const footerAr = rs?.footerMessageArabic || rs?.footerMessage || profile.receiptFooterNote;
  const footerEn = rs?.footerMessageEnglish;

  const itemsRows = order.items
    .map((item) => {
      const offerComponentsHtml =
        item.itemType === 'offer' && item.offerComponents && item.offerComponents.length > 0
          ? `<div style="font-size: ${px(is58mm ? 9 : 10)}; color: #222; padding-right: 6px; margin-top: 2px;">
              <div style="font-weight: 800;">محتويات العرض:</div>
              ${item.offerComponents
                .map((comp) => {
                  const totalCompQty = roundQty((Number(comp.quantity) || 0) * item.quantity);
                  return `<div>• ${comp.productNameAr} × ${totalCompQty}</div>`;
                })
                .join('')}
            </div>`
          : '';

      const modifiersHtml =
        item.selectedModifiers && item.selectedModifiers.length > 0
          ? `<div style="font-size: ${px(is58mm ? 9 : 10)}; color: #333; padding-right: 6px; margin-top: 1px;">
              ${item.selectedModifiers
                .map((m) => `<div>+ ${m.nameAr} ${m.priceDelta > 0 ? `(+${m.priceDelta.toFixed(2)} ${profile.currency})` : ''}</div>`)
                .join('')}
            </div>`
          : '';

      const notesHtml = item.notes
        ? `<div style="font-size: ${px(9.5)}; font-style: italic; color: #444; padding-right: 6px; margin-top: 1px;">
            ملاحظة: ${item.notes}
          </div>`
        : '';

      return `
        <tr style="border-bottom: 1px dashed #777;">
          <td style="padding: 3px 0; text-align: right; vertical-align: top;">
            <div style="font-weight: 700; font-size: ${px(is58mm ? 11 : 12)}; color: #000; line-height: 1.2;">
              ${item.itemType === 'offer' ? `[عرض] ${item.productNameAr}` : item.productNameAr}
            </div>
            ${offerComponentsHtml}
            ${modifiersHtml}
            ${notesHtml}
          </td>
          <td style="padding: 3px 2px; text-align: center; vertical-align: top; font-weight: 800; font-size: ${px(is58mm ? 11 : 12)}; white-space: nowrap;">
            ${item.quantity}x
          </td>
          <td style="padding: 3px 2px; text-align: center; vertical-align: top; font-size: ${px(is58mm ? 10 : 11)}; white-space: nowrap;">
            ${item.unitPrice.toFixed(2)}
          </td>
          <td style="padding: 3px 0; text-align: left; vertical-align: top; font-weight: 800; font-size: ${px(is58mm ? 11 : 12)}; white-space: nowrap;">
            ${item.itemTotal.toFixed(2)}
          </td>
        </tr>
      `;
    })
    .join('');

  const isCODUnpaid = order.paymentStatus === 'unpaid';
  const paymentsHtml = isCODUnpaid
    ? `
      <div style="padding: 4px; background: #f4f4f4; border: 1.5px dashed #000; text-align: center; margin-bottom: 3px;">
        <div style="font-weight: 900; color: #b00; font-size: ${is58mm ? '10px' : '11.5px'};">
          غير مدفوع — دفع عند الاستلام (COD)
        </div>
        <div style="font-size: ${is58mm ? '9.5px' : '10.5px'}; margin-top: 2px;">
          المطلوب سداده للمندوب: <span style="font-weight: 900;">${order.total.toFixed(2)} ${profile.currency}</span>
        </div>
      </div>
    `
    : order.payments
        .map((p) => {
          const methodLabel = getPaymentMethodLabel(p.method);
          return `
            <div style="display: flex; justify-content: space-between; font-size: ${is58mm ? '10px' : '11px'}; margin-bottom: 2px;">
              ${showPaymentMethod ? `<span>${methodLabel}${p.reference ? ` [${p.reference}]` : ''}:</span>` : '<span>تم التحصيل:</span>'}
              ${showPaidAmount ? `<span style="font-weight: 700;">${p.amount.toFixed(2)} ${profile.currency}</span>` : ''}
            </div>
          `;
        })
        .join('');

  const remainingAmount = isCODUnpaid ? order.total : Math.max(0, order.total - order.paidAmount);
  const headerAlign = rs?.receiptAlignment || 'center';

  return `
    <div class="thermal-receipt" style="${widthStyle} margin: 0 auto; padding: ${mTop}mm ${mRight}mm ${mBottom}mm ${mLeft}mm; font-family: 'Cairo', 'IBM Plex Sans Arabic', -apple-system, BlinkMacSystemFont, sans-serif; direction: rtl; text-align: right; color: #000; background: #fff; line-height: 1.35; box-sizing: border-box;">
      
      ${
        isCODUnpaid
          ? `<div style="background: #000; color: #fff; text-align: center; font-weight: 900; padding: 4px 2px; margin-bottom: 6px; font-size: ${is58mm ? '11px' : '12.5px'}; border-radius: 2px;">
              ★★★ طلب توصيل — دفع عند الاستلام (غير مدفوع) ★★★
            </div>`
          : ''
      }

      <div style="text-align: ${headerAlign}; border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 6px;">
        ${
          showLogo && profile.logoUrl
            ? `<div style="text-align: ${logoAlign}; margin-bottom: 4px;">
                <img 
                  src="${profile.logoUrl}" 
                  alt="Logo" 
                  style="max-width: ${logoWidth}px; width: 100%; height: auto; max-height: 80px; object-fit: contain; margin: ${logoMargin}; display: block; filter: grayscale(100%) contrast(125%); -webkit-filter: grayscale(100%) contrast(125%);" 
                />
              </div>`
            : ''
        }

        ${
          showRestName && restNameArabic
            ? `<div style="font-size: ${is58mm ? '15px' : '18px'}; font-weight: 900; letter-spacing: -0.5px; margin-bottom: 2px; color: #000;">
                ${restNameArabic}
              </div>`
            : ''
        }

        ${
          showEngName && restNameEnglish
            ? `<div style="font-size: ${is58mm ? '10px' : '11px'}; font-weight: 700; color: #333; margin-bottom: 2px;">
                ${restNameEnglish}
              </div>`
            : ''
        }

        ${showSlogan && sloganAr ? `<div style="font-size: 10px; font-weight: 700; color: #222; margin-bottom: 2px;">${sloganAr}</div>` : ''}
        ${showSlogan && sloganEn ? `<div style="font-size: 9.5px; color: #444; margin-bottom: 2px;">${sloganEn}</div>` : ''}
        ${showAddress && addressText ? `<div style="font-size: 10px; color: #222; margin-top: 2px;">${addressText}</div>` : ''}
        ${showPhone && activePhoneNumbers.length > 0 ? `<div style="font-size: 10px; color: #222; margin-top: 1px;">${activePhoneNumbers.join(' - ')}</div>` : ''}
        ${socialLinks.length > 0 ? `<div style="font-size: 9px; color: #333; margin-top: 2px; border-top: 1px dotted #ccc; padding-top: 2px;">${socialLinks.join(' • ')}</div>` : ''}
        ${taxItems.length > 0 ? `<div style="font-size: 9.5px; font-weight: 700; margin-top: 3px;">${taxItems.join(' | ')}</div>` : ''}
        ${showHeaderNote && headerNoteText ? `<div style="font-size: 9.5px; font-style: italic; color: #444; border-top: 1px dotted #888; margin-top: 4px; padding-top: 3px;">${headerNoteText}</div>` : ''}
      </div>

      <div style="border-bottom: 1.5px solid #000; padding-bottom: 6px; margin-bottom: 6px; font-size: ${is58mm ? '10px' : '11px'};">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px;">
          ${
            showOrderNumber
              ? `<span style="font-size: ${is58mm ? '12px' : '14px'}; font-weight: 900; background: #000; color: #fff; padding: 1px 6px; border-radius: 2px;">
                  ${order.orderNumber}
                </span>`
              : '<span></span>'
          }
          ${showOrderType ? `<span style="font-weight: 800; font-size: ${is58mm ? '10px' : '11px'};">${getOrderTypeLabel(order.type)}</span>` : ''}
        </div>

        ${
          showTable && order.tableNumber
            ? `<div style="font-size: ${is58mm ? '11px' : '12px'}; font-weight: 900; text-align: center; border: 1.5px solid #000; padding: 2px; margin: 3px 0; background: #f0f0f0;">
                ★ طاولة رقم: ${order.tableNumber} ★
              </div>`
            : ''
        }

        <div style="display: flex; justify-content: space-between; margin-top: 2px; font-size: ${is58mm ? '9.5px' : '10px'};">
          ${showDate ? `<span>التاريخ: ${orderDate}</span>` : '<span></span>'}
          ${showTime ? `<span>الوقت: ${orderTime}</span>` : '<span></span>'}
        </div>

        <div style="display: flex; justify-content: space-between; font-size: ${is58mm ? '9.5px' : '10px'}; margin-top: 2px;">
          ${showCashier ? `<span>الكاشير: ${order.cashierName || 'الرئيسي'}</span>` : '<span></span>'}
          ${showBranch ? `<span>الفرع: ${order.branchName || 'الفرع الرئيسي'}</span>` : '<span></span>'}
        </div>

        ${
          showCustomer && (order.customerName || order.customerPhone || order.deliveryAddress)
            ? `<div style="border-top: 1px dotted #777; margin-top: 3px; padding-top: 3px; font-size: ${is58mm ? '9.5px' : '10.5px'};">
                ${order.customerName ? `<div style="font-weight: 700;">العميل: ${order.customerName}</div>` : ''}
                ${order.customerPhone ? `<div>الهاتف: ${order.customerPhone}</div>` : ''}
                ${order.deliveryAddress ? `<div>العنوان: ${order.deliveryAddress}</div>` : ''}
              </div>`
            : ''
        }
      </div>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 6px;">
        <thead>
          <tr style="border-bottom: 1.5px solid #000; font-size: ${is58mm ? '10px' : '11px'}; font-weight: 800;">
            <th style="padding: 3px 0; text-align: right; width: 48%;">الصنف</th>
            <th style="padding: 3px 2px; text-align: center; width: 14%;">الكمية</th>
            <th style="padding: 3px 2px; text-align: center; width: 18%;">السعر</th>
            <th style="padding: 3px 0; text-align: left; width: 20%;">الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          ${itemsRows}
        </tbody>
      </table>

      <div style="border-top: 1.5px solid #000; border-bottom: 1.5px solid #000; padding: 4px 0; margin-bottom: 6px; font-size: ${is58mm ? '10px' : '11px'};">
        ${showSubtotal ? `<div style="display: flex; justify-content: space-between; margin-bottom: 2px;"><span>المجموع الفرعي:</span><span style="font-weight: 700;">${order.subtotal.toFixed(2)} ${profile.currency}</span></div>` : ''}
        ${showDiscount && order.discountAmount > 0 ? `<div style="display: flex; justify-content: space-between; margin-bottom: 2px;"><span>الخصم ${order.discountType === 'percent' ? `(${order.discountValue}%)` : ''}:</span><span style="font-weight: 700;">-${order.discountAmount.toFixed(2)} ${profile.currency}</span></div>` : ''}
        ${showTax ? `<div style="display: flex; justify-content: space-between; margin-bottom: 2px;"><span>${rs?.taxLabel || 'الضريبة'} (${order.taxPercent}%):</span><span style="font-weight: 700;">${order.taxAmount.toFixed(2)} ${profile.currency}</span></div>` : ''}
        ${showServiceCharge && order.serviceChargeAmount > 0 ? `<div style="display: flex; justify-content: space-between; margin-bottom: 2px;"><span>خدمة الصالة (${order.serviceChargePercent}%):</span><span style="font-weight: 700;">${order.serviceChargeAmount.toFixed(2)} ${profile.currency}</span></div>` : ''}
        ${showDeliveryFee && order.deliveryFee && order.deliveryFee > 0 ? `<div style="display: flex; justify-content: space-between; margin-bottom: 2px;"><span>رسوم التوصيل:</span><span style="font-weight: 700;">${order.deliveryFee.toFixed(2)} ${profile.currency}</span></div>` : ''}
        ${showTotal ? `<div style="display: flex; justify-content: space-between; font-size: ${is58mm ? '13px' : '15px'}; font-weight: 900; border-top: 2px solid #000; padding-top: 3px; margin-top: 3px;"><span>المجموع النهائي:</span><span>${order.total.toFixed(2)} ${profile.currency}</span></div>` : ''}
      </div>

      ${
        showPaymentMethod || showPaidAmount || showChange || showRemaining
          ? `<div style="border-bottom: 1.5px solid #000; padding-bottom: 5px; margin-bottom: 6px;">
              <div style="font-size: ${is58mm ? '9.5px' : '10px'}; font-weight: 800; margin-bottom: 3px;">تفاصيل الدفع:</div>
              ${paymentsHtml}
              ${showChange && order.changeAmount > 0 ? `<div style="display: flex; justify-content: space-between; font-size: ${is58mm ? '10px' : '11px'}; font-weight: 800; border-top: 1px dotted #000; padding-top: 2px; margin-top: 2px;"><span>الباقي للعميل:</span><span>${order.changeAmount.toFixed(2)} ${profile.currency}</span></div>` : ''}
              ${showRemaining && remainingAmount > 0 ? `<div style="display: flex; justify-content: space-between; font-size: ${is58mm ? '10px' : '11px'}; font-weight: 800; border-top: 1px dotted #000; padding-top: 2px; margin-top: 2px; color: #b00;"><span>المتبقي:</span><span>${remainingAmount.toFixed(2)} ${profile.currency}</span></div>` : ''}
            </div>`
          : ''
      }

      <div style="text-align: center; padding-top: 4px;">
        ${
          qrDataUrl && (rs ? rs.enableQrCode : true)
            ? `<div style="margin: 0 auto 4px; text-align: ${rs?.qrAlignment || 'center'};">
                <div style="display: inline-block; padding: 2px; border: 1px solid #000; background: #fff;">
                  <img src="${qrDataUrl}" alt="QR" style="width: ${rs?.qrSize || (is58mm ? 90 : 110)}px; height: ${rs?.qrSize || (is58mm ? 90 : 110)}px; display: block;" />
                </div>
                ${rs?.qrLabel ? `<div style="font-size: ${is58mm ? '9px' : '10px'}; font-weight: 700; margin-top: 3px; color: #222;">${rs.qrLabel}</div>` : ''}
              </div>`
            : ''
        }

        ${
          showFooter
            ? `<div style="margin-top: 4px;">
                ${footerAr ? `<div style="font-size: ${is58mm ? '9px' : '10px'}; font-weight: 700; color: #222; margin-bottom: 2px;">${footerAr}</div>` : ''}
                ${footerEn ? `<div style="font-size: 8.5px; color: #444; margin-bottom: 2px;">${footerEn}</div>` : ''}
              </div>`
            : ''
        }
        
        <div style="margin-top: 6px; border-top: 1px dashed #aaa; padding-top: 4px; font-size: 8px; color: #999;">
          ✂ - - - - - - - - - - - - - - - - - - - - - - - - - ✂
        </div>
      </div>

    </div>
  `;
}

export function createSampleTestOrder(): Order {
  return {
    id: `test-ord-${Date.now()}`,
    orderNumber: `#1055`,
    type: 'dine_in',
    branchId: 'branch-1',
    branchName: 'الفرع الرئيسي',
    cashierId: 'cashier-1',
    cashierName: 'كاشير التجربة',
    tableNumber: '05',
    items: [
      {
        id: 't-1',
        productId: 'p-1',
        productNameAr: 'نصف كيلو كباب ضاني بلدي مشوي ع الفحم',
        productNameEn: 'Lamb Kebab 0.5kg',
        unitPrice: 280,
        costPrice: 170,
        quantity: 1,
        selectedModifiers: [
          {
            groupId: 'grp-1',
            groupNameAr: 'درجة التسوية',
            optionId: 'opt-1',
            nameAr: 'ويل دان مشوي زيادة',
            priceDelta: 0,
          },
        ],
        itemTotal: 280,
        notes: 'مع خبز بلدي ساخن',
        kitchenStation: 'grill',
        status: 'ready',
      },
      {
        id: 't-2',
        productId: 'p-2',
        productNameAr: 'سلطة طحينة سمسم فاخرة',
        productNameEn: 'Sesame Tahini',
        unitPrice: 25,
        costPrice: 8,
        quantity: 2,
        selectedModifiers: [],
        itemTotal: 50,
        kitchenStation: 'cold',
        status: 'ready',
      },
      {
        id: 't-3',
        productId: 'p-3',
        productNameAr: 'شوربة كوارع مخلية بالليمون',
        productNameEn: 'Knuckle Soup',
        unitPrice: 95,
        costPrice: 40,
        quantity: 1,
        selectedModifiers: [],
        itemTotal: 95,
        kitchenStation: 'kitchen',
        status: 'ready',
      },
    ],
    subtotal: 425,
    discountType: 'percent',
    discountValue: 0,
    discountAmount: 0,
    taxPercent: 0,
    taxAmount: 0,
    serviceChargePercent: 0,
    serviceChargeAmount: 0,
    total: 425,
    payments: [{ method: 'cash', amount: 450 }],
    paidAmount: 450,
    changeAmount: 25,
    status: 'completed',
    channel: 'pos',
    paymentStatus: 'paid',
    printStatus: 'printed',
    createdAt: new Date().toISOString(),
  };
}
