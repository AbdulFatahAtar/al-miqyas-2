"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "./icons";
import { ThemeToggle } from "./theme-toggle";
import styles from "./public-evidence.module.css";

type PublicRouteData = {
  trainee_code: string;
  program_title: string;
  cohort_title: string;
  cohort_status: "draft" | "open" | "in_progress" | "closed";
  pre_form_id: string | null;
  pre_field_name: string | null;
  post_form_id: string | null;
  post_field_name: string | null;
  pre_completed: boolean;
  live_event_count: number;
  post_completed: boolean;
};

type RouteState = {
  label: string;
  title: string;
  description: string;
  actionLabel: string | null;
  actionUrl: string | null;
  actionKind: "pre" | "post" | null;
  tone: "success" | "warning" | "danger" | "system" | "muted";
  step: number;
};

export function TraineeRoutingPage({
  traineeCode,
}: {
  traineeCode: string;
}) {
  const [data, setData] = useState<PublicRouteData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpeningAssessment, setIsOpeningAssessment] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [actionErrorMessage, setActionErrorMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setIsLoading(true);
      setErrorMessage("");

      try {
        const response = await fetch(
          `/api/public/trainees/${encodeURIComponent(traineeCode)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const payload = (await response.json()) as {
          route?: PublicRouteData | null;
          message?: string;
        };

        if (!response.ok) {
          setErrorMessage(
            response.status === 429
              ? "تجاوزت محاولات التحقق المسموحة. حاول لاحقًا."
              : payload.message ?? "تعذر التحقق من الرابط الآن.",
          );
          return;
        }

        setData(payload.route ?? null);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
        setErrorMessage("تعذر التحقق من الرابط الآن.");
      } finally {
        setIsLoading(false);
      }
    };

    void load();
    return () => controller.abort();
  }, [traineeCode]);

  const state: RouteState = useMemo(() => {
    if (!data) {
      return {
        label: "الرابط غير صالح",
        title: "تعذر العثور على التسجيل",
        description:
          "لم نجد تسجيلًا نشطًا مرتبطًا بهذا المعرّف. راجع مشرف البرنامج.",
        actionLabel: null,
        actionUrl: null,
        actionKind: null,
        tone: "danger",
        step: 0,
      };
    }

    if (data.cohort_status === "draft") {
      return {
        label: "الدفعة لم تبدأ",
        title: "تسجيلك محفوظ",
        description:
          "أنت مرتبط بالدفعة، لكن مشرف البرنامج لم يفتح رحلة القياس بعد.",
        actionLabel: null,
        actionUrl: null,
        actionKind: null,
        tone: "warning",
        step: 1,
      };
    }

    if (!data.pre_form_id || !data.post_form_id) {
      return {
        label: "الإعداد غير مكتمل",
        title: "النماذج لم تُربط بعد",
        description:
          "تسجيلك صحيح، لكن الاختبار القبلي أو البعدي غير مربوط بهذه النسخة من البرنامج.",
        actionLabel: null,
        actionUrl: null,
        actionKind: null,
        tone: "warning",
        step: 1,
      };
    }

    if (!data.pre_completed) {
      return {
        label: "القياس القبلي جاهز",
        title: "ابدأ بالقياس القبلي",
        description:
          "سينتقل معرّفك تلقائيًا إلى النموذج. لا تكتب أو تغيّر المعرف يدويًا.",
        actionLabel: "فتح القياس القبلي",
        actionUrl: null,
        actionKind: "pre",
        tone: "system",
        step: 1,
      };
    }

    if (!data.post_completed) {
      return {
        label: "القياس البعدي جاهز",
        title: "أكمل القياس البعدي",
        description:
          data.live_event_count > 0
            ? "وصلت بيانات الأداء اللحظي. أكمل القياس البعدي لإنهاء رحلة القياس."
            : "اكتمل القياس القبلي. أكمل القياس البعدي عند انتهاء التجربة التدريبية.",
        actionLabel: "فتح القياس البعدي",
        actionUrl: null,
        actionKind: "post",
        tone: "warning",
        step: 3,
      };
    }

    return {
      label: "اكتملت الرحلة",
      title: "اكتملت القياسات المطلوبة",
      description:
        "استخدم رمز التحقق الموجود في الشهادة أو امسح رمز QR للتحقق منها دون ربط هذا المعرّف ببيانات الشهادة العامة.",
      actionLabel: "التحقق من شهادة",
      actionUrl: "/verify",
      actionKind: null,
      tone: "success",
      step: 5,
    };
  }, [data]);

  const openAssessment = async (assessmentKind: "pre" | "post") => {
    setIsOpeningAssessment(true);
    setActionErrorMessage("");

    try {
      const response = await fetch("/api/public/assessments/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          traineeCode,
          assessmentKind,
        }),
      });
      const result = (await response.json()) as {
        url?: string;
        message?: string;
      };

      if (!response.ok || !result.url) {
        setActionErrorMessage(
          result.message ?? "تعذر فتح القياس الآن.",
        );
        return;
      }

      window.location.assign(result.url);
    } catch {
      setActionErrorMessage(
        "تعذر إنشاء الرابط الآمن. تحقق من الاتصال وحاول مجددًا.",
      );
    } finally {
      setIsOpeningAssessment(false);
    }
  };

  const toneClass =
    state.tone === "success"
      ? styles.valid
      : state.tone === "danger"
        ? styles.failed
        : state.tone === "warning"
          ? styles.warning
          : state.tone === "system"
            ? styles.system
            : styles.warning;

  const decisionIcon =
    state.tone === "danger"
      ? "warning"
      : state.tone === "success"
        ? "check"
        : "clock";

  return (
    <main className={styles.page}>
      <header className={styles.masthead}>
        <div className={styles.mastheadInner}>
          <div className={styles.brand}>
            <Image
              src="/brand/al-amad-mark-transparent.png"
              alt="شعار شركة الأمد"
              width={44}
              height={44}
            />
            <span>
              <strong>منظومة المقياس</strong>
              <small>مسار المتدرّب الآمن</small>
            </span>
          </div>
          <div className={styles.mastheadActions}>
            <ThemeToggle compact />
            <Link href="/login">دخول المشرفين</Link>
          </div>
        </div>
      </header>

      <article className={styles.document} aria-labelledby="route-title">
        <header className={styles.routeHead}>
          <div>
            <span className={styles.documentClass}>سجل رحلة القياس</span>
            <h1 id="route-title">
              {isLoading ? "جارٍ التحقق من مسار التسجيل" : state.title}
            </h1>
            <p>
              {data
                ? `${data.program_title} · ${data.cohort_title}`
                : "لن تظهر خطوة تشغيلية قبل التحقق من المعرّف والدفعة."}
            </p>
          </div>
          <div className={styles.routeCode}>
            <small>المعرّف الموحد</small>
            <strong dir="ltr">{traineeCode}</strong>
          </div>
        </header>

        <ol className={styles.routeRail} aria-label="تقدم رحلة القياس">
          {["القياس القبلي", "الأداء اللحظي", "القياس البعدي", "تقرير الأثر", "الشهادة"].map(
            (item, index) => {
              const stepNumber = index + 1;
              const stepClass =
                stepNumber < state.step
                  ? styles.routeStepDone
                  : stepNumber === state.step
                    ? styles.routeStepActive
                    : "";

              return (
                <li
                  key={item}
                  className={`${styles.routeStep} ${stepClass}`}
                  aria-current={stepNumber === state.step ? "step" : undefined}
                >
                  <span dir="ltr">0{stepNumber}</span>
                  <strong>{item}</strong>
                  <small>
                    {stepNumber < state.step
                      ? "مكتمل"
                      : stepNumber === state.step
                        ? "الخطوة الحالية"
                        : "لاحقًا"}
                  </small>
                </li>
              );
            },
          )}
        </ol>

        <section
          className={`${styles.decisionPanel} ${
            isLoading ? styles.loadingPulse : errorMessage ? styles.failed : toneClass
          }`}
          aria-live="polite"
          aria-busy={isLoading}
        >
          <span className={styles.decisionGlyph} aria-hidden="true">
            <Icon
              name={isLoading ? "clock" : errorMessage ? "warning" : decisionIcon}
              size={25}
            />
          </span>
          <div className={styles.decisionCopy}>
            <span className={styles.decision}>
              <Icon
                name={isLoading ? "clock" : errorMessage ? "warning" : decisionIcon}
                size={14}
              />
              {isLoading ? "جارٍ التحقق" : errorMessage ? "تعذر الاتصال" : state.label}
            </span>
            <h2>
              {isLoading
                ? "نراجع حالة التسجيل"
                : errorMessage
                  ? "تعذر تحميل المسار"
                  : state.title}
            </h2>
            <p>
              {isLoading
                ? "لن نعرض أي إجراء قبل مطابقة المعرّف مع تسجيل نشط."
                : errorMessage || state.description}
            </p>

            {!isLoading && !errorMessage && state.actionLabel &&
              (state.actionKind ? (
                <button
                  className={styles.button}
                  type="button"
                  disabled={isOpeningAssessment}
                  onClick={() => void openAssessment(state.actionKind!)}
                >
                  {isOpeningAssessment ? "جارٍ إنشاء الرابط الآمن..." : state.actionLabel}
                  <Icon name={isOpeningAssessment ? "clock" : "external"} size={16} />
                </button>
              ) : state.actionUrl?.startsWith("/") ? (
                <Link className={styles.button} href={state.actionUrl}>
                  {state.actionLabel}
                  <Icon name="external" size={16} />
                </Link>
              ) : (
                <a
                  className={styles.button}
                  href={state.actionUrl ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                >
                  {state.actionLabel}
                  <Icon name="external" size={16} />
                </a>
              ))}

            {actionErrorMessage ? (
              <p className={styles.error} role="alert">
                {actionErrorMessage}
              </p>
            ) : null}
          </div>

          <aside className={styles.routePrivacy}>
            <Icon name="lock" size={18} />
            <span>
              لا تعرض الصفحة الاسم أو الهاتف أو البريد. عند جاهزية القياس
              ينتقل المعرّف إلى النموذج تلقائيًا ولا يكتبه المتدرّب.
            </span>
          </aside>
        </section>
      </article>
    </main>
  );
}
