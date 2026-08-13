"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { Icon } from "./icons";
import { ThemeToggle } from "./theme-toggle";
import styles from "./operational-session-join-page.module.css";

type PublicSession = {
  session_id: string;
  title: string;
  program_title: string;
  cohort_title: string;
  station_key: string;
  token_expires_at: string;
  allow_self_registration: boolean;
};

type Attendance = {
  attendance_id: string;
  session_id: string;
  enrollment_id: string;
  trainee_code: string;
  trainee_name: string;
  program_id: string;
  registration: string;
  station_key: string;
  joined_at: string;
  already_joined: boolean;
};

const stationLabels: Record<string, string> = {
  ALL: "التجربة كاملة",
  S0: "بدء التجربة",
  S1: "المشهد الأول",
  S2: "المشهد الثاني",
  S3: "المشهد الثالث",
  S4: "المشهد الرابع",
  S5: "المشهد الخامس",
  S6: "المشهد السادس",
  S7: "المشهد الختامي",
};

function formatExpiry(value: string) {
  return new Intl.DateTimeFormat("ar-SA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Riyadh",
  }).format(new Date(value));
}

export function OperationalSessionJoinPage({ token }: { token: string }) {
  const [session, setSession] = useState<PublicSession | null>(null);
  const [attendance, setAttendance] = useState<Attendance | null>(null);
  const [traineeCode, setTraineeCode] = useState("");
  const [identityValue, setIdentityValue] = useState("");
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(`/api/public/sessions/${encodeURIComponent(token)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json()) as { session?: PublicSession; message?: string };
        if (!response.ok || !payload.session) {
          setErrorMessage(payload.message ?? "رابط الجلسة غير صالح أو انتهت صلاحيته.");
          return;
        }
        setSession(payload.session);
        if (payload.session.allow_self_registration) setMode("new");
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        setErrorMessage("تعذر التحقق من رابط الجلسة الآن.");
      } finally {
        setIsLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [token]);

  async function joinSession(event: FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage("");
    try {
      const response = await fetch(`/api/public/sessions/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ traineeCode, identityValue }),
      });
      const payload = (await response.json()) as { attendance?: Attendance; message?: string };
      if (!response.ok || !payload.attendance) {
        setErrorMessage(payload.message ?? "تعذرت مطابقة السجل والالتحاق بالجلسة.");
        return;
      }
      setAttendance(payload.attendance);
      window.location.assign("/session");
    } catch {
      setErrorMessage("تعذر الاتصال بخدمة الجلسة. حاول مجددًا.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function registerSession(event: FormEvent) {
    event.preventDefault();
    setIsSubmitting(true); setErrorMessage("");
    try {
      const response = await fetch(`/api/public/sessions/${encodeURIComponent(token)}/register`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, email, phone, consent }),
      });
      const payload = (await response.json()) as { attendance?: Attendance; message?: string };
      if (!response.ok || !payload.attendance) {
        setErrorMessage(payload.message ?? "تعذر التسجيل والالتحاق بالجلسة."); return;
      }
      setAttendance(payload.attendance);
      window.location.assign("/session");
    } catch { setErrorMessage("تعذر الاتصال بخدمة التسجيل. حاول مجددًا."); }
    finally { setIsSubmitting(false); }
  }

  return (
    <main className={styles.page}>
      <header className={styles.masthead}>
        <div className={styles.mastheadInner}>
          <div className={styles.brand}>
            <Image src="/brand/al-amad-mark-transparent.png" alt="شعار شركة الأمد" width={44} height={44} />
            <span><strong>منظومة المقياس</strong><small>التحاق جلسة آمن</small></span>
          </div>
          <div className={styles.actions}><ThemeToggle compact /><Link href="/login">دخول المشرفين</Link></div>
        </div>
      </header>

      <article className={styles.document} aria-labelledby="join-title">
        <header className={styles.documentHead}>
          <div>
            <span className={styles.eyebrow}>سجل جلسة تشغيلية</span>
            <h1 id="join-title">
              {isLoading ? "جارٍ التحقق من رمز الجلسة" : attendance ? "تم الالتحاق بالجلسة" : session?.title ?? "تعذر فتح الجلسة"}
            </h1>
            <p>{session ? `${session.program_title} · ${session.cohort_title}` : "لا تُعرض بيانات تشغيلية قبل التحقق من الرمز."}</p>
          </div>
          {session && <div className={styles.station}><small>المحطة</small><strong dir="ltr">{session.station_key}</strong><span>{stationLabels[session.station_key]}</span></div>}
        </header>

        {isLoading ? (
          <section className={styles.state} role="status"><Icon name="clock" size={24} /><div><h2>نراجع صلاحية الرمز</h2><p>لن نطلب هويتك قبل التأكد من أن الجلسة مفتوحة.</p></div></section>
        ) : attendance ? (
          <section className={`${styles.state} ${styles.success}`} aria-live="polite">
            <Icon name="check" size={26} />
            <div>
              <h2>{attendance.already_joined ? "التحاقك مسجل مسبقًا" : "تمت مطابقة السجل وتسجيل الالتحاق"}</h2>
              <p>{attendance.trainee_name} · <b dir="ltr">{attendance.trainee_code}</b></p>
              <dl className={styles.context}>
                <div><dt>معرّف تسجيل xAPI</dt><dd dir="ltr">{attendance.registration}</dd></div>
                <div><dt>معرّف التسجيل</dt><dd dir="ltr">{attendance.enrollment_id}</dd></div>
              </dl>
              <p className={styles.note}>اترك هذه الصفحة مفتوحة عند بدء محطة الأداء اللحظي. لا تشارك هذه المعرفات مع شخص آخر.</p>
            </div>
          </section>
        ) : session ? (
          <div className={styles.joinGrid}>
            <section className={styles.protocol}>
              <span className={styles.eyebrow}>{mode === "new" ? "مشاركة دون حساب" : "مطابقة مستقلة عن الرمز"}</span>
              <h2>{mode === "new" ? "سجّل مرة وابدأ الرحلة" : "رمز الجلسة لا يطابق سجل المشارك"}</h2>
              {mode === "new" ? (
                <ol>
                  <li><b>01</b><span><strong>سجل جديد</strong><small>ينشئ النظام معرّف AMD خاصًا بك.</small></span></li>
                  <li><b>02</b><span><strong>الدفعة والجلسة</strong><small>يربطك بهما في عملية واحدة.</small></span></li>
                  <li><b>03</b><span><strong>رحلة القياس</strong><small>تبدأ القبلي ثم الأداء والبعدي والنتيجة.</small></span></li>
                </ol>
              ) : (
                <ol>
                  <li><b>01</b><span><strong>رمز الجلسة</strong><small>يثبت أنك فتحت الجلسة الصحيحة.</small></span></li>
                  <li><b>02</b><span><strong>معرّف المشارك</strong><small>يحدد سجل AMD المطلوب.</small></span></li>
                  <li><b>03</b><span><strong>وسيلة التواصل المسجلة</strong><small>تُطابق القيمة المحفوظة في السجل.</small></span></li>
                </ol>
              )}
              <p className={styles.expiry}>ينتهي الرمز في {formatExpiry(session.token_expires_at)}.</p>
            </section>
            <section className={styles.formPanel}>
              <h2>{mode === "new" ? "تسجيل مشارك جديد" : "مطابقة السجل والالتحاق"}</h2>
              <p>{mode === "new" ? "سننشئ لك معرّف AMD ونربطك بهذه الدفعة والجلسة دون حساب دخول." : "أدخل معرّفك ووسيلة التواصل نفسها المحفوظة في سجل المتدرّب."}</p>
              {session.allow_self_registration && <div className={styles.modeSwitch} role="group" aria-label="نوع المشارك"><button type="button" aria-pressed={mode === "existing"} onClick={() => { setMode("existing"); setErrorMessage(""); }}>لدي معرّف AMD</button><button type="button" aria-pressed={mode === "new"} onClick={() => { setMode("new"); setErrorMessage(""); }}>أشارك لأول مرة</button></div>}
              {mode === "existing" ? <form onSubmit={joinSession}>
                <label htmlFor="trainee-code">المعرّف الموحد</label>
                <input id="trainee-code" dir="ltr" value={traineeCode} onChange={(event) => setTraineeCode(event.target.value.toUpperCase())} placeholder="AMD-XXXXX" pattern="AMD-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}" required autoComplete="off" />
                <label htmlFor="identity-value">البريد الإلكتروني أو رقم الجوال المسجل</label>
                <input id="identity-value" dir="ltr" value={identityValue} onChange={(event) => setIdentityValue(event.target.value)} placeholder="name@example.com أو 05xxxxxxxx" minLength={5} maxLength={254} required autoComplete="email" />
                {errorMessage && <p className={styles.error} role="alert">{errorMessage}</p>}
                <button type="submit" disabled={isSubmitting}>{isSubmitting ? "جارٍ التحقق..." : "مطابقة السجل والالتحاق"}<Icon name={isSubmitting ? "clock" : "check"} size={17} /></button>
              </form> : <form onSubmit={registerSession}>
                <label htmlFor="participant-name">الاسم الكامل</label><input id="participant-name" value={fullName} onChange={(event) => setFullName(event.target.value)} minLength={2} maxLength={200} autoComplete="name" required />
                <label htmlFor="participant-email">البريد الإلكتروني</label><input id="participant-email" dir="ltr" type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} autoComplete="email" />
                <label htmlFor="participant-phone">رقم الجوال</label><input id="participant-phone" dir="ltr" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={32} autoComplete="tel" />
                <small className={styles.fieldHint}>أدخل البريد أو الجوال على الأقل. وسيلة التواصل غير موثقة حتى تُضاف خدمة تحقق مستقلة.</small>
                <label className={styles.consent}><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} required /><span>أوافق على حفظ بياناتي لربط القياسات والتجربة وإصدار النتيجة والشهادة ضمن هذه الدفعة.</span></label>
                {errorMessage && <p className={styles.error} role="alert">{errorMessage}</p>}
                <button type="submit" disabled={isSubmitting || (!email.trim() && !phone.trim())}>{isSubmitting ? "جارٍ التسجيل..." : "التسجيل وبدء الرحلة"}<Icon name={isSubmitting ? "clock" : "arrow"} size={17} /></button>
              </form>}
              <p className={styles.note}>{mode === "new" ? "لا يُنشأ حساب دخول أو كلمة مرور. ستحصل على معرّف ثابت تستخدمه في رحلاتك اللاحقة." : "لا تُعرض بيانات التواصل ولا تُحفظ القيمة التي تدخلها ضمن سجل الجلسة."}</p>
            </section>
          </div>
        ) : (
          <section className={`${styles.state} ${styles.failed}`} role="alert"><Icon name="warning" size={25} /><div><h2>الرابط غير متاح</h2><p>{errorMessage || "قد يكون الرمز منتهيًا أو أُغلقت الجلسة."}</p></div></section>
        )}
      </article>
    </main>
  );
}
