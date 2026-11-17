/**
 * Typed Printing Error Taxonomy & Diagnostic Mapper
 * Ensures real Win32 spooler and LAN TCP socket failures are NEVER masked.
 */

export type PrintErrorCode =
  | 'USB_PRINTER_NOT_FOUND'
  | 'USB_INCORRECT_NAME'
  | 'USB_PRINTER_OFFLINE'
  | 'USB_PRINTER_PAUSED'
  | 'USB_PRINTER_ERROR'
  | 'USB_ACCESS_DENIED'
  | 'USB_SPOOLER_UNAVAILABLE'
  | 'USB_OPEN_PRINTER_FAILED'
  | 'USB_START_DOC_FAILED'
  | 'USB_WRITE_FAILED'
  | 'USB_HOST_NOT_WINDOWS'
  | 'USB_LABEL_PRINTER_BLOCKED'
  | 'USB_TRANSPORT_UNAVAILABLE'
  | 'LAN_INVALID_IP'
  | 'LAN_INVALID_PORT'
  | 'LAN_NETWORK_UNREACHABLE'
  | 'LAN_TIMEOUT'
  | 'LAN_CONNECTION_REFUSED'
  | 'LAN_PORT_UNAVAILABLE'
  | 'LAN_WRITE_ERROR'
  | 'LAN_DISCONNECTED'
  | 'LAN_OFFLINE_CONFIGURED'
  | 'TSPL_COMMAND_BLOCKED'
  | 'INVALID_PROTOCOL'
  | 'UNSUPPORTED_PRINTER_LANGUAGE'
  | 'DUPLICATE_PRINT_PREVENTED'
  | 'UNKNOWN_PRINT_ERROR';

export interface StructuredPrintError {
  code: PrintErrorCode;
  target: 'cashier' | 'kitchen' | 'test';
  userMessageAr: string;
  adminDetails: string;
  technicalDetails?: string;
  suggestedFixAr: string;
  isOffline: boolean;
}

export function sanitizeDiagnosticText(input: string): string {
  if (!input) return '';
  return input
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]')
    .replace(/(password|secret|token|api[_-]?key|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]');
}

export function classifyUsbError(
  rawMessage: string,
  explicitCode?: string,
  printerName?: string,
  technicalDetails?: string
): StructuredPrintError {
  const safeMsg = sanitizeDiagnosticText(rawMessage || '');
  const upper = safeMsg.toUpperCase();
  const safeTech = sanitizeDiagnosticText(technicalDetails || safeMsg);

  let code: PrintErrorCode = (explicitCode as PrintErrorCode) || 'USB_WRITE_FAILED';
  if (!explicitCode) {
    if (upper.includes('PRINTER_NOT_FOUND') || upper.includes('غير مثبتة') || upper.includes('لم يتم العثور')) {
      code = 'USB_PRINTER_NOT_FOUND';
    } else if (upper.includes('INCORRECT_NAME')) {
      code = 'USB_INCORRECT_NAME';
    } else if (upper.includes('OFFLINE') || upper.includes('غير متصلة')) {
      code = 'USB_PRINTER_OFFLINE';
    } else if (upper.includes('PAUSED') || upper.includes('متوقفة مؤقتاً')) {
      code = 'USB_PRINTER_PAUSED';
    } else if (upper.includes('ACCESS_DENIED') || upper.includes('WIN32=5')) {
      code = 'USB_ACCESS_DENIED';
    } else if (upper.includes('SPOOLER') && (upper.includes('STOPPED') || upper.includes('متوقفة'))) {
      code = 'USB_SPOOLER_UNAVAILABLE';
    } else if (upper.includes('TSPL') || upper.includes('باركود') || upper.includes('ملصقات')) {
      code = upper.includes('طابعة') ? 'USB_LABEL_PRINTER_BLOCKED' : 'TSPL_COMMAND_BLOCKED';
    } else if (upper.includes('NON_WINDOWS') || upper.includes('WINDOWS')) {
      if (upper.includes('REQUIRE') || upper.includes('تتطلب نظام تشغيل WINDOWS')) {
        code = 'USB_HOST_NOT_WINDOWS';
      }
    }
  }

  const label = printerName ? `(${printerName})` : '(USB)';
  switch (code) {
    case 'USB_PRINTER_NOT_FOUND':
    case 'USB_INCORRECT_NAME':
      return {
        code,
        target: 'cashier',
        userMessageAr: `طابعة الكاشير غير معرفة أو اسمها غير مطابق في Windows ${label}`,
        adminDetails: safeMsg || `طابعة الكاشير ${label} غير موجودة في قائمة طابعات Windows.`,
        technicalDetails: safeTech,
        suggestedFixAr: 'تأكد من تثبيت تعريف Rongta RP350 ثم اختر اسم الطابعة الدقيق من قائمة Windows في صفحة إدارة وتشخيص الطابعات.',
        isOffline: true,
      };
    case 'USB_PRINTER_OFFLINE':
      return {
        code,
        target: 'cashier',
        userMessageAr: `طابعة الكاشير USB غير متصلة (Offline) ${label}`,
        adminDetails: safeMsg,
        technicalDetails: safeTech,
        suggestedFixAr: 'افحص كابل USB وتشغيل كهرباء الطابعة، وتأكد من إزالة علامة "Use Printer Offline" من Windows.',
        isOffline: true,
      };
    case 'USB_PRINTER_PAUSED':
      return {
        code,
        target: 'cashier',
        userMessageAr: `طابعة الكاشير متوقفة مؤقتاً (Paused) في قائمة انتظار Windows ${label}`,
        adminDetails: safeMsg,
        technicalDetails: safeTech,
        suggestedFixAr: 'افتح قائمة انتظار الطابعة في Windows وأزل الإيقاف المؤقت (Resume Printing).',
        isOffline: false,
      };
    case 'USB_PRINTER_ERROR':
      return {
        code,
        target: 'cashier',
        userMessageAr: `عطل في طابعة الكاشير (نفاد الورق أو الغطاء مفتوح) ${label}`,
        adminDetails: safeMsg,
        technicalDetails: safeTech,
        suggestedFixAr: 'تأكد من وجود بكر ورق 80mm وإغلاق غطاء الطابعة بإحكام.',
        isOffline: false,
      };
    case 'USB_SPOOLER_UNAVAILABLE':
      return {
        code,
        target: 'cashier',
        userMessageAr: 'خدمة الطباعة في Windows (Print Spooler) متوقفة',
        adminDetails: safeMsg,
        technicalDetails: safeTech,
        suggestedFixAr: 'افتح Services.msc وقم بإعادة تشغيل خدمة Print Spooler.',
        isOffline: true,
      };
    case 'USB_HOST_NOT_WINDOWS':
      return {
        code,
        target: 'cashier',
        userMessageAr: 'طباعة USB المباشرة (Win32 Raw Spooler) تتطلب تشغيل البرنامج على جهاز Windows',
        adminDetails: safeMsg,
        technicalDetails: safeTech,
        suggestedFixAr: 'شغّل تطبيق سطح المكتب على Windows أو حوّل وضع الطباعة مؤقتاً إلى تعريف Windows Driver من المتصفح.',
        isOffline: true,
      };
    case 'USB_LABEL_PRINTER_BLOCKED':
    case 'TSPL_COMMAND_BLOCKED':
      return {
        code,
        target: 'cashier',
        userMessageAr: safeMsg || 'تم حظر الطباعة لوجود طابعة أو أوامر باركود TSPL غير متوافقة',
        adminDetails: safeMsg,
        technicalDetails: safeTech,
        suggestedFixAr: 'حدد طابعة الفواتير Rongta RP350 ESC/POS بدلاً من طابعة الباركود.',
        isOffline: false,
      };
    default:
      return {
        code,
        target: 'cashier',
        userMessageAr: safeMsg || `تعذرت الطباعة على طابعة الكاشير USB ${label}`,
        adminDetails: safeMsg,
        technicalDetails: safeTech,
        suggestedFixAr: 'راجع صفحة إدارة وتشخيص الطابعات وافحص اتصال USB وتعريف Rongta RP350.',
        isOffline: false,
      };
  }
}

export function classifyLanError(
  rawMessage: string,
  explicitCode?: string,
  ip?: string,
  port?: number,
  technicalDetails?: string
): StructuredPrintError {
  const safeMsg = sanitizeDiagnosticText(rawMessage || '');
  const upper = safeMsg.toUpperCase();
  const safeTech = sanitizeDiagnosticText(technicalDetails || safeMsg);
  const endpoint = `${ip || '192.168.1.200'}:${port || 9100}`;

  let code: PrintErrorCode = (explicitCode as PrintErrorCode) || 'LAN_WRITE_ERROR';
  if (!explicitCode) {
    if (upper.includes('OFFLINE') || ip === '0.0.0.0') code = 'LAN_OFFLINE_CONFIGURED';
    else if (upper.includes('ECONNREFUSED') || upper.includes('رفضت الاتصال')) code = 'LAN_CONNECTION_REFUSED';
    else if (upper.includes('ETIMEDOUT') || upper.includes('TIMEOUT') || upper.includes('مهلة')) code = 'LAN_TIMEOUT';
    else if (upper.includes('EHOSTUNREACH') || upper.includes('ENETUNREACH') || upper.includes('غير قابل للوصول')) {
      code = 'LAN_NETWORK_UNREACHABLE';
    } else if (upper.includes('INVALID') || upper.includes('EINVAL') || upper.includes('صيغة عنوان')) {
      code = 'LAN_INVALID_IP';
    } else if (upper.includes('TSPL')) {
      code = 'TSPL_COMMAND_BLOCKED';
    }
  }

  switch (code) {
    case 'LAN_INVALID_IP':
    case 'LAN_INVALID_PORT':
      return {
        code,
        target: 'kitchen',
        userMessageAr: `إعدادات عنوان الشبكة لطابعة المطبخ غير صالحة (${endpoint})`,
        adminDetails: safeMsg,
        technicalDetails: safeTech,
        suggestedFixAr: 'أدخل عنوان IPv4 صحيح ومنفذ مثل 192.168.1.200 والمنفذ 9100.',
        isOffline: true,
      };
    case 'LAN_TIMEOUT':
      return {
        code,
        target: 'kitchen',
        userMessageAr: `انتهت مهلة الاتصال بطابعة المطبخ على الشبكة (${endpoint})`,
        adminDetails: safeMsg,
        technicalDetails: safeTech,
        suggestedFixAr: 'تحقق من تشغيل طابعة المطبخ، توصيل كابل LAN/Ethernet، وتطابق نطاق IP مع الراوتر.',
        isOffline: true,
      };
    case 'LAN_CONNECTION_REFUSED':
      return {
        code,
        target: 'kitchen',
        userMessageAr: `طابعة المطبخ (${endpoint}) رفضت الاتصال بالمنفذ ${port || 9100}`,
        adminDetails: safeMsg,
        technicalDetails: safeTech,
        suggestedFixAr: 'تأكد من أن الطابعة تدعم Raw TCP Port 9100 ولا يوجد جدار حماية أو منفذ مختلف.',
        isOffline: true,
      };
    case 'LAN_NETWORK_UNREACHABLE':
      return {
        code,
        target: 'kitchen',
        userMessageAr: `تعذر الوصول لشبكة طابعة المطبخ (${endpoint})`,
        adminDetails: safeMsg,
        technicalDetails: safeTech,
        suggestedFixAr: 'افحص كابل الشبكة أو جهاز السويتش/الراوتر وتأكد من أن جهاز الكاشير في نفس الشبكة المحلية.',
        isOffline: true,
      };
    case 'LAN_OFFLINE_CONFIGURED':
      return {
        code,
        target: 'kitchen',
        userMessageAr: `طابعة المطبخ مهيأة حالياً كغير متصلة (${endpoint})`,
        adminDetails: safeMsg,
        technicalDetails: safeTech,
        suggestedFixAr: 'اضبط عنوان IP الحقيقي لطابعة المطبخ من إعدادات الطابعات.',
        isOffline: true,
      };
    case 'TSPL_COMMAND_BLOCKED':
    case 'UNSUPPORTED_PRINTER_LANGUAGE':
      return {
        code,
        target: 'kitchen',
        userMessageAr: safeMsg || 'لغة الطباعة المحددة لطابعة المطبخ غير مدعومة أو تحتوي أوامر ملصقات TSPL',
        adminDetails: safeMsg,
        technicalDetails: safeTech,
        suggestedFixAr: 'اختر بروتوكول المطبخ الصحيح (ESC/POS Raster أو ESC/POS Text أو Windows Driver) من صفحة التشخيص.',
        isOffline: false,
      };
    default:
      return {
        code,
        target: 'kitchen',
        userMessageAr: safeMsg || `تعذر الطباعة على طابعة المطبخ (${endpoint})`,
        adminDetails: safeMsg,
        technicalDetails: safeTech,
        suggestedFixAr: 'نفّذ فحص الشبكة ومنفذ TCP 9100 ثم اختبر بون المطبخ من صفحة إدارة وتشخيص الطابعات.',
        isOffline: true,
      };
  }
}
