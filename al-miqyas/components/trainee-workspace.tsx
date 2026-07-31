"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppShell, DemoNotice, StatusBadge } from "./app-shell";
import { Icon } from "./icons";

type Scenario = "complete" | "incomplete" | "failed";
type StageId = "pre" | "live" | "post" | "report" | "certificate";
type Tone = "success" | "warning" | "danger" | "system" | "muted";

const stageBase: Array<{ id: StageId; index: string; label: string; source: string; note: string }> = [
  { id: "pre", index: "01", label: "القياس القبلي", source: "Jotform", note: "التقاط خط الأساس المعرفي والثقة الذاتية." },
  { id: "live", index: "02", label: "الأداء اللحظي", source: "AmadXR · xAPI", note: "قياس الأداء أثناء التجربة وربطه بالمعرّف الموحد." },
  { id: "post", index: "03", label: "القياس البعدي", source: "Jotform", note: "قياس النتيجة بعد التدريب بنفس البنود والمعرّف." },
  { id: "report", index: "04", label: "تقرير الأثر", source: "محرك المقياس", note: "ربط المصادر وعرض الفرق الفردي والجماعي." },
  { id: "certificate", index: "05", label: "الشهادة", source: "منظومة المقياس", note: "إصدار الإثبات عند بلوغ البعدي 80% أو أكثر." },
];

const events = [
  ["10:41:08", "بدأ", "التجربة الغامرة", "موثّق"],
  ["10:41:24", "تحقّق", "استجابة المصاب", "3 ثوانٍ"],
  ["10:41:37", "فعّل", "منظومة الطوارئ", "صحيح"],
  ["10:42:04", "ضبط", "عمق الضغط", "5.2 سم"],
  ["10:42:19", "ضبط", "معدّل الضغط", "112/دقيقة"],
  ["10:43:11", "أكمل", "دورة إنعاش", "دقة 89%"],
] as const;

function stageState(id: StageId, scenario: Scenario): { label: string; tone: Tone; time: string } {
  if (id === "certificate") return { label: "مستحقة", tone: "success", time: "13 يوليو · 11:30" };
  if (scenario === "failed" && id === "live") return { label: "فشل الاستقبال", tone: "danger", time: "13 يوليو · 10:41" };
  if (scenario === "failed" && id === "report") return { label: "دليل ناقص", tone: "warning", time: "محسوب جزئياً" };
  if (scenario === "incomplete" && id === "live") return { label: "بانتظار البيانات", tone: "warning", time: "لم تصل جلسة" };
  if (scenario === "incomplete" && id === "report") return { label: "دليل ناقص", tone: "warning", time: "محسوب جزئياً" };
  if (id === "live") return { label: "موثّق", tone: "system", time: "13 يوليو · 10:41" };
  if (id === "report") return { label: "محسوب", tone: "success", time: "13 يوليو · 11:29" };
  return { label: "موثّق", tone: "success", time: id === "pre" ? "13 يوليو · 09:12" : "13 يوليو · 11:28" };
}

function Metric({ label, value, unit, detail, tone = "default" }: { label: string; value: string; unit?: string; detail: string; tone?: string }) {
  return <div className={`journey-metric journey-metric-${tone}`}><span>{label}</span><div><strong dir="auto">{value}</strong>{unit && <small>{unit}</small>}</div><p>{detail}</p></div>;
}

function EvidenceHeader({ id, scenario }: { id: StageId; scenario: Scenario }) {
  const stage = stageBase.find((item) => item.id === id)!;
  const state = stageState(id, scenario);
  return <div className="evidence-header"><div><Icon name="source" size={17} /><span><small>مصدر الدليل</small><strong dir="auto">{stage.source}</strong></span></div><div><Icon name="clock" size={17} /><span><small>آخر تحديث</small><strong>{state.time}</strong></span></div><StatusBadge tone={state.tone}>{state.label}</StatusBadge></div>;
}

function LockedIdField() {
  const [scanned, setScanned] = useState(false);
  return <section className="locked-id"><div className="locked-id-head"><div><span className="eyebrow">Jotform prefill</span><h3>المعرّف يصل من البطاقة ولا يُكتب يدوياً</h3></div><button className="button button-primary" onClick={() => setScanned(true)} disabled={scanned}><Icon name={scanned ? "check" : "qr"} size={17} />{scanned ? "تم المسح" : "محاكاة مسح QR"}</button></div><div className="url-preview" dir="ltr">form.jotform.com/261781032160044?traineeId=<b>{scanned ? "AMD-7K9FQ" : "…"}</b></div><div className={`read-only-id ${scanned ? "filled" : ""}`}><span>معرّف المتدرّب</span><strong dir="ltr">{scanned ? "AMD-7K9FQ" : "— — — — —"}</strong><Icon name="lock" size={17} /></div>{scanned && <div className="inline-feedback success-feedback"><Icon name="check" size={17} />مُلئ الحقل من الرابط وقُفل للقراءة فقط.</div>}</section>;
}

function ScoreRing({ value, tone }: { value: number; tone: "muted" | "success" }) {
  return <div className={`score-ring score-ring-${tone}`} style={{ "--score": `${value * 3.6}deg` } as React.CSSProperties}><span><strong>{value}%</strong><small>{value / 10} من 10</small></span></div>;
}

function PreStage() {
  return <><LockedIdField /><div className="stage-two-column"><section className="stage-surface"><div className="stage-surface-title"><div><span className="eyebrow">خط الأساس المعرفي</span><h3>النتيجة القبلية</h3></div><ScoreRing value={70} tone="muted" /></div><div className="score-threshold"><span style={{ width: "70%" }} /><i style={{ insetInlineStart: "80%" }}><small>80%</small></i></div><p>سبع إجابات صحيحة من عشر. هذه النتيجة خط أساس ولا تمنع المتدرّبة من إكمال التدريب.</p></section><section className="stage-surface"><span className="eyebrow">الثقة الذاتية · 1 إلى 5</span><h3>متوسط قبلي 2.0</h3><div className="confidence-list">{[["أداء ضغطات صحيحة",2],["استخدام جهاز AED",1],["إدارة حالة توقف قلبي",3]].map(([label,value]) => <div key={String(label)}><span>{label}</span><i><b style={{ width: `${Number(value) * 20}%` }} /></i><strong>{value}.0</strong></div>)}</div><p>تظهر الثقة في التقرير بوصفها دليلاً إضافياً ولا تدخل في قرار الاجتياز.</p></section></div></>;
}

function LiveStage({ scenario }: { scenario: Scenario }) {
  const [visible, setVisible] = useState(0);
  const [rate, setRate] = useState(106);
  const [checked, setChecked] = useState(false);
  const tick = useRef(0);
  useEffect(() => {
    if (scenario !== "complete") return;
    const interval = window.setInterval(() => { tick.current += 1; setVisible((value) => Math.min(events.length, value + 1)); setRate((value) => Math.max(104, Math.min(116, value + (tick.current % 2 ? 2 : -1)))); }, 900);
    return () => window.clearInterval(interval);
  }, [scenario]);
  if (scenario !== "complete") return <div className={`journey-state journey-state-${scenario === "failed" ? "danger" : "warning"}`}><Icon name={scenario === "failed" ? "warning" : "clock"} size={28} /><div><h3>{scenario === "failed" ? "رُفضت جلسة الأداء اللحظي" : "بانتظار جلسة مطابقة"}</h3><p>{scenario === "failed" ? "actor.account.name لا يطابق AMD-7K9FQ. حُفظت البيانات الخام ولم تُربط بالمتدرّبة." : "لم تصل جلسة xAPI مطابقة حتى الآن. يمكن متابعة قرار الشهادة من نتيجة الاختبار البعدي."}</p><button className="button button-secondary" onClick={() => setChecked(true)}>{scenario === "failed" ? "فتح سجل الرفض" : "فحص آخر استقبال"}</button>{checked && <div className="inline-feedback warning-feedback"><Icon name="warning" size={17} />{scenario === "failed" ? "سبب الرفض: المعرّف الوارد XR-GUEST-12 لا يطابق معرّف المتدرّبة." : "آخر فحص تجريبي: لا توجد جلسة مطابقة جديدة."}</div>}</div></div>;
  return <><div className="journey-metrics"><Metric label="معدل الضغط" value={String(rate)} unit="/دقيقة" detail="النطاق 100–120" tone="success" /><Metric label="عمق الضغط" value="5.2" unit="سم" detail="النطاق 5.0–6.0" tone="success" /><Metric label="دقة القرارات" value="89%" detail="حد الكفاءة 80%" tone="system" /></div><section className="stage-surface live-chart"><div className="stage-surface-title"><div><span className="eyebrow">بث لحظي</span><h3>معدل الضغط أثناء الجلسة</h3></div><StatusBadge tone="system">يُحدّث الآن</StatusBadge></div><div className="live-band"><span style={{ height: "38%" }} /><span style={{ height: "51%" }} /><span style={{ height: "64%" }} /><span style={{ height: "77%" }} /><span style={{ height: "82%" }} /><span style={{ height: `${Math.min(90, rate - 30)}%` }} /><span style={{ height: "80%" }} /><span style={{ height: "84%" }} /></div></section><section className="stage-surface"><div className="stage-surface-title"><div><span className="eyebrow">سجل أحداث xAPI</span><h3 dir="ltr">actor.account.name = AMD-7K9FQ</h3></div><span className="data-source">بيانات تجريبية</span></div><div className="event-stream"><div className="event-stream-head"><span>الوقت</span><span>الفعل</span><span>الكائن</span><span>النتيجة</span></div>{events.slice(0, visible).reverse().map((row) => <div className="event-stream-row event-enter" key={row[0]}>{row.map((cell,index) => <span key={cell} className={index === 0 ? "mono" : ""}>{cell}</span>)}</div>)}{visible === 0 && <div className="stream-waiting">بانتظار أول حدث…</div>}</div></section></>;
}

function PostStage() {
  return <div className="stage-two-column"><section className="stage-surface"><div className="stage-surface-title"><div><span className="eyebrow">النتيجة البعدية</span><h3>تجاوزت حد الاجتياز</h3></div><ScoreRing value={90} tone="success" /></div><div className="score-threshold success"><span style={{ width: "90%" }} /><i style={{ insetInlineStart: "80%" }}><small>80%</small></i></div><p>تسع إجابات صحيحة من عشر. تستحق المتدرّبة الشهادة لأن النتيجة البعدية بلغت 90%.</p></section><section className="stage-surface"><span className="eyebrow">المقارنة المباشرة</span><h3>نمو المعرفة والثقة</h3><div className="comparison-bars"><div><span>المعرفة القبلية</span><i><b style={{ width: "70%" }} /></i><strong>70%</strong></div><div className="after"><span>المعرفة البعدية</span><i><b style={{ width: "90%" }} /></i><strong>90%</strong></div><div><span>الثقة القبلية</span><i><b style={{ width: "40%" }} /></i><strong>2.0</strong></div><div className="after"><span>الثقة البعدية</span><i><b style={{ width: "94%" }} /></i><strong>4.7</strong></div></div></section></div>;
}

function ReportStage({ scenario }: { scenario: Scenario }) {
  return <><div className="journey-metrics"><Metric label="نمو المعرفة" value="+20" unit="نقطة" detail="70% ← 90%" tone="success" /><Metric label="نمو الثقة" value="+2.7" unit="من 5" detail="2.0 ← 4.7" tone="success" /><Metric label="الأداء اللحظي" value={scenario === "complete" ? "89%" : "ناقص"} detail={scenario === "complete" ? "9 أحداث موثقة" : "لا يمنع الشهادة"} tone={scenario === "complete" ? "system" : "warning"} /></div><section className="verdict-panel"><Icon name="shield" size={34} /><div><span>الحكم المعرفي</span><h3>مجتازة · نتيجة البعدي 90%</h3><p>الأداء اللحظي والثقة يوثقان الأثر، لكنهما لا يدخلان في شرط إصدار الشهادة.</p></div></section><section className="stage-surface cohort-impact"><div className="stage-surface-title"><div><span className="eyebrow">تقرير الدفعة</span><h3>رفع أدنى نتيجة وتقليل التشتت</h3></div><span className="data-source">بيانات ميدانية · يوليو 2026</span></div><div className="journey-metrics"><Metric label="أدنى نتيجة" value="5 ← 8" detail="ارتفاع 3 نقاط" tone="success" /><Metric label="الانحراف المعياري" value="1.62 ← 0.79" detail="انخفاض 51%" tone="success" /><Metric label="المتوسط" value="8.92 ← 9.43" detail="مؤشر ثانوي" /></div><div className="sample-warning"><Icon name="warning" size={17} /><span>القبلي 12 متدرّباً والبعدي 7 فقط. يجب إظهار اختلاف العينتين قبل تفسير الأثر.</span></div><Link href="/reports" className="button button-secondary">فتح التقرير الجماعي الكامل <Icon name="arrow" size={16} /></Link></section></>;
}

function CertificateStage() {
  const [preview, setPreview] = useState(false);
  return <div className="certificate-stage"><section className="certificate-sheet"><div className="certificate-sheet-head"><div className="logo-pending large">شعار الجهة</div><span>تُشغّل بمنظومة المقياس · شركة الأمد</span></div><div className="certificate-sheet-body"><span>شهادة إتقان معتمدة</span><h2>نورة سعد القحطاني</h2><p>أتمّت بنجاح متطلبات برنامج نبض الأمد · الإنعاش القلبي الرئوي الأساسي.</p><div className="certificate-facts"><span><small>النتيجة البعدية</small><strong>90%</strong></span><span><small>حالة الاجتياز</small><strong>مجتازة</strong></span><span><small>رقم الشهادة</small><strong dir="ltr">AMD-BLS-2026-00417</strong></span></div></div><div className="certificate-sheet-foot"><div><small>رمز التحقق</small><strong dir="ltr">VER-AMD-7K9FQ</strong></div><div className="qr-placeholder"><Icon name="qr" size={38} /><span>QR فعلي بعد الربط</span></div></div></section><aside className="certificate-actions"><StatusBadge tone="success">مستحقة للإصدار</StatusBadge><h3>شرط الشهادة متحقق</h3><p>النتيجة البعدية 90%، وهي أعلى من الحد المعتمد 80%.</p><button className="button button-primary" onClick={() => setPreview(true)}>معاينة الإصدار</button><Link className="button button-secondary" href="/verify/VER-AMD-7K9FQ">فتح صفحة التحقق</Link>{preview && <div className="inline-feedback success-feedback"><Icon name="check" size={17} />المعاينة جاهزة. الإصدار الحقيقي ينتظر قاعدة البيانات ورمز تحقق عشوائياً.</div>}</aside></div>;
}

function StageContent({ id, scenario }: { id: StageId; scenario: Scenario }) {
  if (id === "pre") return <PreStage />;
  if (id === "live") return <LiveStage scenario={scenario} />;
  if (id === "post") return <PostStage />;
  if (id === "report") return <ReportStage scenario={scenario} />;
  return <CertificateStage />;
}

export function TraineeWorkspace({ traineeCode }: { traineeCode: string }) {
  const [scenario, setScenario] = useState<Scenario>("complete");
  const [activeId, setActiveId] = useState<StageId>("pre");
  const activeIndex = stageBase.findIndex((stage) => stage.id === activeId);
  const active = stageBase[activeIndex];
  const completion = useMemo(() => scenario === "complete" ? 5 : 4, [scenario]);
  const move = (direction: number) => setActiveId(stageBase[Math.max(0, Math.min(4, activeIndex + direction))].id);
  return <AppShell title="رحلة المتدرّب"><div className="trainee-page-head"><div><div className="breadcrumb-row"><Link href="/trainees">المتدرّبون</Link><Icon name="chevron" size={14} /><span dir="ltr">{traineeCode}</span></div><span className="eyebrow">دفعة يوليو 2026 · بيانات تجريبية</span><h1>نورة سعد القحطاني</h1><p>ممرضة متدرّبة · نبض الأمد · الإنعاش القلبي الرئوي الأساسي</p></div><div className="trainee-id-card"><span>المعرّف الموحد</span><strong dir="ltr">{traineeCode}</strong><Link href={`/t/${traineeCode}`}><Icon name="external" size={14} />صفحة التوجيه</Link></div></div><DemoNotice /><section className="scenario-bar"><div><strong>اختبار حالات الرحلة</strong><span>أداة مؤقتة للنسخة البصرية</span></div><div>{([['complete','رحلة مكتملة'],['incomplete','جلسة ناقصة'],['failed','مصدر مرفوض']] as const).map(([key,label]) => <button key={key} aria-pressed={scenario === key} onClick={() => setScenario(key)}>{label}</button>)}</div></section><section className="journey-shell"><div className="journey-heading"><div><span className="eyebrow">رحلة الدليل</span><h2>من خط الأساس إلى إثبات الإتقان</h2></div><span>{completion} من 5 مكتملة</span></div><div className="stage-rail" role="tablist">{stageBase.map((stage) => { const state = stageState(stage.id, scenario); return <button role="tab" aria-selected={stage.id === activeId} key={stage.id} className={`stage-tab tone-${state.tone} ${stage.id === activeId ? "active" : ""}`} onClick={() => setActiveId(stage.id)}><span className="stage-progress" /><span className="stage-index">{stage.index}</span><span><strong>{stage.label}</strong><small>{state.label}</small></span></button>; })}</div><article className="journey-panel"><header className="journey-panel-head"><div><span>المحطة {active.index} من 05</span><h2>{active.label}</h2><p>{active.note}</p></div></header><EvidenceHeader id={active.id} scenario={scenario} /><div className="journey-content"><StageContent id={active.id} scenario={scenario} /></div><footer className="journey-nav"><button className="button button-secondary" disabled={activeIndex === 0} onClick={() => move(-1)}>السابق</button><span>{active.note}</span>{activeIndex < 4 ? <button className="button button-primary" onClick={() => move(1)}>التالي <Icon name="arrow" size={16} /></button> : <button className="button button-secondary" onClick={() => setActiveId("pre")}>إعادة العرض</button>}</footer></article></section></AppShell>;
}
