"use client";

import Image from "next/image";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "../lib/supabase/client";
import { Icon } from "./icons";
import styles from "./operational-sessions-panel.module.css";

type ProgramOption = { id: string; title_ar: string; status: string };
type CohortOption = { id: string; program_id: string; title: string; code: string; status: string };
type Attendee = {
  attendanceId: string;
  enrollmentId: string;
  traineeCode: string;
  traineeName: string;
  joinedAt: string;
};
type OperationalSession = {
  id: string;
  org_id: string;
  program_id: string;
  cohort_id: string;
  program_title: string;
  cohort_title: string;
  title: string;
  station_key: string;
  status: "scheduled" | "open" | "closed" | "cancelled";
  registration: string;
  scheduled_for: string;
  opened_at: string | null;
  closed_at: string | null;
  cancelled_at: string | null;
  token_expires_at: string | null;
  attendance_count: number;
  attendees: Attendee[];
  created_at: string;
  updated_at: string;
};
type JoinPayload = { joinUrl: string; qrDataUrl: string };

const stationOptions = [
  ["ALL", "التجربة كاملة"], ["S0", "بدء التجربة"], ["S1", "المشهد الأول"],
  ["S2", "المشهد الثاني"], ["S3", "المشهد الثالث"], ["S4", "المشهد الرابع"],
  ["S5", "المشهد الخامس"], ["S6", "المشهد السادس"], ["S7", "المشهد الختامي"],
] as const;

const statusLabels = {
  scheduled: "مجدولة",
  open: "مفتوحة",
  closed: "مغلقة",
  cancelled: "ملغاة",
} as const;

function localDateTimeValue(date = new Date()) {
  const shifted = new Date(date.valueOf() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ar-SA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Riyadh",
  }).format(new Date(value));
}

export function OperationalSessionsPanel({ organizationId }: { organizationId: string }) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [programs, setPrograms] = useState<ProgramOption[]>([]);
  const [cohorts, setCohorts] = useState<CohortOption[]>([]);
  const [sessions, setSessions] = useState<OperationalSession[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [busySessionId, setBusySessionId] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [joinPayload, setJoinPayload] = useState<JoinPayload | null>(null);
  const [joinSessionId, setJoinSessionId] = useState("");
  const [form, setForm] = useState({
    title: "جلسة تشغيل ميدانية",
    programId: "",
    cohortId: "",
    stationKey: "ALL",
    scheduledFor: localDateTimeValue(),
    openNow: true,
    tokenMinutes: "120",
  });

  const loadData = useCallback(async () => {
    setErrorMessage("");
    const [programResult, cohortResult, sessionsResponse] = await Promise.all([
      supabase.from("programs").select("id, title_ar, status").eq("org_id", organizationId).eq("status", "active").order("created_at"),
      supabase.from("cohorts").select("id, program_id, title, code, status").eq("org_id", organizationId).in("status", ["open", "in_progress"]).order("created_at"),
      fetch(`/api/sessions?organizationId=${encodeURIComponent(organizationId)}`, { cache: "no-store" }),
    ]);
    const sessionsPayload = (await sessionsResponse.json()) as { sessions?: OperationalSession[]; message?: string };
    if (programResult.error || cohortResult.error || !sessionsResponse.ok) {
      setErrorMessage(sessionsPayload.message ?? "تعذر تحميل سجل الجلسات التشغيلية.");
      setIsLoading(false);
      return;
    }
    const nextPrograms = (programResult.data ?? []) as ProgramOption[];
    const nextCohorts = (cohortResult.data ?? []) as CohortOption[];
    setPrograms(nextPrograms);
    setCohorts(nextCohorts);
    setSessions(sessionsPayload.sessions ?? []);
    setForm((current) => {
      const programId = nextPrograms.some((item) => item.id === current.programId)
        ? current.programId : nextPrograms[0]?.id ?? "";
      const availableCohorts = nextCohorts.filter((item) => item.program_id === programId);
      return {
        ...current,
        programId,
        cohortId: availableCohorts.some((item) => item.id === current.cohortId)
          ? current.cohortId : availableCohorts[0]?.id ?? "",
      };
    });
    setIsLoading(false);
  }, [organizationId, supabase]);

  useEffect(() => { void loadData(); }, [loadData]);

  const availableCohorts = cohorts.filter((cohort) => cohort.program_id === form.programId);

  async function createSession(event: FormEvent) {
    event.preventDefault();
    setIsSaving(true); setErrorMessage(""); setSuccessMessage(""); setJoinPayload(null);
    try {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          programId: form.programId,
          cohortId: form.cohortId,
          title: form.title,
          stationKey: form.stationKey,
          scheduledFor: new Date(form.scheduledFor).toISOString(),
          openNow: form.openNow,
          tokenMinutes: Number(form.tokenMinutes),
        }),
      });
      const payload = (await response.json()) as { session?: OperationalSession; join?: JoinPayload | null; message?: string };
      if (!response.ok || !payload.session) {
        setErrorMessage(payload.message ?? "تعذر إنشاء الجلسة.");
        return;
      }
      setSuccessMessage(form.openNow ? "أُنشئت الجلسة وفُتحت وسُجل الحدث في سجل التدقيق." : "أُنشئت الجلسة المجدولة وسُجل الحدث في سجل التدقيق.");
      setJoinPayload(payload.join ?? null); setJoinSessionId(payload.session.id); setShowCreate(false);
      await loadData();
    } catch {
      setErrorMessage("تعذر الاتصال بخدمة إنشاء الجلسة.");
    } finally { setIsSaving(false); }
  }

  async function runAction(sessionId: string, action: "open" | "rotate" | "close" | "cancel") {
    if (action === "rotate" && !window.confirm("إصدار رمز جديد سيبطل أي QR سابق لهذه الجلسة. هل تريد المتابعة؟")) return;
    setBusySessionId(sessionId); setErrorMessage(""); setSuccessMessage("");
    if (action === "open" || action === "rotate") setJoinPayload(null);
    try {
      const response = await fetch(`/api/sessions/${sessionId}/actions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, tokenMinutes: 120 }),
      });
      const payload = (await response.json()) as { session?: OperationalSession; join?: JoinPayload | null; message?: string };
      if (!response.ok) { setErrorMessage(payload.message ?? "تعذر تنفيذ إجراء الجلسة."); return; }
      if (payload.join) { setJoinPayload(payload.join); setJoinSessionId(sessionId); }
      setSuccessMessage(action === "open" ? "فُتحت الجلسة وأُصدر QR صالح لساعتين." : action === "rotate" ? "أُصدر QR جديد وأُبطل الرمز السابق." : action === "close" ? "أُغلقت الجلسة وأُبطل رمز الالتحاق." : "أُلغيت الجلسة وأُبطل رمز الالتحاق.");
      await loadData();
    } catch { setErrorMessage("تعذر الاتصال بخدمة إدارة الجلسة."); }
    finally { setBusySessionId(""); }
  }

  async function copyJoinUrl() {
    if (!joinPayload) return;
    await navigator.clipboard.writeText(joinPayload.joinUrl);
    setSuccessMessage("نُسخ رابط الالتحاق.");
  }

  return (
    <section className={styles.panel} aria-labelledby="operational-sessions-title">
      <header className={styles.panelHead}>
        <div><span>تشغيل ميداني موثق</span><h2 id="operational-sessions-title">الجلسات التشغيلية</h2><p>رمز الجلسة مؤقت، وهوية المتدرّب تُثبت بصورة مستقلة قبل تسجيل الالتحاق.</p></div>
        <button className="button button-primary" type="button" onClick={() => setShowCreate((value) => !value)}><Icon name={showCreate ? "close" : "plus"} size={17} />{showCreate ? "إغلاق النموذج" : "جلسة جديدة"}</button>
      </header>

      {errorMessage && <p className={styles.error} role="alert"><Icon name="warning" size={17} />{errorMessage}</p>}
      {successMessage && <p className={styles.success} role="status"><Icon name="check" size={17} />{successMessage}</p>}

      {showCreate && (
        <form className={styles.createForm} onSubmit={createSession}>
          <header><div><span>01</span><h3>تعريف الجلسة</h3></div><p>لا يمكن إنشاء جلسة لبرنامج أو دفعة غير نشطين.</p></header>
          <label><span>اسم الجلسة</span><input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} minLength={2} maxLength={160} required /></label>
          <label><span>البرنامج</span><select value={form.programId} onChange={(event) => { const programId = event.target.value; setForm({ ...form, programId, cohortId: cohorts.find((item) => item.program_id === programId)?.id ?? "" }); }} required><option value="">اختر البرنامج</option>{programs.map((program) => <option key={program.id} value={program.id}>{program.title_ar}</option>)}</select></label>
          <label><span>الدفعة</span><select value={form.cohortId} onChange={(event) => setForm({ ...form, cohortId: event.target.value })} required><option value="">اختر الدفعة</option>{availableCohorts.map((cohort) => <option key={cohort.id} value={cohort.id}>{cohort.title} · {cohort.code}</option>)}</select></label>
          <label><span>المحطة</span><select value={form.stationKey} onChange={(event) => setForm({ ...form, stationKey: event.target.value })}>{stationOptions.map(([key, label]) => <option key={key} value={key}>{key} · {label}</option>)}</select></label>
          <label><span>موعد الجلسة</span><input type="datetime-local" value={form.scheduledFor} onChange={(event) => setForm({ ...form, scheduledFor: event.target.value })} required /></label>
          <label><span>صلاحية الرمز بالدقائق</span><select value={form.tokenMinutes} onChange={(event) => setForm({ ...form, tokenMinutes: event.target.value })} disabled={!form.openNow}><option value="30">30 دقيقة</option><option value="60">ساعة</option><option value="120">ساعتان</option><option value="240">4 ساعات</option><option value="480">8 ساعات</option></select></label>
          <label className={styles.check}><input type="checkbox" checked={form.openNow} onChange={(event) => setForm({ ...form, openNow: event.target.checked })} /><span>فتح الجلسة وإصدار QR الآن</span></label>
          <button className="button button-primary" type="submit" disabled={isSaving || !form.cohortId}>{isSaving ? "جارٍ الحفظ..." : "إنشاء الجلسة"}</button>
        </form>
      )}

      {joinPayload && (
        <section className={styles.qrSheet} aria-label="رمز الالتحاق الجديد">
          <Image src={joinPayload.qrDataUrl} alt="QR الالتحاق بالجلسة" width={220} height={220} unoptimized />
          <div><span>QR صادر من الخادم</span><h3>امسح الرمز من هاتف المتدرّب</h3><p>هذا الرمز يحدد الجلسة فقط. سيطلب الهاتف معرّف AMD ووسيلة التواصل المسجلة لإثبات الهوية.</p><code dir="ltr">{joinPayload.joinUrl}</code><div><button className="button button-secondary" type="button" onClick={() => void copyJoinUrl()}>نسخ الرابط</button><button className="button button-tertiary" type="button" onClick={() => { setJoinPayload(null); setJoinSessionId(""); }}>إخفاء الرمز</button></div></div>
        </section>
      )}

      {isLoading ? <p className={styles.empty}>جارٍ تحميل سجل الجلسات...</p> : sessions.length === 0 ? <p className={styles.empty}>لا توجد جلسات تشغيلية بعد. أنشئ أول جلسة من الزر أعلاه.</p> : (
        <div className={styles.ledger}>
          {sessions.map((session, index) => (
            <article key={session.id} className={joinSessionId === session.id ? styles.highlight : undefined}>
              <header><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{session.title}</h3><p>{session.program_title} · {session.cohort_title}</p></div><b data-status={session.status}>{statusLabels[session.status]}</b></header>
              <dl><div><dt>المحطة</dt><dd dir="ltr">{session.station_key}</dd></div><div><dt>الموعد</dt><dd>{formatDate(session.scheduled_for)}</dd></div><div><dt>context.registration</dt><dd dir="ltr">{session.registration}</dd></div><div><dt>الملتحقون</dt><dd>{session.attendance_count}</dd></div><div><dt>انتهاء QR</dt><dd>{formatDate(session.token_expires_at)}</dd></div></dl>
              {session.attendees.length > 0 && <details><summary>عرض الملتحقين ({session.attendees.length})</summary><ul>{session.attendees.map((attendee) => <li key={attendee.attendanceId}><span><strong>{attendee.traineeName}</strong><small dir="ltr">{attendee.traineeCode}</small></span><time dateTime={attendee.joinedAt}>{formatDate(attendee.joinedAt)}</time></li>)}</ul></details>}
              <footer>
                {session.status === "scheduled" && <button type="button" onClick={() => void runAction(session.id, "open")} disabled={busySessionId === session.id}>فتح وإصدار QR</button>}
                {session.status === "open" && <><button type="button" onClick={() => void runAction(session.id, "rotate")} disabled={busySessionId === session.id}>إصدار QR جديد</button><button type="button" onClick={() => void runAction(session.id, "close")} disabled={busySessionId === session.id}>إغلاق الجلسة</button></>}
                {(session.status === "scheduled" || session.status === "open") && <button className={styles.danger} type="button" onClick={() => void runAction(session.id, "cancel")} disabled={busySessionId === session.id}>إلغاء</button>}
              </footer>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
