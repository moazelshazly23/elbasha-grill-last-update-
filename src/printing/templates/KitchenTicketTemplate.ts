import { KitchenTicket, Order, RestaurantProfile } from '../../types';
import { getOrderTypeLabel, RasterLineSpec } from './ReceiptTemplate';

/**
 * Kitchen Order Ticket (KOT) Template Module
 * STRICT CONTENT RULE:
 * - Header: Large bold Order Number, Order Type, and Timestamp ONLY.
 * - Body: ONLY Item Names and Quantities (+ preparation modifiers/notes).
 * - Excluded: NO logo, NO restaurant slogan/address/phone, NO prices or totals, NO cashier/customer info, NO QR code.
 */
export function generateKitchenTicketHTML(order: Order, profile: RestaurantProfile): string {
  const rs = profile.receiptSettings;
  const paperWidth = profile.kitchenPrintPaperWidth || rs?.paperWidth || profile.thermalPaperWidth || '80mm';
  const is58mm = paperWidth === '58mm';
  const widthStyle = is58mm ? 'width: 54mm; max-width: 54mm;' : 'width: 76mm; max-width: 76mm;';

  const kotFontSize = rs?.kitchenFontSize || profile.kitchenFontSize || 'large';
  const itemFontPx =
    kotFontSize === 'small'
      ? is58mm ? '13px' : '15px'
      : kotFontSize === 'medium'
      ? is58mm ? '15px' : '18px'
      : is58mm ? '17px' : '21px';

  const qtyFontPx =
    kotFontSize === 'small'
      ? is58mm ? '16px' : '19px'
      : kotFontSize === 'medium'
      ? is58mm ? '19px' : '23px'
      : is58mm ? '22px' : '27px';

  const noteFontPx = kotFontSize === 'small' ? '11px' : kotFontSize === 'medium' ? '12.5px' : '14px';

  const orderTime = new Date(order.createdAt).toLocaleTimeString('ar-EG', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
  const orderDate = new Date(order.createdAt).toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });

  const orderTypeDisplay = order.tableNumber
    ? `${getOrderTypeLabel(order.type)} — طاولة ${order.tableNumber}`
    : getOrderTypeLabel(order.type);

  const itemsHtml = order.items
    .map((item) => {
      const modHtml =
        item.selectedModifiers && item.selectedModifiers.length > 0
          ? `<div style="font-size: ${noteFontPx}; font-weight: 800; color: #000; margin-top: 3px; padding-right: 4px;">
              • ${item.selectedModifiers.map((m) => m.nameAr).join(' + ')}
            </div>`
          : '';

      const notesHtml = item.notes
        ? `<div style="font-size: ${noteFontPx}; color: #000; font-weight: 900; margin-top: 3px; padding: 2px 6px; border-right: 3px solid #000; background: #f3f3f3;">
            ملاحظة: ${item.notes}
          </div>`
        : '';

      return `
        <tr style="border-bottom: 2px dashed #000;">
          <td style="padding: 8px 2px; text-align: right; vertical-align: middle;">
            <div style="font-size: ${itemFontPx}; font-weight: 900; color: #000; line-height: 1.25;">
              ${item.productNameAr}
            </div>
            ${modHtml}
            ${notesHtml}
          </td>
          <td style="padding: 8px 2px; text-align: center; vertical-align: middle; width: 26%;">
            <div style="font-size: ${qtyFontPx}; font-weight: 900; background: #000; color: #fff; border-radius: 6px; padding: 3px 6px; line-height: 1.1; display: inline-block; min-width: 44px;">
              ${item.quantity}x
            </div>
          </td>
        </tr>
      `;
    })
    .join('');

  return `
    <div class="thermal-kitchen-ticket" style="${widthStyle} margin: 0 auto; padding: 6px 3px; font-family: 'Cairo', 'IBM Plex Sans Arabic', Tahoma, sans-serif; direction: rtl; text-align: right; color: #000; background: #fff; line-height: 1.35; box-sizing: border-box;">
      <div style="text-align: center; border-bottom: 3px solid #000; padding-bottom: 8px; margin-bottom: 8px;">
        <div style="font-size: ${is58mm ? '22px' : '28px'}; font-weight: 900; background: #000; color: #fff; padding: 4px 10px; border-radius: 4px; letter-spacing: 0.5px;">
          ${order.orderNumber}
        </div>
        <div style="font-size: ${is58mm ? '14px' : '17px'}; font-weight: 900; color: #000; margin-top: 6px;">
          ${orderTypeDisplay}
        </div>
        <div style="font-size: ${is58mm ? '11px' : '12.5px'}; font-weight: 800; color: #222; margin-top: 3px;" dir="rtl">
          ${orderDate} — ${orderTime}
        </div>
      </div>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 8px;">
        <thead>
          <tr style="border-bottom: 2.5px solid #000; font-size: ${is58mm ? '12px' : '14px'}; font-weight: 900;">
            <th style="text-align: right; padding-bottom: 4px;">الصنف</th>
            <th style="text-align: center; padding-bottom: 4px; width: 26%;">الكمية</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>

      ${
        order.notes
          ? `<div style="padding: 6px 8px; background: #f2f2f2; border: 2px solid #000; margin-bottom: 8px; font-size: ${noteFontPx}; font-weight: 900;">
              ملاحظات التحضير: ${order.notes}
            </div>`
          : ''
      }

      <div style="margin-top: 8px; border-top: 1.5px dashed #000; padding-top: 4px; text-align: center; font-size: 9px; color: #555;">
        ✂ - - - - - - - - - - - - - - - - - - - - ✂
      </div>
    </div>
  `;
}

export function buildKitchenKotRasterLines(order: Order, profile: RestaurantProfile): RasterLineSpec[] {
  const rs = profile.receiptSettings;
  const kotFontSize = rs?.kitchenFontSize || profile.kitchenFontSize || 'large';
  const itemFont = kotFontSize === 'small' ? 22 : kotFontSize === 'medium' ? 26 : 32;

  const lines: RasterLineSpec[] = [
    { text: `${order.orderNumber}`, align: 'center', bold: true, fontSize: 34, inverted: true },
    {
      text: order.tableNumber
        ? `${getOrderTypeLabel(order.type)} - طاولة ${order.tableNumber}`
        : getOrderTypeLabel(order.type),
      align: 'center',
      bold: true,
      fontSize: 24,
    },
    {
      text: `${new Date(order.createdAt).toLocaleDateString('ar-EG')} - ${new Date(order.createdAt).toLocaleTimeString('ar-EG')}`,
      align: 'center',
      bold: true,
      fontSize: 18,
    },
    { text: '', divider: true },
  ];

  order.items.forEach((it) => {
    lines.push({
      text: `[ ${it.quantity}x ]  ${it.productNameAr}`,
      align: 'right',
      bold: true,
      fontSize: itemFont,
    });
    if (it.selectedModifiers && it.selectedModifiers.length > 0) {
      lines.push({
        text: `   • ${it.selectedModifiers.map((m) => m.nameAr).join(' + ')}`,
        align: 'right',
        bold: true,
        fontSize: Math.max(18, itemFont - 6),
      });
    }
    if (it.notes) {
      lines.push({
        text: `   ملاحظة: ${it.notes}`,
        align: 'right',
        bold: true,
        fontSize: Math.max(18, itemFont - 6),
      });
    }
  });

  if (order.notes) {
    lines.push({ text: '', divider: true });
    lines.push({
      text: `ملاحظات: ${order.notes}`,
      align: 'right',
      bold: true,
      fontSize: 20,
    });
  }

  return lines;
}

export function buildKitchenKotPlainText(order: Order): string {
  const sep = '========================================';
  const sub = '----------------------------------------';
  const orderType = order.tableNumber
    ? `${getOrderTypeLabel(order.type)} | Table ${order.tableNumber}`
    : getOrderTypeLabel(order.type);

  const lines: string[] = [
    sep,
    `  KITCHEN ORDER TICKET: ${order.orderNumber}`,
    `  ${orderType}`,
    `  ${new Date(order.createdAt).toLocaleString('en-GB')}`,
    sep,
  ];

  order.items.forEach((item) => {
    lines.push(`[${item.quantity}x] ${item.productNameAr}`);
    if (item.selectedModifiers?.length) {
      lines.push(`  + ${item.selectedModifiers.map((m) => m.nameAr).join(', ')}`);
    }
    if (item.notes) {
      lines.push(`  Note: ${item.notes}`);
    }
    lines.push(sub);
  });

  if (order.notes) {
    lines.push(`ORDER NOTE: ${order.notes}`);
    lines.push(sep);
  }

  return lines.join('\n');
}

// =========================================================================
// Station-Specific Kitchen Ticket Formatters (Single Shared Kitchen Printer)
// =========================================================================

function getTicketTypeBannerAr(ticket: KitchenTicket): string {
  if (ticket.ticketType === 'CANCELLATION') return 'إلغاء تجهيز — CANCELLED';
  if (ticket.ticketType === 'MODIFICATION') return 'تعديل طلب — MODIFICATION';
  return 'أمر تحضير جديد — NEW';
}

function getActionBadgeAr(action?: 'ADD' | 'REMOVE' | 'CHANGE' | 'KEEP', qty?: number, prevQty?: number): string {
  if (action === 'ADD') return '[+ إضافة]';
  if (action === 'REMOVE') return '[- إلغاء]';
  if (action === 'CHANGE') return `[تعديل: ${prevQty ?? 0} ← ${qty ?? 0}]`;
  return '';
}

export function generateStationKitchenTicketHTML(ticket: KitchenTicket, profile: RestaurantProfile): string {
  const rs = profile.receiptSettings;
  const paperWidth = profile.kitchenPrintPaperWidth || rs?.paperWidth || profile.thermalPaperWidth || '80mm';
  const is58mm = paperWidth === '58mm';
  const widthStyle = is58mm ? 'width: 54mm; max-width: 54mm;' : 'width: 76mm; max-width: 76mm;';

  const kotFontSize = rs?.kitchenFontSize || profile.kitchenFontSize || 'large';
  const itemFontPx =
    kotFontSize === 'small'
      ? is58mm ? '13px' : '15px'
      : kotFontSize === 'medium'
      ? is58mm ? '15px' : '18px'
      : is58mm ? '17px' : '20px';

  const qtyFontPx =
    kotFontSize === 'small'
      ? is58mm ? '15px' : '18px'
      : kotFontSize === 'medium'
      ? is58mm ? '18px' : '22px'
      : is58mm ? '21px' : '25px';

  const noteFontPx = kotFontSize === 'small' ? '11px' : kotFontSize === 'medium' ? '12.5px' : '14px';
  const restaurantTitle = rs?.restaurantNameArabic || profile.name || 'مشويات الباشا';

  const timeObj = new Date(ticket.orderTime || ticket.createdAt);
  const orderTime = timeObj.toLocaleTimeString('ar-EG', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
  const orderDate = timeObj.toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });

  const orderTypeDisplay = ticket.tableNumber
    ? `${getOrderTypeLabel(ticket.orderType)} — طاولة ${ticket.tableNumber}`
    : getOrderTypeLabel(ticket.orderType);

  const isSpecialNotice = ticket.ticketType === 'MODIFICATION' || ticket.ticketType === 'CANCELLATION';
  const bannerLabel = getTicketTypeBannerAr(ticket);
  const autoCut = (rs?.kitchenAutoCut ?? profile.kitchenAutoCut) !== false;

  const itemsHtml = ticket.items
    .map((item) => {
      const actionTag =
        ticket.ticketType === 'MODIFICATION'
          ? getActionBadgeAr(item.action, item.quantity, item.previousQuantity)
          : ticket.ticketType === 'CANCELLATION'
          ? '[ملغي]'
          : '';

      const modHtml =
        item.selectedModifiers && item.selectedModifiers.length > 0
          ? `<div style="font-size: ${noteFontPx}; font-weight: 800; color: #000; margin-top: 3px; padding-right: 4px;">
              • ${item.selectedModifiers.map((m) => m.nameAr).join(' + ')}
            </div>`
          : '';

      const notesHtml = item.notes
        ? `<div style="font-size: ${noteFontPx}; color: #000; font-weight: 900; margin-top: 3px; padding: 2px 6px; border-right: 3px solid #000; background: #f3f3f3;">
            ملاحظة: ${item.notes}
          </div>`
        : '';

      const offerRefHtml = item.sourceOfferName
        ? `<div style="font-size: ${noteFontPx}; font-weight: 800; color: #000; margin-top: 2px;">
            [ضمن عرض: ${item.sourceOfferName}]
          </div>`
        : '';

      const qtyDisplay =
        item.action === 'CHANGE' && item.previousQuantity !== undefined
          ? `${item.previousQuantity}→${item.quantity}`
          : `${item.quantity}x`;

      return `
        <tr style="border-bottom: 2px dashed #000;">
          <td style="padding: 8px 2px; text-align: right; vertical-align: middle;">
            ${
              actionTag
                ? `<div style="font-size: 12px; font-weight: 900; color: #000; margin-bottom: 2px; text-decoration: underline;">${actionTag}</div>`
                : ''
            }
            <div style="font-size: ${itemFontPx}; font-weight: 900; color: #000; line-height: 1.25; ${
        ticket.ticketType === 'CANCELLATION' || item.action === 'REMOVE' ? 'text-decoration: line-through;' : ''
      }">
              ${item.productNameAr}
            </div>
            ${offerRefHtml}
            ${modHtml}
            ${notesHtml}
          </td>
          <td style="padding: 8px 2px; text-align: center; vertical-align: middle; width: 28%;">
            <div style="font-size: ${qtyFontPx}; font-weight: 900; background: #000; color: #fff; border-radius: 6px; padding: 3px 6px; line-height: 1.1; display: inline-block; min-width: 44px;">
              ${qtyDisplay}
            </div>
          </td>
        </tr>
      `;
    })
    .join('');

  return `
    <div class="thermal-kitchen-ticket station-kitchen-ticket" data-station="${ticket.stationCode}" style="${widthStyle} margin: 0 auto; padding: 6px 3px; font-family: 'Cairo', 'IBM Plex Sans Arabic', Tahoma, sans-serif; direction: rtl; text-align: right; color: #000; background: #fff; line-height: 1.35; box-sizing: border-box;">
      <div style="text-align: center; font-size: ${is58mm ? '13px' : '15px'}; font-weight: 900; border-bottom: 1.5px solid #000; padding-bottom: 4px; margin-bottom: 6px;">
        ${restaurantTitle}
      </div>

      ${
        isSpecialNotice
          ? `<div style="text-align: center; background: #000; color: #fff; font-size: ${is58mm ? '15px' : '18px'}; font-weight: 900; padding: 6px; border: 3px solid #000; margin-bottom: 6px; letter-spacing: 0.4px;">
              ⚠ ${bannerLabel} ⚠
            </div>`
          : `<div style="text-align: center; font-size: 12px; font-weight: 900; border: 1.5px solid #000; padding: 2px 4px; margin-bottom: 6px;">
              ${bannerLabel}
            </div>`
      }

      <div style="text-align: center; border: 3px solid #000; padding: 6px 4px; margin-bottom: 6px;">
        <div style="font-size: ${is58mm ? '22px' : '27px'}; font-weight: 900; line-height: 1.15;">
          محطة: ${ticket.stationNameAr}
        </div>
        <div style="font-size: ${is58mm ? '12px' : '14px'}; font-weight: 900; letter-spacing: 1px;">
          ${ticket.stationNameEn || ticket.stationCode}
        </div>
      </div>

      <div style="text-align: center; border-bottom: 3px solid #000; padding-bottom: 7px; margin-bottom: 7px;">
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px; margin-bottom: 4px;">
          <span style="font-size: ${is58mm ? '18px' : '22px'}; font-weight: 900; background: #000; color: #fff; padding: 2px 10px; border-radius: 4px;">
            ${ticket.orderNumber}
          </span>
          <span style="font-size: ${is58mm ? '14px' : '16px'}; font-weight: 900; border: 2px solid #000; padding: 2px 8px; border-radius: 4px;">
            تذكرة ${ticket.sequenceLabel}
          </span>
        </div>
        <div style="font-size: ${is58mm ? '13px' : '16px'}; font-weight: 900; color: #000;">
          ${orderTypeDisplay}
        </div>
        <div style="font-size: ${is58mm ? '11px' : '12px'}; font-weight: 800; color: #222; margin-top: 2px;" dir="rtl">
          ${orderDate} — ${orderTime}
        </div>
      </div>

      ${
        ticket.ticketType === 'CANCELLATION' && ticket.cancellationReason
          ? `<div style="border: 2px solid #000; padding: 6px; margin-bottom: 8px; font-size: ${noteFontPx}; font-weight: 900;">
              <div>سبب الإلغاء: ${ticket.cancellationReason}</div>
              ${ticket.actorUserName ? `<div style="margin-top:2px;">بواسطة: ${ticket.actorUserName}</div>` : ''}
            </div>`
          : ''
      }

      ${
        ticket.ticketType === 'MODIFICATION' && ticket.modificationSummary
          ? `<div style="border: 2px dashed #000; padding: 6px; margin-bottom: 8px; font-size: ${noteFontPx}; font-weight: 900;">
              <div>تفاصيل التعديل: ${ticket.modificationSummary}</div>
              ${ticket.actorUserName ? `<div style="margin-top:2px;">بواسطة: ${ticket.actorUserName}</div>` : ''}
            </div>`
          : ''
      }

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 8px;">
        <thead>
          <tr style="border-bottom: 2.5px solid #000; font-size: ${is58mm ? '12px' : '13px'}; font-weight: 900;">
            <th style="text-align: right; padding-bottom: 4px;">أصناف المحطة</th>
            <th style="text-align: center; padding-bottom: 4px; width: 28%;">الكمية</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>

      ${
        ticket.orderNotes
          ? `<div style="padding: 6px 8px; background: #f2f2f2; border: 2px solid #000; margin-bottom: 8px; font-size: ${noteFontPx}; font-weight: 900;">
              ملاحظات الطلب: ${ticket.orderNotes}
            </div>`
          : ''
      }

      <div style="margin-top: 10px; border-top: 2px solid #000; padding-top: 6px; text-align: center; font-size: 11px; font-weight: 900;">
        ==============================<br/>
        ${autoCut ? '✂ قص آلي — نهاية تذكرة المحطة ✂' : '======== نهاية تذكرة المحطة (قص يدوي) ========'}
      </div>
    </div>
  `;
}

export function buildStationKotRasterLines(ticket: KitchenTicket, profile: RestaurantProfile): RasterLineSpec[] {
  const rs = profile.receiptSettings;
  const kotFontSize = rs?.kitchenFontSize || profile.kitchenFontSize || 'large';
  const itemFont = kotFontSize === 'small' ? 22 : kotFontSize === 'medium' ? 26 : 30;
  const restaurantTitle = rs?.restaurantNameArabic || profile.name || 'مشويات الباشا';
  const orderTypeDisplay = ticket.tableNumber
    ? `${getOrderTypeLabel(ticket.orderType)} - طاولة ${ticket.tableNumber}`
    : getOrderTypeLabel(ticket.orderType);

  const lines: RasterLineSpec[] = [
    { text: restaurantTitle, align: 'center', bold: true, fontSize: 22 },
  ];

  if (ticket.ticketType === 'CANCELLATION') {
    lines.push({ text: '!!! إلغاء تجهيز - CANCELLED !!!', align: 'center', bold: true, fontSize: 28, inverted: true });
  } else if (ticket.ticketType === 'MODIFICATION') {
    lines.push({ text: '*** تعديل طلب - MODIFICATION ***', align: 'center', bold: true, fontSize: 26, inverted: true });
  }

  lines.push({
    text: `محطة: ${ticket.stationNameAr}`,
    align: 'center',
    bold: true,
    fontSize: 36,
    inverted: ticket.ticketType === 'NEW',
  });
  lines.push({
    text: `${ticket.stationNameEn || ticket.stationCode}`,
    align: 'center',
    bold: true,
    fontSize: 20,
  });
  lines.push({
    text: `${ticket.orderNumber}   |   تذكرة ${ticket.sequenceLabel}`,
    align: 'center',
    bold: true,
    fontSize: 28,
  });
  lines.push({ text: orderTypeDisplay, align: 'center', bold: true, fontSize: 22 });
  lines.push({
    text: `${new Date(ticket.orderTime || ticket.createdAt).toLocaleDateString('ar-EG')} - ${new Date(
      ticket.orderTime || ticket.createdAt
    ).toLocaleTimeString('ar-EG')}`,
    align: 'center',
    bold: true,
    fontSize: 18,
  });
  lines.push({ text: '', divider: true });

  if (ticket.ticketType === 'CANCELLATION' && ticket.cancellationReason) {
    lines.push({ text: `السبب: ${ticket.cancellationReason}`, align: 'right', bold: true, fontSize: 20 });
    if (ticket.actorUserName) {
      lines.push({ text: `المسؤول: ${ticket.actorUserName}`, align: 'right', bold: true, fontSize: 18 });
    }
    lines.push({ text: '', divider: true });
  }

  if (ticket.ticketType === 'MODIFICATION' && ticket.modificationSummary) {
    lines.push({ text: `التعديل: ${ticket.modificationSummary}`, align: 'right', bold: true, fontSize: 20 });
    lines.push({ text: '', divider: true });
  }

  ticket.items.forEach((it) => {
    const prefix =
      ticket.ticketType === 'MODIFICATION'
        ? `${getActionBadgeAr(it.action, it.quantity, it.previousQuantity)} `
        : ticket.ticketType === 'CANCELLATION'
        ? '[ملغي] '
        : '';
    const qtyTag =
      it.action === 'CHANGE' && it.previousQuantity !== undefined
        ? `${it.previousQuantity}→${it.quantity}`
        : `${it.quantity}x`;

    lines.push({
      text: `[ ${qtyTag} ] ${prefix}${it.productNameAr}`,
      align: 'right',
      bold: true,
      fontSize: itemFont,
    });
    if (it.sourceOfferName) {
      lines.push({
        text: `   [ضمن عرض: ${it.sourceOfferName}]`,
        align: 'right',
        bold: true,
        fontSize: Math.max(17, itemFont - 7),
      });
    }
    if (it.selectedModifiers && it.selectedModifiers.length > 0) {
      lines.push({
        text: `   • ${it.selectedModifiers.map((m) => m.nameAr).join(' + ')}`,
        align: 'right',
        bold: true,
        fontSize: Math.max(18, itemFont - 6),
      });
    }
    if (it.notes) {
      lines.push({
        text: `   ملاحظة: ${it.notes}`,
        align: 'right',
        bold: true,
        fontSize: Math.max(18, itemFont - 6),
      });
    }
  });

  if (ticket.orderNotes) {
    lines.push({ text: '', divider: true });
    lines.push({
      text: `ملاحظات الطلب: ${ticket.orderNotes}`,
      align: 'right',
      bold: true,
      fontSize: 20,
    });
  }

  lines.push({ text: '================================', align: 'center', bold: true, fontSize: 18 });
  return lines;
}

export function buildStationKotPlainText(ticket: KitchenTicket, profile: RestaurantProfile): string {
  const sep = '========================================';
  const sub = '----------------------------------------';
  const rs = profile.receiptSettings;
  const restaurantTitle = rs?.restaurantNameArabic || profile.name || 'EL BASHA GRILL';
  const orderType = ticket.tableNumber
    ? `${getOrderTypeLabel(ticket.orderType)} | Table ${ticket.tableNumber}`
    : getOrderTypeLabel(ticket.orderType);

  const lines: string[] = [
    sep,
    `  ${restaurantTitle}`,
    `  *** ${ticket.stationNameEn || ticket.stationCode} (${ticket.stationNameAr}) ***`,
    `  TICKET TYPE: ${ticket.ticketType} | SEQ: ${ticket.sequenceLabel}`,
    `  ORDER: ${ticket.orderNumber} | ${orderType}`,
    `  TIME: ${new Date(ticket.orderTime || ticket.createdAt).toLocaleString('en-GB')}`,
    sep,
  ];

  if (ticket.ticketType === 'CANCELLATION') {
    lines.push(`  [CANCELLED] REASON: ${ticket.cancellationReason || '-'}`);
    if (ticket.actorUserName) lines.push(`  BY: ${ticket.actorUserName}`);
    lines.push(sub);
  }
  if (ticket.ticketType === 'MODIFICATION' && ticket.modificationSummary) {
    lines.push(`  [MODIFICATION] ${ticket.modificationSummary}`);
    if (ticket.actorUserName) lines.push(`  BY: ${ticket.actorUserName}`);
    lines.push(sub);
  }

  ticket.items.forEach((item) => {
    const tag =
      ticket.ticketType === 'MODIFICATION'
        ? `[${item.action || 'CHANGE'}] `
        : ticket.ticketType === 'CANCELLATION'
        ? '[CANCELLED] '
        : '';
    const qtyDisplay =
      item.action === 'CHANGE' && item.previousQuantity !== undefined
        ? `${item.previousQuantity}->${item.quantity}`
        : `${item.quantity}x`;
    lines.push(`${tag}[${qtyDisplay}] ${item.productNameAr}`);
    if (item.sourceOfferName) {
      lines.push(`  [Offer: ${item.sourceOfferName}]`);
    }
    if (item.selectedModifiers?.length) {
      lines.push(`  + ${item.selectedModifiers.map((m) => m.nameAr).join(', ')}`);
    }
    if (item.notes) {
      lines.push(`  Note: ${item.notes}`);
    }
    lines.push(sub);
  });

  if (ticket.orderNotes) {
    lines.push(`ORDER NOTE: ${ticket.orderNotes}`);
  }
  lines.push(sep);
  return lines.join('\n');
}

