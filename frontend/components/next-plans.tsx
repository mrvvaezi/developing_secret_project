"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Copy, CreditCard, SkipForward, Sparkles, X } from "lucide-react";

const plans = [
  { count: "۳", price: "۵۰۰٬۰۰۰", name: "اعتراض محترمانه", line: "سه بار بگو: این یکی رو رد کنیم؟", badge: "برای شروع مذاکرات" },
  { count: "۱۰", price: "۱٬۵۰۰٬۰۰۰", name: "دی‌جیِ پشت‌پرده", line: "سلیقه از تو، تحمل از بقیه.", badge: "پیشنهاد وزارت سلیقه" },
  { count: "۲۵", price: "۳٬۰۰۰٬۰۰۰", name: "سلطانِ دکمهٔ بعدی", line: "آهنگ هنوز شروع نشده، تو تصمیم گرفتی.", badge: "حق وتوی موسیقایی" },
];
const card = "6104337878780236";

export default function NextPlans({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState(1);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      element?.close();
      document.body.style.overflow = overflow;
      previousFocus?.focus();
    };
  }, []);
  async function copyCard() {
    try {
      await navigator.clipboard.writeText(card);
      setCopied(true);
      setMessage("شماره کارت کپی شد.");
    } catch {
      setMessage("کپی خودکار در دسترس نیست؛ شماره کارت را انتخاب و کپی کن.");
    }
  }
  return (
    <dialog ref={dialog} className="next-plans-modal" aria-labelledby="next-plans-title" aria-describedby="next-plans-description"
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="next-plans-content" dir="rtl">
        <button className="icon-button next-plans-close" autoFocus aria-label="بستن پنجرهٔ نکست" onClick={onClose}><X size={21} /></button>
        <div className="next-plans-heading">
          <span className="next-plans-icon"><SkipForward size={30} fill="currentColor" /></span>
          <span className="next-plans-kicker"><Sparkles size={13} /> تعرفهٔ رسمیِ بی‌حوصلگی</span>
          <h2 id="next-plans-title">سلیقه‌ات گرونه.<br /><em>نکستت هم همین‌طور!</em></h2>
          <p id="next-plans-description">از این آهنگ خوشت نیومد؟ اعتراضت وارده؛ ولی بودجه‌اش با خودته.<br />یکی از بسته‌های «تحملم تموم شده» رو انتخاب کن.</p>
        </div>
        <div className="next-plan-grid" role="group" aria-label="پلن‌های نکست">
          {plans.map((plan, index) => <button key={plan.count} className={`next-plan ${selected === index ? "is-selected" : ""}`} aria-pressed={selected === index} onClick={() => setSelected(index)}>
            <span className="next-plan-badge">{plan.badge}</span>
            <span className="next-plan-count">{plan.count}<small>نکست</small></span>
            <strong>{plan.name}</strong><span className="next-plan-line">{plan.line}</span>
            <span className="next-plan-price">{plan.price}<small>تومان</small></span>
            <span className="next-plan-choice">{selected === index ? <><Check size={14} /> انتخاب تو</> : "این بسته مال من"}</span>
          </button>)}
        </div>
        <section className="next-plan-payment" aria-label="اطلاعات کارت">
          <div className="next-payment-title"><CreditCard size={20} /><div><strong>خزانهٔ وزارتِ نکست</strong><p>بستهٔ {plans[selected].count} نکست · {plans[selected].price} تومان</p></div></div>
          <div className="next-card-number"><span dir="ltr">6104 3378 7878 0236</span><button className="icon-button" onClick={() => void copyCard()} aria-label="کپی شماره کارت">{copied ? <Check size={19} /> : <Copy size={19} />}</button></div>
          <p className="next-card-owner">به نام <strong>محمدرضا واعظی شریف آباد</strong></p>
          <p className="next-copy-status" role="status">{message}</p>
        </section>
        <p className="next-plans-note">شوخی‌مون جدیه، تعرفه‌مون شوخی! این کارت صرفاً فان است؛ واریز وجه، نکست فعال نمی‌کند.</p>
        <button className="next-plans-dismiss" onClick={onClose}>فعلاً همین آهنگ هم قشنگه، برگردیم!</button>
      </div>
    </dialog>
  );
}
