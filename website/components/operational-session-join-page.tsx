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
        setErrorMessage(payload.message ?? "تعذر التحقق من الهوية والالتحاق بالجلسة.");
        return;
      }
      setAttendance(payload.attendance);
    } catch {
      setErrorMessage("تعذر الاتصال بخدمة الجلسة. حاول مجددًا.");
    } finally {
      setIsSubmitting(false);
    }
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
              <h2>{attendance.already_joined ? "التحاقك مسجل مسبقًا" : "تم إثبات الهوية وتسجيل الالتحاق"}</h2>
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
              <span className={styles.eyebrow}>لماذا نطلب هويتين؟</span>
              <h2>رمز الجلسة لا يثبت هوية المتدرّب</h2>
              <ol>
                <li><b>01</b><span><strong>رمز الجلسة</strong><small>يثبت أنك فتحت الجلسة الصحيحة.</small></span></li>
                <li><b>02</b><span><strong>معرّف المتدرّب</strong><small>يربطك بسجل AMD الخاص بك.</small></span></li>
                <li><b>03</b><span><strong>وسيلة التواصل المسجلة</strong><small>تمنع استخدام معرّف شخص آخر.</small></span></li>
              </ol>
              <p className={styles.expiry}>ينتهي الرمز في {formatExpiry(session.token_expires_at)}.</p>
            </section>
            <section className={styles.formPanel}>
              <h2>إثبات الهوية والالتحاق</h2>
              <p>أدخل معرّفك ووسيلة التواصل نفسها المحفوظة في سجل المتدرّب.</p>
              <form onSubmit={joinSession}>
                <label htmlFor="trainee-code">المعرّف الموحد</label>
                <input id="trainee-code" dir="ltr" value={traineeCode} onChange={(event) => setTraineeCode(event.target.value.toUpperCase())} placeholder="AMD-XXXXX" pattern="AMD-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}" required autoComplete="off" />
                <label htmlFor="identity-value">البريد الإلكتروني أو رقم الجوال المسجل</label>
                <input id="identity-value" dir="ltr" value={identityValue} onChange={(event) => setIdentityValue(event.target.value)} placeholder="name@example.com أو 05xxxxxxxx" minLength={5} maxLength={254} required autoComplete="email" />
                {errorMessage && <p className={styles.error} role="alert">{errorMessage}</p>}
                <button type="submit" disabled={isSubmitting}>{isSubmitting ? "جارٍ التحقق..." : "إثبات الهوية والالتحاق"}<Icon name={isSubmitting ? "clock" : "check"} size={17} /></button>
              </form>
              <p className={styles.note}>لا تُعرض بيانات التواصل ولا تُحفظ القيمة التي تدخلها ضمن سجل الجلسة.</p>
            </section>
          </div>
        ) : (
          <section className={`${styles.state} ${styles.failed}`} role="alert"><Icon name="warning" size={25} /><div><h2>الرابط غير متاح</h2><p>{errorMessage || "قد يكون الرمز منتهيًا أو أُغلقت الجلسة."}</p></div></section>
        )}
      </article>
    </main>
  );
}
