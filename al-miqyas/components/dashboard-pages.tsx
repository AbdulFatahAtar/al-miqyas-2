"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { AppShell, DemoNotice, PageHeader, StatusBadge } from "./app-shell";
import { Icon } from "./icons";

const trainees = [
  { name: "نورة سعد القحطاني", code: "AMD-7K9FQ", cohort: "دفعة يوليو 2026", pre: "70%", post: "90%", status: "مجتازة", complete: true },
  { name: "سارة محمد الحربي", code: "AMD-4M8DX", cohort: "دفعة يوليو 2026", pre: "80%", post: "100%", status: "مجتازة", complete: true },
  { name: "عبدالله فهد الزهراني", code: "AMD-P7C2K", cohort: "دفعة يوليو 2026", pre: "50%", post: "80%", status: "مجتاز", complete: true },
  { name: "ريم علي الغامدي", code: "AMD-W9N3H", cohort: "دفعة يوليو 2026", pre: "90%", post: "—", status: "غير مكتملة", complete: false },
  { name: "محمد سالم القرشي", code: "AMD-R5J8T", cohort: "دفعة يونيو 2026", pre: "80%", post: "70%", status: "غير مجتاز", complete: true },
];

function PrimaryButton({ children, onClick, type = "button" }: { children: ReactNode; onClick?: () => void; type?: "button" | "submit" }) {
  return <button type={type} className="button button-primary" onClick={onClick}>{children}</button>;
}

function SecondaryButton({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return <button type="button" className="button button-secondary" onClick={onClick}>{children}</button>;
}

function MetricBlock({ label, value, detail, tone = "default" }: { label: string; value: string; detail: string; tone?: string }) {
  return (
    <div className={`metric-block metric-block-${tone}`}>
      <span>{label}</span>
      <strong dir="auto">{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function SearchField({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label className="search-field">
      <span className="sr-only">بحث</span>
      <Icon name="search" size={17} />
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  );
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="modal-layer" role="presentation" onMouseDown={onClose}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head"><h2 id="modal-title">{title}</h2><button className="icon-button" aria-label="إغلاق" onClick={onClose}><Icon name="close" /></button></div>
        {children}
      </section>
    </div>
  );
}

export function DashboardPage() {
  return (
    <AppShell title="الملخص">
      <PageHeader eyebrow="الثلاثاء، 21 يوليو 2026" title="صورة التشغيل اليوم" description="ما اكتمل، وما يحتاج تدخلاً، وما أصبح قابلاً للإثبات داخل الجهة الحالية." actions={<><Link href="/cohorts/july-2026/run" className="button button-secondary"><Icon name="sessions" size={17} />تشغيل اختبار جماعي</Link><Link href="/trainees" className="button button-primary"><Icon name="plus" size={17} />تسجيل متدرّب</Link></>} />
      <DemoNotice />
      <section className="metric-strip" aria-label="مؤشرات التشغيل">
        <MetricBlock label="المتدرّبون النشطون" value="42" detail="ضمن 3 دفعات" />
        <MetricBlock label="رحلات مكتملة" value="31" detail="74% من النشطين" tone="success" />
        <MetricBlock label="بيانات تحتاج معالجة" value="4" detail="جلستان وقياسان" tone="warning" />
        <MetricBlock label="شهادات صالحة" value="28" detail="لا توجد شهادات ملغاة" />
      </section>

      <div className="dashboard-grid">
        <section className="content-section evidence-overview">
          <div className="section-title"><div><span className="eyebrow">تدفق الدليل</span><h2>دفعة نبض الأمد · يوليو 2026</h2></div><Link href="/reports">فتح التقرير <Icon name="arrow" size={15} /></Link></div>
          <div className="evidence-pipeline">
            {[
              ["Jotform", "القياس القبلي", "12/12", "success"],
              ["AmadXR · xAPI", "الأداء اللحظي", "10/12", "warning"],
              ["Jotform", "القياس البعدي", "7/12", "warning"],
              ["محرك المقياس", "تقارير مكتملة", "7/12", "system"],
            ].map(([source, label, value, tone], index) => (
              <div className="pipeline-step" key={label}>
                <div className={`pipeline-node node-${tone}`}><span>{index + 1}</span></div>
                <div><small dir="auto">{source}</small><strong>{label}</strong><span dir="ltr">{value}</span></div>
              </div>
            ))}
          </div>
          <div className="sample-warning"><Icon name="warning" size={18} /><span><strong>العينتان غير متطابقتين بعد.</strong> أجرى 12 متدرّباً القياس القبلي و7 فقط القياس البعدي؛ لذلك لا يُعرض فرق المتوسط كاستنتاج نهائي.</span></div>
        </section>

        <aside className="content-section attention-panel">
          <div className="section-title"><div><span className="eyebrow">بحاجة إلى تدخل</span><h2>4 حالات</h2></div></div>
          <Link href="/sessions"><span className="attention-icon danger"><Icon name="source" size={18} /></span><span><strong>معرّف xAPI غير مطابق</strong><small>جلسة XR-260721-02</small></span><Icon name="chevron" size={15} /></Link>
          <Link href="/trainees"><span className="attention-icon warning"><Icon name="trainees" size={18} /></span><span><strong>قياس بعدي مفقود</strong><small>3 متدرّبين</small></span><Icon name="chevron" size={15} /></Link>
          <Link href="/certificates"><span className="attention-icon system"><Icon name="certificates" size={18} /></span><span><strong>شهادتان جاهزتان للإصدار</strong><small>اجتياز معرفي موثق</small></span><Icon name="chevron" size={15} /></Link>
        </aside>
      </div>

      <section className="content-section table-section">
        <div className="section-title"><div><span className="eyebrow">آخر النشاط</span><h2>رحلات المتدرّبين</h2></div><Link href="/trainees">عرض الكل <Icon name="arrow" size={15} /></Link></div>
        <TraineeTable rows={trainees.slice(0, 4)} />
      </section>
    </AppShell>
  );
}

function TraineeTable({ rows }: { rows: typeof trainees }) {
  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead><tr><th>المتدرّب</th><th>المعرّف</th><th>الدفعة</th><th>القبلي</th><th>البعدي</th><th>الحالة</th><th><span className="sr-only">فتح</span></th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.code}>
              <td><strong>{row.name}</strong></td><td className="mono" dir="ltr">{row.code}</td><td>{row.cohort}</td><td className="numeric">{row.pre}</td><td className="numeric">{row.post}</td>
              <td><StatusBadge tone={row.status.includes("غير") ? "warning" : "success"}>{row.status}</StatusBadge></td>
              <td><Link className="table-link" href={`/trainees/${row.code}`} aria-label={`فتح رحلة ${row.name}`}><Icon name="chevron" size={16} /></Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ProgramsPage() {
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState(false);
  const submit = (event: FormEvent) => { event.preventDefault(); setOpen(false); setCreated(true); };
  return (
    <AppShell title="البرامج والدفعات">
      <PageHeader eyebrow="إدارة القياس" title="البرامج والدفعات" description="تعريف حد الاجتياز وربط نماذج القياس ومتابعة اكتمال كل دفعة." actions={<PrimaryButton onClick={() => setOpen(true)}><Icon name="plus" size={17} />برنامج جديد</PrimaryButton>} />
      {created && <div className="inline-feedback success-feedback"><Icon name="check" size={18} />أُضيف البرنامج التجريبي محلياً. لن يُحفظ بعد تحديث الصفحة قبل ربط قاعدة البيانات.</div>}
      <DemoNotice />
      <div className="program-list">
        <article className="program-row">
          <div className="program-accent" /><div className="program-main"><span className="eyebrow">برنامج نشط</span><h2>نبض الأمد · الإنعاش القلبي الرئوي الأساسي</h2><p>كلية الطب · جامعة أم القرى</p></div>
          <div className="program-meta"><span><small>حد الاجتياز</small><strong>80%</strong></span><span><small>الدفعات</small><strong>3</strong></span><span><small>المتدرّبون</small><strong>42</strong></span></div>
          <div className="program-integrations"><StatusBadge tone="success">Jotform مربوط</StatusBadge><StatusBadge tone="system">xAPI جاهز</StatusBadge></div>
          <Link className="button button-secondary" href="/trainees">إدارة البرنامج</Link>
        </article>
        <article className="program-row program-muted">
          <div className="program-accent system" /><div className="program-main"><span className="eyebrow">مسودة</span><h2>الاستجابة للطوارئ الصناعية</h2><p>أكاديمية الإتقان للتدريب</p></div>
          <div className="program-meta"><span><small>حد الاجتياز</small><strong>80%</strong></span><span><small>الدفعات</small><strong>0</strong></span><span><small>المتدرّبون</small><strong>0</strong></span></div>
          <div className="program-integrations"><StatusBadge tone="warning">ينقص نموذج بعدي</StatusBadge></div>
          <SecondaryButton onClick={() => setOpen(true)}>إكمال الإعداد</SecondaryButton>
        </article>
      </div>
      {open && <Modal title="إنشاء برنامج" onClose={() => setOpen(false)}><form className="form-stack" onSubmit={submit}><label>اسم البرنامج<input required placeholder="مثال: برنامج دعم الحياة الأساسي" /></label><div className="form-grid"><label>حد الاجتياز<input required type="number" defaultValue="80" /></label><label>رمز البرنامج<input required placeholder="BLS-2026" dir="ltr" /></label></div><label>الجهة<select defaultValue="uqu"><option value="uqu">كلية الطب · جامعة أم القرى</option><option value="academy">أكاديمية الإتقان للتدريب</option></select></label><div className="modal-actions"><SecondaryButton onClick={() => setOpen(false)}>إلغاء</SecondaryButton><PrimaryButton type="submit">إنشاء البرنامج</PrimaryButton></div></form></Modal>}
    </AppShell>
  );
}

export function TraineesPage() {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "complete" | "incomplete">("all");
  const [open, setOpen] = useState(false);
  const [added, setAdded] = useState(false);
  const filtered = useMemo(() => trainees.filter((item) => `${item.name} ${item.code}`.toLowerCase().includes(query.toLowerCase()) && (statusFilter === "all" || (statusFilter === "complete" ? item.complete : !item.complete))), [query, statusFilter]);
  const submit = (event: FormEvent) => { event.preventDefault(); setOpen(false); setAdded(true); };
  return (
    <AppShell title="المتدرّبون">
      <PageHeader eyebrow="سجل المتدرّبين" title="المتدرّبون" description="البحث بالاسم أو المعرّف الموحد، وتسجيل المتدرّبين ومتابعة اكتمال رحلتهم." actions={<PrimaryButton onClick={() => setOpen(true)}><Icon name="plus" size={17} />تسجيل متدرّب</PrimaryButton>} />
      {added && <div className="inline-feedback success-feedback"><Icon name="check" size={18} />تمت محاكاة التسجيل وإنشاء معرّف موحد. الحفظ الحقيقي يبدأ بعد ربط Supabase.</div>}
      <DemoNotice />
      <section className="content-section table-section">
        <div className="table-toolbar"><SearchField value={query} onChange={setQuery} placeholder="ابحث بالاسم أو AMD-XXXXX" /><button className="button button-secondary" onClick={() => setStatusFilter((value) => value === "all" ? "complete" : value === "complete" ? "incomplete" : "all")}><Icon name="filter" size={16} />{statusFilter === "all" ? "كل الحالات" : statusFilter === "complete" ? "الرحلات المكتملة" : "الرحلات الناقصة"}</button><span className="result-count">{filtered.length} نتائج</span></div>
        {filtered.length ? <TraineeTable rows={filtered} /> : <div className="empty-state"><Icon name="search" size={26} /><h3>لا توجد نتيجة مطابقة</h3><p>جرّب الاسم الكامل أو المعرّف بصيغة AMD-XXXXX.</p></div>}
      </section>
      {open && <Modal title="تسجيل متدرّب" onClose={() => setOpen(false)}><form className="form-stack" onSubmit={submit}><label>الاسم الكامل<input required autoComplete="name" /></label><div className="form-grid"><label>رقم الجوال<input required type="tel" dir="ltr" /></label><label>البريد الإلكتروني<input type="email" dir="ltr" /></label></div><label>البرنامج<select><option>نبض الأمد · الإنعاش القلبي الرئوي الأساسي</option></select></label><div className="read-only-field"><span>المعرّف الموحد</span><strong dir="ltr">سيُنشأ تلقائياً</strong><Icon name="lock" size={16} /></div><div className="modal-actions"><SecondaryButton onClick={() => setOpen(false)}>إلغاء</SecondaryButton><PrimaryButton type="submit">تسجيل وإنشاء QR</PrimaryButton></div></form></Modal>}
    </AppShell>
  );
}

export function SessionsPage() {
  const [selected, setSelected] = useState("XR-260721-02");
  return (
    <AppShell title="الجلسات الحية">
      <PageHeader eyebrow="AmadXR · xAPI" title="الجلسات الحية" description="مراقبة وصول الأحداث وربطها بالمتدرّب والبرنامج لحظة بلحظة." actions={<StatusBadge tone="system">استقبال مباشر</StatusBadge>} />
      <DemoNotice />
      <div className="sessions-layout">
        <aside className="session-list" aria-label="قائمة الجلسات">
          {["XR-260721-02", "XR-260721-01", "XR-260720-06"].map((id, index) => <button key={id} className={selected === id ? "selected" : ""} onClick={() => setSelected(id)}><span className={`status-pin ${index === 0 ? "system" : "success"}`} /><span><strong dir="ltr">{id}</strong><small>{index === 0 ? "تُبث الآن · 9 أحداث" : "مكتملة · 11 حدثاً"}</small></span><span className="mono">{index === 0 ? "10:41" : "09:18"}</span></button>)}
        </aside>
        <section className="content-section live-session">
          <div className="section-title"><div><span className="eyebrow">جلسة مباشرة</span><h2 dir="ltr">{selected}</h2></div><StatusBadge tone="system">تُبث الآن</StatusBadge></div>
          <div className="metric-strip compact"><MetricBlock label="المعرّف" value="AMD-7K9FQ" detail="مطابق" tone="success" /><MetricBlock label="معدل الضغط" value="112" detail="ضمن النطاق" tone="success" /><MetricBlock label="عمق الضغط" value="5.2 cm" detail="ضمن النطاق" tone="success" /></div>
          <div className="signal-chart" aria-label="رسم تجريبي لمعدل الضغط"><span style={{ height: "35%" }} /><span style={{ height: "48%" }} /><span style={{ height: "62%" }} /><span style={{ height: "72%" }} /><span style={{ height: "68%" }} /><span style={{ height: "81%" }} /><span style={{ height: "75%" }} /><span style={{ height: "84%" }} /><span style={{ height: "79%" }} /><span style={{ height: "82%" }} /></div>
          <div className="event-stream"><div className="event-stream-head"><span>الوقت</span><span>الفعل</span><span>الكائن</span><span>النتيجة</span></div>{[["10:43:11","أكمل","دورة إنعاش","دقة 89%"],["10:42:19","ضبط","معدل الضغط","112/دقيقة"],["10:42:04","ضبط","عمق الضغط","5.2 سم"],["10:41:37","فعّل","منظومة الطوارئ","صحيح"]].map((row) => <div className="event-stream-row" key={row[0]}>{row.map((cell, index) => <span key={cell} className={index === 0 ? "mono" : ""}>{cell}</span>)}</div>)}</div>
        </section>
      </div>
    </AppShell>
  );
}

export function ReportsPage() {
  const [tab, setTab] = useState<"cohort" | "individual">("cohort");
  return (
    <AppShell title="التقارير">
      <PageHeader eyebrow="محرك الأثر" title="التقارير" description="قراءة أثر التدريب مع إظهار اكتمال العينات قبل أي استنتاج." actions={<button className="button button-secondary" onClick={() => window.print()}><Icon name="download" size={16} />تصدير PDF</button>} />
      <DemoNotice />
      <div className="segmented-control" role="tablist"><button role="tab" aria-selected={tab === "cohort"} onClick={() => setTab("cohort")}>تقرير الدفعة</button><button role="tab" aria-selected={tab === "individual"} onClick={() => setTab("individual")}>تقرير فردي</button></div>
      {tab === "cohort" ? <CohortReport /> : <IndividualReport />}
    </AppShell>
  );
}

function CohortReport() {
  return <><section className="report-hero"><div><span className="eyebrow">نبض الأمد · يوليو 2026</span><h2>رفع الأضعف وتقليل تفاوت النتائج</h2><p>التحسن الأوضح ظهر في أدنى نتيجة وانخفاض التشتت، مع بقاء فرق المتوسط مؤشراً ثانوياً بسبب ارتفاع خط الأساس.</p></div><div className="report-sample"><span><small>القبلي</small><strong>12</strong></span><i /><span><small>المطابقون</small><strong>7</strong></span><i /><span><small>البعدي</small><strong>7</strong></span></div></section><div className="metric-strip"><MetricBlock label="أدنى نتيجة" value="5 ← 8" detail="ارتفاع 3 نقاط" tone="success" /><MetricBlock label="الانحراف المعياري" value="1.62 ← 0.79" detail="انخفاض 51%" tone="success" /><MetricBlock label="المتوسط" value="8.92 ← 9.43" detail="أثر سقف مرتفع" /><MetricBlock label="نسبة الاجتياز" value="100%" detail="ضمن العينة البعدية" tone="success" /></div><section className="content-section report-chart-section"><div className="section-title"><div><span className="eyebrow">مقارنة النتائج</span><h2>القبلي مقابل البعدي</h2></div><span className="data-source">بيانات ميدانية · Jotform · يوليو 2026</span></div><div className="bar-comparison"><div><span>أدنى نتيجة</span><div className="bar-row"><small>قبلي</small><i><b style={{ width: "50%" }} /></i><strong>5</strong></div><div className="bar-row after"><small>بعدي</small><i><b style={{ width: "80%" }} /></i><strong>8</strong></div></div><div><span>المتوسط</span><div className="bar-row"><small>قبلي</small><i><b style={{ width: "89.2%" }} /></i><strong>8.92</strong></div><div className="bar-row after"><small>بعدي</small><i><b style={{ width: "94.3%" }} /></i><strong>9.43</strong></div></div></div><div className="sample-warning"><Icon name="warning" size={18} /><span>هذه المقارنة تصف العينات المتاحة ولا تثبت السببية وحدها. العينة البعدية أصغر من القبلية بخمسة متدرّبين.</span></div></section><section className="content-section table-section"><div className="section-title"><div><span className="eyebrow">تفصيل المتدرّبين</span><h2>حالة المطابقة والاجتياز</h2></div></div><TraineeTable rows={trainees} /></section></>;
}

function IndividualReport() {
  return <section className="content-section individual-report"><div className="section-title"><div><span className="eyebrow">AMD-7K9FQ</span><h2>نورة سعد القحطاني</h2></div><Link href="/trainees/AMD-7K9FQ" className="button button-secondary">فتح رحلة الدليل</Link></div><div className="metric-strip"><MetricBlock label="نمو المعرفة" value="+20" detail="70% ← 90%" tone="success" /><MetricBlock label="نمو الثقة" value="+2.7" detail="2.0 ← 4.7" tone="success" /><MetricBlock label="دقة الأداء" value="89%" detail="9 أحداث xAPI" tone="system" /></div><div className="verdict-panel"><Icon name="shield" size={34} /><div><span>الحكم المعرفي</span><h3>مجتازة · نتيجة البعدي 90%</h3><p>الأداء اللحظي والثقة يوثقان أثر التجربة ولا يدخلان في قرار إصدار الشهادة.</p></div></div></section>;
}

export function CertificatesPage() {
  const [filter, setFilter] = useState("all");
  const [issued, setIssued] = useState(false);
  const rows = trainees.filter((row) => row.status.includes("مجتاز") && !row.status.includes("غير"));
  return <AppShell title="الشهادات"><PageHeader eyebrow="الإصدار والتحقق" title="الشهادات" description="إصدار الشهادات ومتابعة صلاحيتها وروابط التحقق العامة." actions={<PrimaryButton onClick={() => setIssued(true)}><Icon name="plus" size={17} />إصدار المستحقة</PrimaryButton>} />{issued && <div className="inline-feedback success-feedback"><Icon name="check" size={18} />تمت محاكاة إصدار الشهادات المستحقة. الإصدار الدائم يبدأ بعد ربط قاعدة البيانات.</div>}<DemoNotice /><section className="content-section table-section"><div className="table-toolbar"><div className="segmented-control compact-control"><button aria-pressed={filter === "all"} onClick={() => setFilter("all")}>الكل</button><button aria-pressed={filter === "valid"} onClick={() => setFilter("valid")}>صالحة</button><button aria-pressed={filter === "revoked"} onClick={() => setFilter("revoked")}>ملغاة</button></div><span className="result-count">{filter === "revoked" ? 0 : rows.length} شهادات</span></div>{filter === "revoked" ? <div className="empty-state"><Icon name="certificates" size={28} /><h3>لا توجد شهادات ملغاة</h3><p>تظهر هنا الشهادة مع سبب الإلغاء وتاريخه عند حدوثه.</p></div> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th>المتدرّب</th><th>رقم الشهادة</th><th>البرنامج</th><th>تاريخ الإصدار</th><th>الحالة</th><th>التحقق</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.code}><td><strong>{row.name}</strong><small className="table-subtext mono" dir="ltr">{row.code}</small></td><td className="mono" dir="ltr">AMD-BLS-2026-00{417 + index}</td><td>نبض الأمد BLS</td><td>13 يوليو 2026</td><td><StatusBadge tone="success">صالحة</StatusBadge></td><td><Link href={`/verify/VER-${row.code}`} className="table-action">فتح <Icon name="external" size={14} /></Link></td></tr>)}</tbody></table></div>}</section></AppShell>;
}

export function OrganizationsPage() {
  const [tab, setTab] = useState<"members" | "organizations">("members");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invited, setInvited] = useState(false);
  const submitInvite = (event: FormEvent) => { event.preventDefault(); setInviteOpen(false); setInvited(true); };
  return <AppShell title="الجهات والأعضاء"><PageHeader eyebrow="الإدارة والصلاحيات" title="الجهات والأعضاء" description="إدارة العضوية والأدوار ضمن حدود الجهة، مع عزل البيانات بين الجهات." actions={<PrimaryButton onClick={() => setInviteOpen(true)}><Icon name="plus" size={17} />دعوة عضو</PrimaryButton>} />{invited && <div className="inline-feedback success-feedback"><Icon name="check" size={18} />تمت محاكاة إرسال الدعوة. الإرسال الحقيقي يبدأ بعد ربط نظام الدخول.</div>}<DemoNotice /><div className="segmented-control"><button aria-pressed={tab === "members"} onClick={() => setTab("members")}>أعضاء الجهة</button><button aria-pressed={tab === "organizations"} onClick={() => setTab("organizations")}>الجهات</button></div>{tab === "members" ? <section className="content-section table-section"><div className="data-table-wrap"><table className="data-table"><thead><tr><th>العضو</th><th>البريد</th><th>الدور</th><th>آخر دخول</th><th>الحالة</th></tr></thead><tbody><tr><td><strong>مشرف الجهة</strong></td><td dir="ltr">farhad@example.com</td><td>Owner</td><td>اليوم · 11:42</td><td><StatusBadge tone="success">نشط</StatusBadge></td></tr><tr><td><strong>د. مها العتيبي</strong></td><td dir="ltr">maha@example.com</td><td>Trainer</td><td>أمس · 16:18</td><td><StatusBadge tone="success">نشط</StatusBadge></td></tr><tr><td><strong>أحمد الزهراني</strong></td><td dir="ltr">ahmad@example.com</td><td>Viewer</td><td>لم يدخل بعد</td><td><StatusBadge tone="warning">دعوة معلقة</StatusBadge></td></tr></tbody></table></div></section> : <section className="organization-grid"><article className="organization-card"><div className="logo-pending">شعار</div><div><h2>كلية الطب · جامعة أم القرى</h2><p>42 متدرّباً · 3 برامج · 3 أعضاء</p></div><StatusBadge tone="success">نشطة</StatusBadge></article><article className="organization-card"><div className="logo-pending">شعار</div><div><h2>أكاديمية الإتقان للتدريب</h2><p>لا توجد بيانات تشغيلية بعد</p></div><StatusBadge tone="warning">قيد الإعداد</StatusBadge></article></section>}{inviteOpen && <Modal title="دعوة عضو إلى الجهة" onClose={() => setInviteOpen(false)}><form className="form-stack" onSubmit={submitInvite}><label>البريد الإلكتروني<input required type="email" dir="ltr" placeholder="name@example.com" /></label><label>الدور<select defaultValue="trainer"><option value="trainer">Trainer · مدرّب</option><option value="viewer">Viewer · قارئ</option><option value="admin">Admin · مدير</option></select></label><div className="modal-actions"><SecondaryButton onClick={() => setInviteOpen(false)}>إلغاء</SecondaryButton><PrimaryButton type="submit">إرسال الدعوة</PrimaryButton></div></form></Modal>}</AppShell>;
}

export function SettingsPage() {
  const [tab, setTab] = useState<"general" | "integrations" | "security">("general");
  const [saved, setSaved] = useState(false);
  const [actionFeedback, setActionFeedback] = useState("");
  const submit = (event: FormEvent) => { event.preventDefault(); setSaved(true); };
  return <AppShell title="الإعدادات"><PageHeader eyebrow="إعدادات الجهة" title="الإعدادات" description="هوية الجهة، التكاملات، وسياسات الوصول الخاصة بالحساب الحالي." /><DemoNotice /><div className="settings-layout"><nav className="settings-nav"><button className={tab === "general" ? "active" : ""} onClick={() => { setTab("general"); setActionFeedback(""); }}>الهوية العامة</button><button className={tab === "integrations" ? "active" : ""} onClick={() => { setTab("integrations"); setActionFeedback(""); }}>التكاملات</button><button className={tab === "security" ? "active" : ""} onClick={() => { setTab("security"); setActionFeedback(""); }}>الأمان والصلاحيات</button></nav><section className="content-section settings-panel">{tab === "general" && <form className="form-stack" onSubmit={submit}><div className="section-title"><div><span className="eyebrow">الهوية</span><h2>بيانات الجهة</h2></div></div>{saved && <div className="inline-feedback success-feedback"><Icon name="check" size={17} />حُفظت التغييرات محلياً للمعاينة.</div>}{actionFeedback && <div className="inline-feedback warning-feedback"><Icon name="warning" size={17} />{actionFeedback}</div>}<div className="brand-upload"><div className="logo-pending">شعار</div><div><strong>شعار الجهة غير مضاف</strong><p>ارفع ملف SVG أو PNG بخلفية شفافة.</p><button type="button" className="button button-secondary" onClick={() => setActionFeedback("رفع الملفات غير متصل في النسخة البصرية. نحتاج ملف الشعار الحقيقي قبل تفعيل الحفظ.")}>اختيار ملف</button></div></div><label>اسم الجهة<input defaultValue="كلية الطب · جامعة أم القرى" /></label><div className="form-grid"><label>الاسم المختصر<input defaultValue="كلية الطب" /></label><label>لون الجهة<input type="color" defaultValue="#C9A24B" /></label></div><div className="form-actions"><PrimaryButton type="submit">حفظ التغييرات</PrimaryButton></div></form>}{tab === "integrations" && <div><div className="section-title"><div><span className="eyebrow">مصادر الدليل</span><h2>حالة التكاملات</h2></div></div>{actionFeedback && <div className="inline-feedback warning-feedback"><Icon name="warning" size={17} />{actionFeedback}</div>}<div className="integration-list"><article><div className="integration-name"><span className="integration-code">JF</span><div><strong>Jotform</strong><small>نماذج القياس القبلي والبعدي</small></div></div><StatusBadge tone="warning">إعداد تجريبي</StatusBadge><button className="button button-secondary" onClick={() => setActionFeedback("إدارة Jotform ستُفعّل بعد تزويدنا بروابط النماذج وحقول الربط النهائية.")}>إدارة</button></article><article><div className="integration-name"><span className="integration-code">XR</span><div><strong>AmadXR · xAPI</strong><small>استقبال الأداء اللحظي</small></div></div><StatusBadge tone="system">Endpoint جاهز بصرياً</StatusBadge><button className="button button-secondary" onClick={() => setActionFeedback("لن نعرض مفتاحاً وهمياً. المفتاح الحقيقي يُنشأ ويحفظ سرياً عند تنفيذ التكامل.")}>عرض المفتاح</button></article><article><div className="integration-name"><span className="integration-code">SB</span><div><strong>Supabase</strong><small>قاعدة البيانات والصلاحيات</small></div></div><StatusBadge tone="warning">لم يُربط في الواجهة</StatusBadge><button className="button button-secondary" onClick={() => setActionFeedback("تعذر الفحص لأن بيانات اتصال Supabase لم تُضف إلى بيئة المشروع بعد.")}>فحص الاتصال</button></article></div></div>}{tab === "security" && <div><div className="section-title"><div><span className="eyebrow">الوصول</span><h2>الأمان والصلاحيات</h2></div></div><div className="security-list"><div><Icon name="shield" /><span><strong>عزل بيانات الجهة عبر RLS</strong><small>سيُختبر فعلياً عند ربط Supabase.</small></span><StatusBadge tone="warning">بانتظار التنفيذ</StatusBadge></div><div><Icon name="mail" /><span><strong>الدخول بواسطة OTP</strong><small>لا توجد كلمات مرور داخل المنظومة.</small></span><StatusBadge tone="system">معتمد</StatusBadge></div></div></div>}</section></div></AppShell>;
}

export function AccountPage() {
  const [saved, setSaved] = useState(false);
  const submit = (event: FormEvent) => { event.preventDefault(); setSaved(true); };
  return <AppShell title="الملف الشخصي"><PageHeader eyebrow="الحساب" title="الملف الشخصي" description="بياناتك الشخصية وتفضيلات الإشعارات والجهات التي تستطيع الوصول إليها." /><div className="account-layout"><aside className="account-summary"><span className="large-avatar">م</span><h2>مشرف الجهة</h2><p dir="ltr">farhad@example.com</p><StatusBadge tone="success">الحساب نشط</StatusBadge><div className="account-access"><small>الوصول الحالي</small><strong>كلية الطب · جامعة أم القرى</strong><span>Owner</span></div></aside><section className="content-section"><form className="form-stack" onSubmit={submit}><div className="section-title"><div><span className="eyebrow">البيانات الشخصية</span><h2>معلومات الحساب</h2></div></div>{saved && <div className="inline-feedback success-feedback"><Icon name="check" size={17} />حُفظت التغييرات محلياً.</div>}<div className="form-grid"><label>الاسم الكامل<input defaultValue="مشرف الجهة" autoComplete="name" /></label><label>رقم الجوال<input type="tel" defaultValue="0500000000" dir="ltr" /></label></div><label>البريد الإلكتروني<input type="email" defaultValue="farhad@example.com" dir="ltr" readOnly /><small>يُدار البريد من نظام تسجيل الدخول.</small></label><fieldset><legend>الإشعارات</legend><label className="check-row"><input type="checkbox" defaultChecked /><span>تنبيهات فشل استقبال البيانات</span></label><label className="check-row"><input type="checkbox" defaultChecked /><span>إشعار عند جاهزية تقرير دفعة</span></label><label className="check-row"><input type="checkbox" /><span>ملخص أسبوعي بالبريد</span></label></fieldset><div className="form-actions"><PrimaryButton type="submit">حفظ التغييرات</PrimaryButton></div></form></section></div></AppShell>;
}
