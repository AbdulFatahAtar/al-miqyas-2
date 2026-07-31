"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "./icons";
import { StatusBadge } from "./app-shell";

const states = {
  pre: { label: "القياس القبلي جاهز", description: "تم التحقق من تسجيلك في البرنامج. الخطوة التالية هي إكمال القياس القبلي.", action: "فتح القياس القبلي", tone: "system" as const, step: 1 },
  post: { label: "القياس البعدي جاهز", description: "اكتمل القياس القبلي والتجربة التدريبية. يمكنك الآن إجراء القياس البعدي.", action: "فتح القياس البعدي", tone: "warning" as const, step: 3 },
  complete: { label: "اكتملت رحلتك", description: "وصلت جميع القياسات المطلوبة. سيظهر تقرير الأثر والشهادة للجهة المشرفة عند جاهزيتهما.", action: "لا توجد خطوة مطلوبة", tone: "success" as const, step: 5 },
  invalid: { label: "الرابط غير صالح", description: "لم نجد تسجيلاً صالحاً مرتبطاً بهذا المعرّف. راجع مشرف البرنامج ولا تفتح أي نموذج آخر.", action: "التواصل مع المشرف", tone: "danger" as const, step: 0 },
};

export function TraineeRoutingPage({ traineeCode }: { traineeCode: string }) {
  const [stateKey, setStateKey] = useState<keyof typeof states>("pre");
  const [opened, setOpened] = useState(false);
  const state = states[stateKey];
  return (
    <main className="public-page public-routing">
      <header className="public-header"><div className="public-brand"><img className="brand-mark" src="/brand/al-amad-mark.png" alt="شعار شركة الأمد" /><div><strong>منظومة المقياس</strong><small>تُشغّل بواسطة شركة الأمد</small></div></div><Link href="/login">دخول المشرفين</Link></header>
      <div className="public-content">
        <section className="routing-card">
          <div className="routing-top"><div><span className="eyebrow">بطاقة المتدرّب</span><h1>مرحباً نورة</h1><p>نبض الأمد · الإنعاش القلبي الرئوي الأساسي</p></div><div className="public-code"><small>المعرّف الموحد</small><strong dir="ltr">{traineeCode}</strong></div></div>
          <div className="public-step-rail" aria-label="تقدم رحلة القياس">{["قبلي", "لحظي", "بعدي", "أثر", "شهادة"].map((item, index) => <div key={item} className={index + 1 < state.step ? "done" : index + 1 === state.step ? "active" : ""}><span>{index + 1}</span><small>{item}</small></div>)}</div>
          <div className={`routing-state routing-${state.tone}`}><span className="routing-state-icon"><Icon name={state.tone === "danger" ? "warning" : state.tone === "success" ? "check" : "arrow"} size={24} /></span><div><StatusBadge tone={state.tone}>{state.label}</StatusBadge><h2>{state.label}</h2><p>{state.description}</p>{opened ? <div className="inline-feedback success-feedback"><Icon name="check" size={18} />تمت محاكاة فتح نموذج Jotform بالمعرّف المقفل.</div> : <button className="button button-primary" disabled={stateKey === "complete"} onClick={() => setOpened(true)}>{state.action}{stateKey !== "complete" && <Icon name="external" size={16} />}</button>}</div></div>
          <div className="privacy-note"><Icon name="lock" size={17} /><span>لن يُطلب منك كتابة المعرّف. ينتقل إلى نموذج Jotform تلقائياً ويظهر للقراءة فقط.</span></div>
        </section>
        <aside className="demo-state-panel"><span className="eyebrow">معاينة حالات الصفحة</span><p>هذه الأزرار موجودة في النسخة التجريبية فقط.</p>{(Object.keys(states) as Array<keyof typeof states>).map((key) => <button key={key} className={stateKey === key ? "active" : ""} onClick={() => { setStateKey(key); setOpened(false); }}>{states[key].label}</button>)}</aside>
      </div>
    </main>
  );
}

export function VerificationPage({ verifyCode }: { verifyCode: string }) {
  const [status, setStatus] = useState<"valid" | "revoked" | "notfound">("valid");
  return (
    <main className="verify-page">
      <header className="public-header"><div className="public-brand"><img className="brand-mark" src="/brand/al-amad-mark.png" alt="شعار شركة الأمد" /><div><strong>منظومة المقياس</strong><small>التحقق من الشهادات</small></div></div><Link href="/login">دخول المشرفين</Link></header>
      <div className="verify-wrap">
        <section className={`verification-card verify-${status}`}>
          <div className="verify-emblem"><Icon name={status === "valid" ? "shield" : "warning"} size={38} /></div>
          {status === "valid" ? <><StatusBadge tone="success">شهادة صالحة</StatusBadge><h1>تم التحقق من الشهادة</h1><p>هذه الصفحة تعرض الحد الأدنى المعتمد من البيانات العامة.</p><dl><div><dt>اسم المتدرّبة</dt><dd>نورة سعد القحطاني</dd></div><div><dt>البرنامج</dt><dd>نبض الأمد · BLS Provider</dd></div><div><dt>الجهة المصدرة</dt><dd>كلية الطب · جامعة أم القرى</dd></div><div><dt>رقم الشهادة</dt><dd dir="ltr">AMD-BLS-2026-00417</dd></div><div><dt>تاريخ الإصدار</dt><dd>13 يوليو 2026</dd></div><div><dt>رمز التحقق</dt><dd dir="ltr">{verifyCode}</dd></div></dl><button className="button button-secondary" onClick={() => window.print()}><Icon name="download" size={16} />طباعة نتيجة التحقق</button></> : status === "revoked" ? <><StatusBadge tone="danger">شهادة ملغاة</StatusBadge><h1>هذه الشهادة غير صالحة</h1><p>ألغت الجهة المصدرة الشهادة. راجع الجهة مباشرة للحصول على التفاصيل.</p><div className="public-code"><small>رمز التحقق</small><strong dir="ltr">{verifyCode}</strong></div></> : <><StatusBadge tone="warning">غير موجودة</StatusBadge><h1>تعذر العثور على الشهادة</h1><p>تحقق من الرابط أو أعد مسح رمز QR من النسخة الأصلية للشهادة.</p></>}
        </section>
        <aside className="verify-side"><div className="logo-pending large">شعار الجهة</div><span>صادرة عن</span><strong>كلية الطب · جامعة أم القرى</strong><small>تُشغّل بمنظومة المقياس · شركة الأمد</small><div className="demo-state-panel"><span className="eyebrow">معاينة الحالة</span><button className={status === "valid" ? "active" : ""} onClick={() => setStatus("valid")}>صالحة</button><button className={status === "revoked" ? "active" : ""} onClick={() => setStatus("revoked")}>ملغاة</button><button className={status === "notfound" ? "active" : ""} onClick={() => setStatus("notfound")}>غير موجودة</button></div></aside>
      </div>
    </main>
  );
}
