"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AppShell, DemoNotice, StatusBadge } from "./app-shell";
import { Icon } from "./icons";

type RoomStage = "pre" | "live" | "post" | "report" | "certificate";

const stages: Array<{
  id: RoomStage;
  index: string;
  label: string;
  source: string;
  initial: number;
  target: number;
}> = [
  { id: "pre", index: "01", label: "القياس القبلي", source: "Jotform", initial: 9, target: 12 },
  { id: "live", index: "02", label: "الأداء اللحظي", source: "AmadXR · xAPI", initial: 8, target: 12 },
  { id: "post", index: "03", label: "القياس البعدي", source: "Jotform", initial: 7, target: 12 },
  { id: "report", index: "04", label: "تقرير الأثر", source: "محرك المقياس", initial: 7, target: 12 },
  { id: "certificate", index: "05", label: "الشهادات", source: "منظومة المقياس", initial: 3, target: 7 },
];

const participants = [
  { name: "نورة سعد القحطاني", code: "AMD-7K9FQ", pre: true, live: true, post: true, certificate: true },
  { name: "سارة محمد الحربي", code: "AMD-4M8DX", pre: true, live: true, post: true, certificate: true },
  { name: "عبدالله فهد الزهراني", code: "AMD-P7C2K", pre: true, live: true, post: true, certificate: true },
  { name: "ريم علي الغامدي", code: "AMD-W9N3H", pre: true, live: true, post: false, certificate: false },
  { name: "محمد سالم القرشي", code: "AMD-R5J8T", pre: true, live: false, post: true, certificate: false },
];

function participantState(participant: typeof participants[number], stage: RoomStage) {
  if (stage === "pre") return participant.pre ? "مكتمل" : "بانتظار الدخول";
  if (stage === "live") return participant.live ? "جلسة مطابقة" : "بانتظار الجلسة";
  if (stage === "post") return participant.post ? "مكتمل" : "لم يبدأ";
  if (stage === "report") return participant.pre && participant.post ? "مطابق" : "بيانات ناقصة";
  return participant.certificate ? "مستحقة" : "غير مستحقة";
}

function toneForState(label: string): "success" | "warning" | "system" | "muted" {
  if (["مكتمل", "مطابق", "مستحقة"].includes(label)) return "success";
  if (label === "جلسة مطابقة") return "system";
  if (["بانتظار الدخول", "بانتظار الجلسة", "لم يبدأ", "بيانات ناقصة"].includes(label)) return "warning";
  return "muted";
}

function StageRail({ active, onChange }: { active: RoomStage; onChange: (stage: RoomStage) => void }) {
  return (
    <div className="stage-rail cohort-stage-rail" role="tablist" aria-label="محطات تشغيل الدفعة">
      {stages.map((stage) => {
        const isActive = stage.id === active;
        return (
          <button
            key={stage.id}
            className={`stage-tab ${isActive ? "active tone-system" : ""}`}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(stage.id)}
          >
            <span className="stage-progress" />
            <span className="stage-index">{stage.index}</span>
            <span><strong>{stage.label}</strong><small dir="auto">{stage.source}</small></span>
          </button>
        );
      })}
    </div>
  );
}

function EntryStage({ stage, received, target, onReceive }: { stage: "pre" | "post"; received: number; target: number; onReceive: () => void }) {
  const complete = received >= target;
  return (
    <div className="room-entry-stage">
      <section className="room-instruction">
        <div className="room-qr-mark"><Icon name="qr" size={74} /></div>
        <div>
          <span className="eyebrow">دخول آمن للمتدرّبين</span>
          <h3>كل متدرّب يمسح بطاقته الشخصية</h3>
          <p>لا يوجد رمز جماعي واحد؛ البطاقة الشخصية تفتح صفحة التوجيه وتختار نموذج {stage === "pre" ? "القياس القبلي" : "القياس البعدي"} المناسب تلقائيًا.</p>
          <div className="route-pattern" dir="ltr">miqyas.al-amad.com.sa/t/AMD-XXXXX</div>
          <div className="room-entry-actions">
            <button className="button button-primary" onClick={onReceive} disabled={complete}>
              <Icon name={complete ? "check" : "source"} size={17} />
              {complete ? "اكتمل استقبال الدفعة" : "محاكاة وصول نتيجة"}
            </button>
            <Link className="button button-secondary" href="/t/AMD-7K9FQ">فتح تجربة متدرّب</Link>
          </div>
        </div>
      </section>
      <section className="room-progress-panel">
        <div className="room-progress-copy">
          <div><span>النتائج المستلمة</span><strong dir="ltr">{received} / {target}</strong></div>
          <small>{complete ? "جميع المسجلين أكملوا هذه المحطة." : `متبقٍ ${target - received} من المسجلين.`}</small>
        </div>
        <div className="room-progress-track"><span style={{ width: `${Math.round(received / target * 100)}%` }} /></div>
        <div className="participant-dots" aria-label={`${received} نتائج مستلمة من ${target}`}>
          {Array.from({ length: target }, (_, index) => <i key={index} className={index < received ? "received" : ""} />)}
        </div>
      </section>
    </div>
  );
}

function LiveStage({ received, target, onReceive }: { received: number; target: number; onReceive: () => void }) {
  return (
    <div>
      <div className="room-live-metrics">
        <div><span>الجلسات المطابقة</span><strong dir="ltr">{received}/{target}</strong><small>actor مطابق للمعرّف</small></div>
        <div><span>الأحداث المستلمة</span><strong dir="ltr">86</strong><small>xAPI statements</small></div>
        <div><span>جلسات تحتاج تدخلًا</span><strong className="warning-value">1</strong><small>معرّف غير مطابق</small></div>
      </div>
      <section className="room-live-feed">
        <div className="section-title"><div><span className="eyebrow">بث الدفعة</span><h3>الأداء اللحظي للمجموعة</h3></div><StatusBadge tone="system">استقبال مباشر</StatusBadge></div>
        <div className="room-signal-grid">
          {[68, 76, 84, 72, 91, 80, 87, 74, 89, 82, 93, 78].map((height, index) => <span key={index} style={{ height: `${height}%` }} />)}
        </div>
        <button className="button button-secondary" onClick={onReceive} disabled={received >= target}><Icon name="source" size={16} />محاكاة وصول جلسة</button>
      </section>
    </div>
  );
}

function ResultStage({ stage }: { stage: "report" | "certificate" }) {
  if (stage === "certificate") {
    return (
      <div className="room-result-stage">
        <div className="room-verdict"><Icon name="certificates" size={38} /><span>جاهزة للإصدار</span><strong>3 شهادات</strong><p>يظل شرط الشهادة مبنيًا على نتيجة الاختبار البعدي التي تبلغ 80% أو أكثر.</p></div>
        <div className="room-result-actions"><Link className="button button-primary" href="/certificates">فتح إدارة الشهادات</Link><Link className="button button-secondary" href="/verify/VER-AMD-7K9FQ">معاينة التحقق</Link></div>
      </div>
    );
  }
  return (
    <div className="room-result-stage">
      <div className="room-impact-grid"><div><span>العينة القبلية</span><strong>12</strong></div><div><span>العينة البعدية</span><strong>7</strong></div><div><span>المطابقون</span><strong>7</strong></div><div><span>أدنى نتيجة</span><strong dir="ltr">5 → 8</strong></div></div>
      <div className="sample-warning"><Icon name="warning" size={18} /><span>لا يُعتمد فرق المتوسط وحده لأن العينة البعدية أصغر. التقرير يبرز رفع أدنى نتيجة وانخفاض التشتت.</span></div>
      <Link className="button button-primary" href="/reports">فتح تقرير الدفعة الكامل</Link>
    </div>
  );
}

export function CohortRoom({ cohortId }: { cohortId: string }) {
  const [activeStage, setActiveStage] = useState<RoomStage>("pre");
  const [received, setReceived] = useState<Record<RoomStage, number>>(() => Object.fromEntries(stages.map((stage) => [stage.id, stage.initial])) as Record<RoomStage, number>);
  const activeIndex = stages.findIndex((stage) => stage.id === activeStage);
  const current = stages[activeIndex];
  const percentage = Math.round(received[activeStage] / current.target * 100);
  const advance = () => setActiveStage(stages[Math.min(stages.length - 1, activeIndex + 1)].id);
  const retreat = () => setActiveStage(stages[Math.max(0, activeIndex - 1)].id);
  const receiveOne = () => setReceived((value) => ({ ...value, [activeStage]: Math.min(current.target, value[activeStage] + 1) }));
  const visibleParticipants = useMemo(() => participants.map((participant) => ({ ...participant, state: participantState(participant, activeStage) })), [activeStage]);

  return (
    <AppShell title="تشغيل الدفعة">
      <div className="cohort-room-header">
        <div>
          <div className="breadcrumb-row"><Link href="/dashboard">الملخص</Link><Icon name="chevron" size={14} /><span>تشغيل الدفعة</span></div>
          <span className="eyebrow">غرفة الاختبار الجماعي</span>
          <h1>دفعة نبض الأمد · يوليو 2026</h1>
          <p>شاشة المشرف لمتابعة دخول المجموعة واكتمال القياس والأداء والتقارير.</p>
        </div>
        <div className="cohort-room-status"><span className="signal-dot" /><span><small>حالة الغرفة</small><strong>مفتوحة · {current.label}</strong></span></div>
      </div>
      <DemoNotice />

      <section className="cohort-overview" aria-label="ملخص الدفعة">
        <div><span>رمز الدفعة</span><strong className="mono" dir="ltr">{cohortId.toUpperCase()}</strong></div>
        <div><span>المسجلون</span><strong>12</strong></div>
        <div><span>المحطة الحالية</span><strong>{current.index} / 05</strong></div>
        <div><span>اكتمال المحطة</span><strong>{percentage}%</strong></div>
      </section>

      <section className="cohort-run-shell">
        <header className="cohort-run-title"><div><span className="eyebrow">مسار المجموعة</span><h2>من الدخول إلى إثبات الإتقان</h2></div><StatusBadge tone={percentage === 100 ? "success" : "system"}>{percentage === 100 ? "المحطة مكتملة" : "قيد التشغيل"}</StatusBadge></header>
        <StageRail active={activeStage} onChange={setActiveStage} />
        <div className="cohort-room-grid">
          <article className="room-stage-panel">
            <header><div><span>المحطة {current.index} من 05</span><h2>{current.label}</h2><p dir="auto">المصدر: {current.source}</p></div><strong dir="ltr">{received[activeStage]} / {current.target}</strong></header>
            <div className="room-stage-content">
              {(activeStage === "pre" || activeStage === "post") && <EntryStage stage={activeStage} received={received[activeStage]} target={current.target} onReceive={receiveOne} />}
              {activeStage === "live" && <LiveStage received={received.live} target={current.target} onReceive={receiveOne} />}
              {(activeStage === "report" || activeStage === "certificate") && <ResultStage stage={activeStage} />}
            </div>
          </article>

          <aside className="participant-monitor">
            <div className="participant-monitor-head"><div><span className="eyebrow">مراقبة الحضور</span><h2>حالة المتدرّبين</h2></div><span>5 ظاهرون من 12</span></div>
            <div className="participant-list">
              {visibleParticipants.map((participant) => (
                <div key={participant.code} className="participant-row">
                  <span className="participant-avatar">{participant.name.charAt(0)}</span>
                  <span><strong>{participant.name}</strong><small className="mono" dir="ltr">{participant.code}</small></span>
                  <StatusBadge tone={toneForState(participant.state)}>{participant.state}</StatusBadge>
                  <Link href={`/trainees/${participant.code}`} aria-label={`فتح رحلة ${participant.name}`}><Icon name="chevron" size={15} /></Link>
                </div>
              ))}
            </div>
            <Link href="/trainees" className="participant-all-link">عرض جميع المسجلين <Icon name="arrow" size={15} /></Link>
          </aside>
        </div>
        <footer className="cohort-room-nav">
          <button className="button button-secondary" onClick={retreat} disabled={activeIndex === 0}>المحطة السابقة</button>
          <span>انتقل يدويًا بين المحطات لمعاينة تشغيل الدفعة.</span>
          {activeIndex < stages.length - 1 ? <button className="button button-primary" onClick={advance}>المحطة التالية <Icon name="arrow" size={16} /></button> : <button className="button button-secondary" onClick={() => setActiveStage("pre")}>إعادة التشغيل</button>}
        </footer>
      </section>
    </AppShell>
  );
}
