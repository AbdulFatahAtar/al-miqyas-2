"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "./icons";
import { ThemeToggle } from "./theme-toggle";
import styles from "./operational-session-journey-page.module.css";

type Journey = {
  title: string;
  program_title: string;
  cohort_title: string;
  station_key: string;
  trainee_code: string;
  trainee_name: string;
  pre_completed: boolean;
  live_event_count: number;
  post_completed: boolean;
  report_ready: boolean;
  certificate_ready: boolean;
  certificate_verify_code: string | null;
};

const stageLabels = ["القياس القبلي", "الأداء اللحظي", "القياس البعدي", "تقرير الأثر", "الشهادة"];

export function OperationalSessionJourneyPage() {
  const [journey, setJourney] = useState<Journey | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpening, setIsOpening] = useState(false);
  const [error, setError] = useState("");

  const loadJourney = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/public/session-journey", { cache: "no-store", signal });
    const payload = (await response.json()) as { journey?: Journey; message?: string };
    if (!response.ok || !payload.journey) throw new Error(payload.message ?? "تعذر فتح رحلة الجلسة.");
    setJourney(payload.journey);
    setError("");
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadJourney(controller.signal)
      .catch((caught) => {
        if (caught instanceof Error && caught.name !== "AbortError") setError(caught.message);
      })
      .finally(() => setIsLoading(false));
    return () => controller.abort();
  }, [loadJourney]);

  useEffect(() => {
    if (!journey || journey.certificate_ready) return;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      void loadJourney().catch(() => undefined);
    };
    const interval = window.setInterval(refresh, 10_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [journey, loadJourney]);

  async function openAssessment(kind: "pre" | "post") {
    setIsOpening(true); setError("");
    try {
      const response = await fetch("/api/public/session-journey/assessment-link", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assessmentKind: kind }),
      });
      const payload = (await response.json()) as { url?: string; message?: string };
      if (!response.ok || !payload.url) throw new Error(payload.message ?? "تعذر فتح القياس.");
      window.location.assign(payload.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذر فتح القياس.");
      setIsOpening(false);
    }
  }

  const completed = journey ? [journey.pre_completed, journey.live_event_count > 0, journey.post_completed, journey.report_ready, journey.certificate_ready] : [];
  const activeIndex = !journey?.pre_completed ? 0 : journey.live_event_count === 0 ? 1 : !journey.post_completed ? 2 : !journey.report_ready ? 3 : 4;

  return <main className={styles.page}>
    <header className={styles.masthead}><div><span className={styles.brand}><Image src="/brand/al-amad-mark-transparent.png" alt="شعار شركة الأمد" width={42} height={42} /><span><strong>منظومة المقياس</strong><small>رحلة الجلسة</small></span></span><ThemeToggle compact /></div></header>
    <article className={styles.document}>
      {isLoading ? <section className={styles.state}><Icon name="clock" size={26} /><h1>جارٍ فتح رحلة الجلسة</h1></section> : error && !journey ? <section className={`${styles.state} ${styles.failed}`}><Icon name="warning" size={26} /><h1>تعذر فتح الرحلة</h1><p>{error}</p></section> : journey ? <>
        <header className={styles.head}><div><span>سجل تجربة ميدانية</span><h1>{journey.title}</h1><p>{journey.program_title} · {journey.cohort_title}</p></div><dl><div><dt>المشارك</dt><dd>{journey.trainee_name}</dd></div><div><dt>المعرّف</dt><dd dir="ltr">{journey.trainee_code}</dd></div></dl></header>
        <ol className={styles.timeline} aria-label="مراحل رحلة القياس">{stageLabels.map((label, index) => <li key={label} data-state={completed[index] ? "complete" : index === activeIndex ? "active" : "pending"}><b>{String(index + 1).padStart(2, "0")}</b><span>{label}</span><small>{completed[index] ? "مكتمل" : index === activeIndex ? "متاح الآن" : "بانتظار المرحلة السابقة"}</small></li>)}</ol>
        <section className={styles.actionPanel}>
          {!journey.pre_completed ? <><span>المحطة 01</span><h2>ابدأ بالقياس القبلي</h2><p>سيفتح نموذج Jotform بالمعرّف الموحد مقفلًا. بعد الإرسال ارجع إلى هذه الصفحة؛ ستلتقط النتيجة تلقائيًا.</p><button onClick={() => void openAssessment("pre")} disabled={isOpening}>{isOpening ? "جارٍ الفتح..." : "فتح القياس القبلي"}</button></> : journey.live_event_count === 0 ? <><span>المحطة 02</span><h2>انتقل إلى تجربة الأداء اللحظي</h2><p>اعرض معرّفك على المشرف وابدأ التجربة المرتبطة بهذه الجلسة. ستنتقل الرحلة تلقائيًا عند وصول أول حدث xAPI حقيقي.</p><div className={styles.participantCode}><small>معرّف المشارك</small><strong dir="ltr">{journey.trainee_code}</strong></div></> : !journey.post_completed ? <><span>المحطة 03</span><h2>وصل الأداء اللحظي — أكمل القياس البعدي</h2><p>وصل {journey.live_event_count} حدثًا من التجربة. افتح القياس البعدي ثم ارجع إلى هذه الصفحة.</p><button onClick={() => void openAssessment("post")} disabled={isOpening}>{isOpening ? "جارٍ الفتح..." : "فتح القياس البعدي"}</button></> : journey.certificate_ready && journey.certificate_verify_code ? <><span>المحطة 05</span><h2>اكتملت الرحلة والشهادة جاهزة</h2><p>صدرت الشهادة القابلة للتحقق العام. احتفظ بمعرّف AMD للعودة إلى سجل رحلتك.</p><Link className={styles.actionLink} href={`/verify/${journey.certificate_verify_code}`}>فتح الشهادة والتحقق منها</Link></> : journey.report_ready ? <><span>المحطة 04</span><h2>تقرير الأثر جاهز</h2><p>اكتملت معالجة القياسات والأداء. يمكنك فتح سجل رحلتك، وتظهر الشهادة عند استيفاء شروط الإصدار.</p><Link className={styles.actionLink} href={`/t/${journey.trainee_code}`}>فتح نتيجة الرحلة</Link></> : <><span>المحطتان 04 و05</span><h2>اكتملت القياسات وتُعالج النتيجة</h2><p>ستظهر نتيجة الأثر والشهادة عند اكتمال المعالجة واستيفاء شروط الإصدار.</p></>}
          {error && <p className={styles.error} role="alert">{error}</p>}
        </section>
      </> : null}
    </article>
  </main>;
}
