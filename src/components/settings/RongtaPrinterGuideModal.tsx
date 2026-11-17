import React, { useState } from 'react';
import {
  Printer,
  Usb,
  Network,
  Share2,
  Cpu,
  CheckCircle2,
  Copy,
  Check,
  Wrench,
  BookOpen,
  X,
  ArrowLeft,
  ShieldCheck,
  Terminal,
  ChefHat,
  DollarSign,
  AlertTriangle,
  Sparkles,
  Monitor,
  Router,
} from 'lucide-react';
import { windowsBridge } from '../../services/windowsBridge';
import { kitchenAutoPrintService } from '../../services/kitchenAutoPrintService';
import { cashDrawer } from '../../utils/cashDrawer';
import { useToast } from '../../context/ToastContext';

interface RongtaPrinterGuideProps {
  isOpen?: boolean;
  onClose?: () => void;
  embedded?: boolean;
  receiptPrinterName?: string;
  kitchenPrinterName?: string;
}

type GuideStepId = 'overview' | 'drivers' | 'cashier_usb' | 'kitchen_lan' | 'network_sharing' | 'troubleshooting';

export const RongtaPrinterGuideModal: React.FC<RongtaPrinterGuideProps> = ({
  isOpen = true,
  onClose,
  embedded = false,
  receiptPrinterName = 'Rongta RP350 (Cashier - USB)',
  kitchenPrinterName = 'Rongta RP350 (Kitchen - LAN)',
}) => {
  const { showToast } = useToast();
  const [activeSection, setActiveSection] = useState<GuideStepId>('overview');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [completedSteps, setCompletedSteps] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('basha_rongta_setup_checklist_v1');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  if (!embedded && !isOpen) return null;

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedKey(key);
    showToast(`تم نسخ "${text}" إلى الحافظة`, 'success');
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const toggleChecklist = (id: string) => {
    setCompletedSteps((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem('basha_rongta_setup_checklist_v1', JSON.stringify(next));
      } catch {
        // ignore storage error
      }
      return next;
    });
  };

  const handleTestCashierUSB = async () => {
    const res = await windowsBridge.testPrinter(receiptPrinterName, '80mm');
    showToast(res.message, res.success ? 'success' : 'info');
  };

  const handleTestKitchenLAN = async () => {
    const ok = await kitchenAutoPrintService.testKitchenPrint();
    if (ok) {
      showToast('تم إرسال بون الاختبار لطابعة المطبخ (Rongta RP350 LAN) بنجاح', 'success');
    } else {
      showToast('تعذر الاتصال بطابعة المطبخ، يرجى مراجعة خطوات منفذ TCP/IP 9100', 'error');
    }
  };

  const handleTestDrawer = () => {
    cashDrawer.triggerOpenDrawer('Rongta Guide Test');
    showToast('تم إرسال نبضة فتح درج النقدية عبر منفذ RJ11 بطابعة الكاشير', 'success');
  };

  const sections: { id: GuideStepId; title: string; badge: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'overview', title: '1. مخطط التوصيل العام', badge: 'البداية', icon: Monitor },
    { id: 'drivers', title: '2. تثبيت التعريفات (Drivers)', badge: 'أساسي', icon: Cpu },
    { id: 'cashier_usb', title: '3. طابعة الكاشير (USB)', badge: 'USB001', icon: Usb },
    { id: 'kitchen_lan', title: '4. طابعة المطبخ (LAN)', badge: 'IP: 9100', icon: Network },
    { id: 'network_sharing', title: '5. مشاركة الطابعات بالشبكة', badge: 'Sharing', icon: Share2 },
    { id: 'troubleshooting', title: '6. فحص الأعطال السريع', badge: 'حلول', icon: Wrench },
  ];

  const completedCount = Object.values(completedSteps).filter(Boolean).length;

  const content = (
    <div className="bg-white rounded-2xl border border-[#E8DFD5] overflow-hidden shadow-xs text-right" dir="rtl">
      {/* Top Banner Header */}
      <div className="bg-gradient-to-l from-[#1F1511] via-[#2E1D16] to-[#8B1E1E] text-white p-5 border-b border-[#C59A3F]/30">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-amber-400/15 border border-amber-400/40 flex items-center justify-center text-amber-300 shrink-0 shadow-inner">
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base sm:text-lg font-black text-white">
                  دليل توصيل وتعريف طابعات Rongta RP350 في نظام Windows
                </h3>
                <span className="px-2.5 py-0.5 rounded-full bg-amber-400 text-[#1F1511] text-[11px] font-black">
                  موديل 80mm الحراري
                </span>
              </div>
              <p className="text-xs text-amber-100/90 mt-1">
                شرح تفصيلي لتوصيل طابعة الكاشير بكابل USB، وطابعة المطبخ بكابل الشبكة LAN (منفذ 9100)، وتثبيت التعريفات ومشاركة الطابعات.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="px-3 py-1.5 rounded-xl bg-black/30 border border-white/15 text-xs">
              <span className="text-gray-300">خطوات مكتملة: </span>
              <strong className="text-amber-300 font-num">{completedCount} / 8</strong>
            </div>
            {!embedded && onClose && (
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
                title="إغلاق الدليل"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        {/* Navigation Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pt-4 pb-1 mt-3 border-t border-white/10">
          {sections.map((sec) => {
            const Icon = sec.icon;
            const isActive = activeSection === sec.id;
            return (
              <button
                key={sec.id}
                type="button"
                onClick={() => setActiveSection(sec.id)}
                className={`px-3.5 py-2 rounded-xl text-xs font-extrabold whitespace-nowrap flex items-center gap-2 transition-all cursor-pointer border ${
                  isActive
                    ? 'bg-amber-400 text-[#1F1511] border-amber-300 shadow-sm scale-[1.01]'
                    : 'bg-white/10 text-white border-white/15 hover:bg-white/20'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{sec.title}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-md font-mono font-bold ${
                    isActive ? 'bg-[#1F1511]/15 text-[#1F1511]' : 'bg-black/30 text-amber-300'
                  }`}
                >
                  {sec.badge}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Body Content */}
      <div className="p-5 sm:p-6 bg-[#FAF7F2] space-y-5">
        {/* ================= SECTION 1: OVERVIEW & ARCHITECTURE ================= */}
        {activeSection === 'overview' && (
          <div className="space-y-5 animate-in fade-in">
            <div className="bg-white p-5 rounded-2xl border border-[#E8DFD5] space-y-4">
              <h4 className="text-sm font-black text-[#231610] flex items-center gap-2 border-b border-[#F0E6D8] pb-2.5">
                <Monitor className="w-4 h-4 text-[#8B1E1E]" />
                <span>خريطة توصيل الطابعتين في المطعم (Architecture Diagram)</span>
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Printer 1 Card: Cashier USB */}
                <div className="p-4 rounded-2xl bg-[#FFF8EF] border-2 border-[#D7C3A5] space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="px-2.5 py-1 rounded-lg bg-[#8B1E1E] text-white text-xs font-black flex items-center gap-1.5">
                      <Usb className="w-3.5 h-3.5" />
                      <span>الطابعة الأولى: الكاشير (USB)</span>
                    </span>
                    <span className="text-[11px] font-mono font-bold text-[#8B1E1E] bg-white px-2 py-0.5 rounded border border-[#D7C3A5]">
                      Port: USB001
                    </span>
                  </div>

                  <div className="text-xs text-[#231610] space-y-1.5 leading-relaxed">
                    <div>
                      <strong>الموديل:</strong> Rongta RP350 (80mm Thermal)
                    </div>
                    <div>
                      <strong>طريقة التوصيل:</strong> كابل USB مباشر من الطابعة إلى كمبيوتر الكاشير.
                    </div>
                    <div>
                      <strong>توصيل درج النقدية:</strong> كابل الدرج (RJ11) يركب في ظهر طابعة الكاشير في فتحة <code className="bg-white px-1.5 py-0.5 rounded border font-mono">DK / Cash Drawer</code>.
                    </div>
                    <div>
                      <strong>الوظيفة في السيستم:</strong> طباعة فاتورة العميل فور الدفع + فتح درج الكاشير تلقائياً.
                    </div>
                  </div>

                  <div className="pt-2 border-t border-[#E5DACB] flex items-center justify-between gap-2">
                    <div className="text-[11px] font-mono font-bold text-[#231610] truncate">
                      {receiptPrinterName}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleCopy('Rongta RP350 (Cashier - USB)', 'copy-cashier-overview')}
                        className="px-2.5 py-1 rounded-lg bg-white border border-[#D7C3A5] hover:bg-[#F5EFE6] text-[11px] font-bold text-[#231610] flex items-center gap-1 cursor-pointer"
                      >
                        {copiedKey === 'copy-cashier-overview' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                        <span>نسخ الاسم</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleTestCashierUSB}
                        className="px-3 py-1 rounded-lg bg-[#8B1E1E] hover:bg-[#721616] text-white text-[11px] font-bold cursor-pointer"
                      >
                        اختبار الآن
                      </button>
                    </div>
                  </div>
                </div>

                {/* Printer 2 Card: Kitchen LAN */}
                <div className="p-4 rounded-2xl bg-white border-2 border-[#C59A3F]/60 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="px-2.5 py-1 rounded-lg bg-[#1F1511] text-amber-300 text-xs font-black flex items-center gap-1.5">
                      <Network className="w-3.5 h-3.5" />
                      <span>الطابعة الثانية: المطبخ والشواية (LAN)</span>
                    </span>
                    <span className="text-[11px] font-mono font-bold text-amber-900 bg-amber-50 px-2 py-0.5 rounded border border-amber-300">
                      IP: 192.168.1.200:9100
                    </span>
                  </div>

                  <div className="text-xs text-[#231610] space-y-1.5 leading-relaxed">
                    <div>
                      <strong>الموديل:</strong> Rongta RP350 (80mm Network Ethernet)
                    </div>
                    <div>
                      <strong>طريقة التوصيل:</strong> كابل إنترنت (<code className="bg-gray-100 px-1 rounded font-mono">Cat6 RJ45</code>) من فتحة <code className="bg-gray-100 px-1 rounded font-mono">LAN</code> في ظهر الطابعة إلى الراوتر أو السويتش.
                    </div>
                    <div>
                      <strong>المسافة المسموحة:</strong> يعمل بكفاءة حتى مسافة 100 متر داخل المطبخ بدون أي تقطيع.
                    </div>
                    <div>
                      <strong>الوظيفة في السيستم:</strong> طباعة بون المطبخ والشواية تلقائياً بمجرد تحويل الطلب إلى <strong>"مؤكد"</strong> أو الدفع.
                    </div>
                  </div>

                  <div className="pt-2 border-t border-gray-200 flex items-center justify-between gap-2">
                    <div className="text-[11px] font-mono font-bold text-[#231610] truncate">
                      {kitchenPrinterName}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleCopy('Rongta RP350 (Kitchen - LAN)', 'copy-kitchen-overview')}
                        className="px-2.5 py-1 rounded-lg bg-gray-50 border border-gray-300 hover:bg-gray-100 text-[11px] font-bold text-[#231610] flex items-center gap-1 cursor-pointer"
                      >
                        {copiedKey === 'copy-kitchen-overview' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                        <span>نسخ الاسم</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleTestKitchenLAN}
                        className="px-3 py-1 rounded-lg bg-amber-800 hover:bg-amber-900 text-white text-[11px] font-bold cursor-pointer"
                      >
                        اختبار البون
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Interactive Checklist */}
              <div className="p-4 rounded-xl bg-[#FAF7F2] border border-[#E8DFD5] space-y-2.5">
                <div className="text-xs font-extrabold text-[#231610]">
                  قائمة التحقق السريعة للمهندس / مسؤول التركيب (اضغط للتعليم على ما تم إنجازه):
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {[
                    { id: 'chk-1', label: 'تثبيت تعريف Rongta RP80 / RP350 Driver على ويندوز' },
                    { id: 'chk-2', label: 'توصيل طابعة الكاشير بـ USB وتسميتها Rongta RP350 (Cashier - USB)' },
                    { id: 'chk-3', label: 'توصيل كابل درج النقدية RJ11 في ظهر طابعة الكاشير' },
                    { id: 'chk-4', label: 'توصيل طابعة المطبخ بكابل LAN في الراوتر واستخراج ورقة Self-Test' },
                    { id: 'chk-5', label: 'تثبيت IP طابعة المطبخ على 192.168.1.200 ومنفذ 9100' },
                    { id: 'chk-6', label: 'إضافة طابعة المطبخ عبر TCP/IP وتسميتها Rongta RP350 (Kitchen - LAN)' },
                    { id: 'chk-7', label: 'تفعيل مشاركة الطابعات (Printer Sharing) على الشبكة المحلية' },
                    { id: 'chk-8', label: 'طباعة فاتورة تجريبية وبون مطبخ تجريبي من داخل النظام' },
                  ].map((item) => (
                    <label
                      key={item.id}
                      onClick={() => toggleChecklist(item.id)}
                      className={`p-2.5 rounded-xl border flex items-center gap-2.5 cursor-pointer transition-all ${
                        completedSteps[item.id]
                          ? 'bg-emerald-50 border-emerald-300 text-emerald-950 font-bold'
                          : 'bg-white border-[#E5DACB] text-[#3E2723] hover:bg-[#FFF8EF]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={!!completedSteps[item.id]}
                        onChange={() => {}}
                        className="rounded text-emerald-600 w-4 h-4 pointer-events-none"
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================= SECTION 2: DRIVERS INSTALLATION ================= */}
        {activeSection === 'drivers' && (
          <div className="bg-white p-5 rounded-2xl border border-[#E8DFD5] space-y-4 animate-in fade-in">
            <h4 className="text-sm font-black text-[#231610] flex items-center gap-2 border-b border-[#F0E6D8] pb-2.5">
              <Cpu className="w-4 h-4 text-[#8B1E1E]" />
              <span>تثبيت وضبط تعريفات طابعة Rongta RP350 على ويندوز 10 / 11</span>
            </h4>

            <div className="space-y-3 text-xs text-[#231610] leading-relaxed">
              <div className="p-3.5 rounded-xl bg-[#FFF8EF] border border-[#D7C3A5] space-y-2">
                <div className="font-extrabold text-[#8B1E1E] text-sm">
                  الخطوة 1: تشغيل ملف التعريف الرسمي (Rongta Windows Driver)
                </div>
                <ol className="list-decimal pr-5 space-y-1.5">
                  <li>
                    قم بتحميل أو فتح برنامج التعريف المرفق مع الطابعة باسم:{' '}
                    <code className="bg-white px-2 py-0.5 rounded border font-mono font-bold">
                      Rongta Printer Driver V8.x / RP80 Series
                    </code>.
                  </li>
                  <li>
                    اضغط كليك يمين على ملف التثبيت واختر <strong>Run as administrator (تشغيل كمسؤول)</strong>.
                  </li>
                  <li>
                    حدد نظام التشغيل لديك (<strong>Windows 10 / Windows 11 - 64-bit</strong>).
                  </li>
                  <li>
                    من قائمة الموديلات (Printer Series)، اختر: <strong>RP80 Series</strong> أو <strong>RP350 (80mm)</strong>.
                  </li>
                </ol>
              </div>

              <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-200 space-y-2">
                <div className="font-extrabold text-[#231610] text-sm">
                  الخطوة 2: ضبط مقاس الورق والقص التلقائي ودرج النقدية داخل التعريف
                </div>
                <p className="text-gray-700">
                  بعد تثبيت التعريف، افتح <strong>Control Panel</strong> ثم <strong>Devices and Printers</strong>، واضغط كليك يمين على الطابعة واختر <strong>Printing Preferences (تفضيلات الطباعة)</strong>:
                </p>
                <ul className="list-disc pr-5 space-y-1.5">
                  <li>
                    <strong>مقاس الورق (Paper Size):</strong> اختر <code className="bg-white px-1.5 py-0.5 rounded border font-mono">80(72.1) x 297 mm</code> أو <code className="bg-white px-1.5 py-0.5 rounded border font-mono">80mm Roll Paper</code>.
                  </li>
                  <li>
                    <strong>المقص التلقائي (Auto Cutter):</strong> من تبويب <em>Device Settings</em> أو <em>Paper/Quality</em>، تأكد أن خيار <strong>Cut Paper</strong> مضبوط على <code className="bg-white px-1.5 py-0.5 rounded border font-mono">Partial Cut</code> (قص الورقة تلقائياً بعد كل فاتورة).
                  </li>
                  <li>
                    <strong>درج النقدية (Cash Drawer - لطابعة الكاشير فقط):</strong> اضبط خيار <strong>Cash Drawer</strong> على <code className="bg-white px-1.5 py-0.5 rounded border font-mono">Cash Drawer #1+#2 Before Printing</code> ليفتح الدرج تلقائياً مع خروج الفاتورة.
                  </li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* ================= SECTION 3: CASHIER PRINTER (USB) ================= */}
        {activeSection === 'cashier_usb' && (
          <div className="bg-white p-5 rounded-2xl border border-[#E8DFD5] space-y-4 animate-in fade-in">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#F0E6D8] pb-2.5">
              <h4 className="text-sm font-black text-[#231610] flex items-center gap-2">
                <Usb className="w-4 h-4 text-[#8B1E1E]" />
                <span>خطوات توصيل وضبط طابعة الكاشير (Rongta RP350 - كابل USB)</span>
              </h4>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleTestDrawer}
                  className="px-3 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <DollarSign className="w-3.5 h-3.5" />
                  <span>اختبار فتح الدرج</span>
                </button>
                <button
                  type="button"
                  onClick={handleTestCashierUSB}
                  className="px-3.5 py-1.5 rounded-xl bg-[#8B1E1E] hover:bg-[#721616] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>طباعة صفحة اختبار للكاشير</span>
                </button>
              </div>
            </div>

            <div className="space-y-3 text-xs text-[#231610] leading-relaxed">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="p-3.5 rounded-xl bg-[#FFF8EF] border border-[#D7C3A5] space-y-1.5">
                  <span className="px-2 py-0.5 rounded bg-[#8B1E1E] text-white font-black text-[11px]">
                    1. التوصيل المادي
                  </span>
                  <p className="pt-1">
                    وصّل كابل الـ <strong>USB</strong> في ظهر الطابعة وفي مدخل USB خلف كيسة الكاشير مباشرة (تجنب وصلات الـ USB Hub الخارجي لضمان ثبات الإشارة).
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-[#FFF8EF] border border-[#D7C3A5] space-y-1.5">
                  <span className="px-2 py-0.5 rounded bg-[#8B1E1E] text-white font-black text-[11px]">
                    2. تعيين المنفذ (USB Port)
                  </span>
                  <p className="pt-1">
                    افتح <strong>Printer Properties</strong> $\leftarrow$ تبويب <strong>Ports (المنافذ)</strong>، وتأكد من وضع علامة صح أمام المنفذ <code className="bg-white px-1 rounded border font-mono font-bold">USB001 (Virtual printer port for USB)</code>.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-[#FFF8EF] border border-[#D7C3A5] space-y-1.5">
                  <span className="px-2 py-0.5 rounded bg-[#8B1E1E] text-white font-black text-[11px]">
                    3. مطابقة الاسم مع السيستم
                  </span>
                  <p className="pt-1">
                    من تبويب <strong>General</strong>، انسخ الاسم المعتمد أدناه وضعه كاسم للطابعة في ويندوز ليرتبط مع السيستم تلقائياً:
                  </p>
                </div>
              </div>

              {/* Copyable Printer Name Box */}
              <div className="p-4 rounded-xl bg-[#1F1511] text-white flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span className="text-[11px] text-amber-300 block font-bold">
                    اسم طابعة الكاشير المعتمد في ويندوز والسيستم:
                  </span>
                  <code className="text-sm sm:text-base font-mono font-black text-white select-all" dir="ltr">
                    Rongta RP350 (Cashier - USB)
                  </code>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopy('Rongta RP350 (Cashier - USB)', 'usb-name')}
                  className="px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-[#1F1511] font-black text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  {copiedKey === 'usb-name' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  <span>{copiedKey === 'usb-name' ? 'تم النسخ!' : 'نسخ اسم طابعة الكاشير'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================= SECTION 4: KITCHEN PRINTER (LAN / ETHERNET) ================= */}
        {activeSection === 'kitchen_lan' && (
          <div className="bg-white p-5 rounded-2xl border border-[#E8DFD5] space-y-4 animate-in fade-in">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#F0E6D8] pb-2.5">
              <h4 className="text-sm font-black text-[#231610] flex items-center gap-2">
                <Network className="w-4 h-4 text-amber-700" />
                <span>خطوات توصيل وتعريف طابعة المطبخ عبر كابل الشبكة (Rongta RP350 - LAN)</span>
              </h4>
              <button
                type="button"
                onClick={handleTestKitchenLAN}
                className="px-3.5 py-1.5 rounded-xl bg-amber-800 hover:bg-amber-900 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <ChefHat className="w-3.5 h-3.5" />
                <span>طباعة بون مطبخ تجريبي الآن</span>
              </button>
            </div>

            <div className="space-y-4 text-xs text-[#231610] leading-relaxed">
              {/* Step A: Self Test */}
              <div className="p-4 rounded-xl bg-[#FFF8EF] border border-[#D7C3A5] space-y-2">
                <div className="font-extrabold text-[#8B1E1E] text-sm">
                  أولاً: استخراج ورقة بيانات الشبكة (Self-Test Page) من طابعة المطبخ
                </div>
                <ol className="list-decimal pr-5 space-y-1">
                  <li>وصّل كابل الشبكة (<strong>LAN RJ45</strong>) من ظهر طابعة المطبخ إلى الراوتر أو السويتش.</li>
                  <li>أغلق طابعة المطبخ من زر الباور (Power OFF).</li>
                  <li>
                    اضغط مع الاستمرار على زر سحب الورق <strong>(FEED)</strong>، وأنت ضاغط عليه شغّل الباور (Power ON) واستمر بالضغط لمدة <strong>3 ثوانٍ</strong> ثم اترك الزر.
                  </li>
                  <li>
                    ستطبع الطابعة ورقة طويلة (Self-Test)، انظر في قسم <strong>Ethernet / IP Parameters</strong> ستجد الـ IP الحالي للطابعة (غالباً <code className="bg-white px-1.5 py-0.5 rounded border font-mono">192.168.1.87</code> أو <code className="bg-white px-1.5 py-0.5 rounded border font-mono">192.168.1.200</code>).
                  </li>
                </ol>
              </div>

              {/* Step B: Static IP Parameters */}
              <div className="p-4 rounded-xl bg-gray-50 border border-gray-200 space-y-2.5">
                <div className="font-extrabold text-[#231610] text-sm">
                  ثانياً: تثبيت الـ IP الخاص بطابعة المطبخ وإضافتها في ويندوز عبر منفذ TCP/IP
                </div>
                <p className="text-gray-700">
                  على جهاز كمبيوتر الكاشير، افتح <strong>Control Panel</strong> $\leftarrow$ <strong>Devices and Printers</strong> $\leftarrow$ اضغط <strong>Add a printer (إضافة طابعة)</strong> ثم اتبع الآتي:
                </p>
                <ol className="list-decimal pr-5 space-y-1.5">
                  <li>اختر <strong>"The printer that I want isn't listed"</strong>.</li>
                  <li>اختر <strong>"Add a printer using a TCP/IP address or hostname"</strong> واضغط Next.</li>
                  <li>في خانة <strong>Device type</strong> اختر <code className="bg-white px-1.5 py-0.5 rounded border font-mono">TCP/IP Device</code>.</li>
                  <li>
                    في خانة <strong>Hostname or IP address</strong> اكتب عنوان الـ IP الثابت لطابعة المطبخ، وأزل علامة الصح من <em>Query the printer</em>:
                  </li>
                </ol>

                {/* Copyable Network Settings Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                  <div className="p-3 rounded-xl bg-white border border-[#D7C3A5] flex items-center justify-between">
                    <div>
                      <span className="text-[10px] text-gray-500 block">عنوان IP طابعة المطبخ المقترح:</span>
                      <code className="font-mono font-black text-sm text-[#8B1E1E]" dir="ltr">192.168.1.200</code>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopy('192.168.1.200', 'ip-copy')}
                      className="p-1.5 rounded-lg bg-[#FFF8EF] hover:bg-[#F5EFE6] text-[#8B1E1E] border border-[#D7C3A5] cursor-pointer"
                      title="نسخ الـ IP"
                    >
                      {copiedKey === 'ip-copy' ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>

                  <div className="p-3 rounded-xl bg-white border border-[#D7C3A5] flex items-center justify-between">
                    <div>
                      <span className="text-[10px] text-gray-500 block">بروتوكول ورقم المنفذ (RAW Port):</span>
                      <code className="font-mono font-black text-sm text-[#231610]" dir="ltr">9100</code>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopy('9100', 'port-copy')}
                      className="p-1.5 rounded-lg bg-[#FFF8EF] hover:bg-[#F5EFE6] text-[#8B1E1E] border border-[#D7C3A5] cursor-pointer"
                      title="نسخ رقم المنفذ"
                    >
                      {copiedKey === 'port-copy' ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>

                  <div className="p-3 rounded-xl bg-white border border-[#D7C3A5] flex items-center justify-between">
                    <div>
                      <span className="text-[10px] text-gray-500 block">قناع الشبكة (Subnet Mask):</span>
                      <code className="font-mono font-black text-sm text-[#231610]" dir="ltr">255.255.255.0</code>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopy('255.255.255.0', 'mask-copy')}
                      className="p-1.5 rounded-lg bg-[#FFF8EF] hover:bg-[#F5EFE6] text-[#8B1E1E] border border-[#D7C3A5] cursor-pointer"
                      title="نسخ قناع الشبكة"
                    >
                      {copiedKey === 'mask-copy' ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Copyable Kitchen Printer Name Box */}
              <div className="p-4 rounded-xl bg-[#1F1511] text-white flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span className="text-[11px] text-amber-300 block font-bold">
                    اسم طابعة المطبخ المعتمد في ويندوز والسيستم (للطباعة التلقائية عند التأكيد):
                  </span>
                  <code className="text-sm sm:text-base font-mono font-black text-white select-all" dir="ltr">
                    Rongta RP350 (Kitchen - LAN)
                  </code>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopy('Rongta RP350 (Kitchen - LAN)', 'lan-name')}
                  className="px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-[#1F1511] font-black text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  {copiedKey === 'lan-name' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  <span>{copiedKey === 'lan-name' ? 'تم النسخ!' : 'نسخ اسم طابعة المطبخ'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================= SECTION 5: WINDOWS NETWORK PRINTER SHARING ================= */}
        {activeSection === 'network_sharing' && (
          <div className="bg-white p-5 rounded-2xl border border-[#E8DFD5] space-y-4 animate-in fade-in">
            <h4 className="text-sm font-black text-[#231610] flex items-center gap-2 border-b border-[#F0E6D8] pb-2.5">
              <Share2 className="w-4 h-4 text-[#8B1E1E]" />
              <span>مشاركة الطابعات عبر الشبكة المحلية (Windows Network Printer Sharing)</span>
            </h4>

            <p className="text-xs text-[#6F4E37] leading-relaxed">
              إذا كان لديك أكثر من جهاز كاشير أو جهاز مدير في المطعم وتريد أن تطبع جميع الأجهزة على نفس طابعة الكاشير أو طابعة المطبخ، اتبع خطوات المشاركة التالية:
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-[#231610]">
              <div className="p-4 rounded-xl bg-[#FFF8EF] border border-[#D7C3A5] space-y-2">
                <div className="font-extrabold text-[#8B1E1E] text-sm">
                  1. تفعيل مركز الشبكة والمشاركة في ويندوز
                </div>
                <ol className="list-decimal pr-5 space-y-1.5 leading-relaxed">
                  <li>افتح <strong>Control Panel</strong> $\leftarrow$ <strong>Network and Sharing Center</strong>.</li>
                  <li>اضغط من القائمة الجانبية على <strong>Change advanced sharing settings</strong>.</li>
                  <li>تحت شبكة <strong>Private (الخاصة)</strong>، فعّل خيار <strong>Turn on network discovery</strong> وخيار <strong>Turn on file and printer sharing</strong>.</li>
                  <li>تحت <strong>All Networks (كل الشبكات)</strong>، اختر <strong>Turn off password protected sharing</strong> حتى لا يطلب ويندوز باسورد عند الطباعة من جهاز آخر، ثم اضغط <strong>Save changes</strong>.</li>
                </ol>
              </div>

              <div className="p-4 rounded-xl bg-gray-50 border border-gray-200 space-y-2">
                <div className="font-extrabold text-[#231610] text-sm">
                  2. تفعيل مشاركة الطابعة (Share Printer)
                </div>
                <ol className="list-decimal pr-5 space-y-1.5 leading-relaxed">
                  <li>من جهاز الكاشير الرئيسي، افتح <strong>Devices and Printers</strong>.</li>
                  <li>اضغط كليك يمين على طابعة <strong>Rongta RP350 (Cashier - USB)</strong> واختر <strong>Printer properties</strong>.</li>
                  <li>افتح تبويب <strong>Sharing (المشاركة)</strong>.</li>
                  <li>ضع علامة صح أمام <strong>Share this printer</strong> واكتب اسم المشاركة: <code className="bg-white px-1.5 py-0.5 rounded border font-mono font-bold">RP350_Cashier</code>.</li>
                  <li>على أي جهاز كمبيوتر آخر في الشبكة، اضغط <kbd className="px-1.5 py-0.5 bg-white border rounded font-mono">Win + R</kbd> واكتب <code className="bg-white px-1.5 py-0.5 rounded border font-mono" dir="ltr">\\CASHIER-PC\RP350_Cashier</code> واضغط Enter للاتصال الفوري.</li>
                </ol>
              </div>
            </div>
          </div>
        )}

        {/* ================= SECTION 6: TROUBLESHOOTING ================= */}
        {activeSection === 'troubleshooting' && (
          <div className="bg-white p-5 rounded-2xl border border-[#E8DFD5] space-y-4 animate-in fade-in">
            <h4 className="text-sm font-black text-[#231610] flex items-center gap-2 border-b border-[#F0E6D8] pb-2.5">
              <Wrench className="w-4 h-4 text-[#8B1E1E]" />
              <span>استكشاف الأخطاء وإصلاحها السريع (Troubleshooting)</span>
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 text-xs">
              <div className="p-3.5 rounded-xl bg-[#FFF8EF] border border-[#D7C3A5] space-y-1.5">
                <div className="font-extrabold text-[#8B1E1E] flex items-center gap-1.5">
                  <Terminal className="w-4 h-4" />
                  <span>1. فحص اتصال طابعة المطبخ عبر Ping</span>
                </div>
                <p className="text-gray-700 leading-relaxed">
                  للتأكد أن كابل الـ LAN واصل لطابعة المطبخ، افتح موجه الأوامر (<code className="font-mono bg-white px-1 rounded border">cmd</code>) واكتب الأمر التالي:
                </p>
                <div className="bg-[#1F1511] text-emerald-400 p-2.5 rounded-lg font-mono flex items-center justify-between" dir="ltr">
                  <span>ping 192.168.1.200 -t</span>
                  <button
                    type="button"
                    onClick={() => handleCopy('ping 192.168.1.200 -t', 'ping-cmd')}
                    className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white text-[10px] cursor-pointer"
                  >
                    نسخ
                  </button>
                </div>
                <p className="text-[11px] text-gray-500">
                  إذا ظهر <code className="font-mono">Reply from 192.168.1.200: bytes=32 time&lt;1ms</code> فالاتصال سليم 100%.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-200 space-y-1.5">
                <div className="font-extrabold text-[#231610] flex items-center gap-1.5">
                  <Wrench className="w-4 h-4 text-amber-700" />
                  <span>2. إعادة تشغيل خدمة الطباعة (Print Spooler)</span>
                </div>
                <p className="text-gray-700 leading-relaxed">
                  إذا علقت فاتورة في طابور ويندوز، افتح <code className="font-mono bg-white px-1 rounded border">cmd</code> كمسؤول (Run as Administrator) ونفّذ الأمر:
                </p>
                <div className="bg-[#1F1511] text-amber-300 p-2.5 rounded-lg font-mono flex items-center justify-between" dir="ltr">
                  <span>net stop spooler &amp;&amp; net start spooler</span>
                  <button
                    type="button"
                    onClick={() => handleCopy('net stop spooler && net start spooler', 'spooler-cmd')}
                    className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white text-[10px] cursor-pointer"
                  >
                    نسخ
                  </button>
                </div>
                <p className="text-[11px] text-gray-500">
                  يقوم هذا الأمر بتفريغ وإعادة تنشيط طابور الطباعة في ويندوز خلال ثانية واحدة.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  if (embedded) {
    return content;
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 animate-in fade-in">
      <div className="max-w-4xl w-full max-h-[92vh] overflow-y-auto rounded-2xl shadow-2xl">
        {content}
      </div>
    </div>
  );
};
