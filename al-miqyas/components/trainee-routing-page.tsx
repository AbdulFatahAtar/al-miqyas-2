"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "./icons";
import { StatusBadge } from "./app-shell";
import { createSupabaseBrowserClient } from "../lib/supabase/client";

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
  certificate_verify_code: string | null;
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
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [data, setData] = useState<PublicRouteData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpeningAssessment, setIsOpeningAssessment] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [actionErrorMessage, setActionErrorMessage] = useState("");

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      setErrorMessage("");

      const { data: result, error } = await supabase.rpc(
        "get_public_trainee_route",
        {
          p_trainee_code: traineeCode,
        },
      );

      if (error) {
        setErrorMessage(
          error.code === "42883" ||
            error.message.includes("get_public_trainee_route")
            ? "صفحة المتدرب العامة لم تُفعّل بعد. طبّق ملف SQL رقم 007."
            : "تعذر التحقق من الرابط الآن.",
        );
        setIsLoading(false);
        return;
      }

      const routeData = Array.isArray(result) ? result[0] : result;
      setData((routeData as PublicRouteData | undefined) ?? null);
      setIsLoading(false);
    };

    void load();
  }, [supabase, traineeCode]);

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

    if (data.certificate_verify_code) {
      return {
        label: "اكتملت الرحلة",
        title: "شهادتك صادرة",
        description:
          "وصلت القياسات المطلوبة وصدر إثبات صالح مرتبط برحلتك.",
        actionLabel: "فتح صفحة التحقق",
        actionUrl: `/verify/${data.certificate_verify_code}`,
        actionKind: null,
        tone: "success",
        step: 5,
      };
    }

    return {
      label: "اكتملت القياسات",
      title: "بانتظار التقرير والشهادة",
      description:
        "وصل القياس القبلي والبعدي. ستظهر الشهادة بعد التحقق من شروط الاجتياز.",
      actionLabel: null,
      actionUrl: null,
      actionKind: null,
      tone: "success",
      step: 4,
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

  return (
    <main className="public-page public-routing">
      <header className="public-header">
        <div className="public-brand">
          <img
            className="brand-mark"
            src="/brand/al-amad-mark.png"
            alt="شعار شركة الأمد"
          />
          <div>
            <strong>منظومة المقياس</strong>
            <small>تُشغّل بواسطة شركة الأمد</small>
          </div>
        </div>
        <Link href="/login">دخول المشرفين</Link>
      </header>

      <div className="public-content public-content-single">
        <section className="routing-card">
          <div className="routing-top">
            <div>
              <span className="eyebrow">بطاقة المتدرّب</span>
              <h1>{isLoading ? "جارٍ التحقق..." : state.title}</h1>
              <p>
                {data
                  ? `${data.program_title} · ${data.cohort_title}`
                  : "منظومة المقياس"}
              </p>
            </div>
            <div className="public-code">
              <small>المعرّف الموحد</small>
              <strong dir="ltr">{traineeCode}</strong>
            </div>
          </div>

          <div className="public-step-rail" aria-label="تقدم رحلة القياس">
            {["قبلي", "لحظي", "بعدي", "أثر", "شهادة"].map((item, index) => (
              <div
                key={item}
                className={
                  index + 1 < state.step
                    ? "done"
                    : index + 1 === state.step
                      ? "active"
                      : ""
                }
              >
                <span>{index + 1}</span>
                <small>{item}</small>
              </div>
            ))}
          </div>

          {isLoading ? (
            <div className="routing-state routing-muted">
              <span className="routing-state-icon">
                <Icon name="clock" size={24} />
              </span>
              <div>
                <StatusBadge tone="muted">جارٍ التحقق</StatusBadge>
                <h2>نراجع حالة التسجيل</h2>
                <p>لن نعرض أي خطوة قبل التحقق من المعرف والدفعة.</p>
              </div>
            </div>
          ) : errorMessage ? (
            <div className="routing-state routing-danger">
              <span className="routing-state-icon">
                <Icon name="warning" size={24} />
              </span>
              <div>
                <StatusBadge tone="danger">تعذر الاتصال</StatusBadge>
                <h2>تعذر تحميل المسار</h2>
                <p>{errorMessage}</p>
              </div>
            </div>
          ) : (
            <div className={`routing-state routing-${state.tone}`}>
              <span className="routing-state-icon">
                <Icon
                  name={
                    state.tone === "danger"
                      ? "warning"
                      : state.tone === "success"
                        ? "check"
                        : "arrow"
                  }
                  size={24}
                />
              </span>
              <div>
                <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
                <h2>{state.title}</h2>
                <p>{state.description}</p>
                {state.actionLabel &&
                  (state.actionKind ? (
                    <button
                      className="button button-primary"
                      type="button"
                      disabled={isOpeningAssessment}
                      onClick={() => {
                        void openAssessment(state.actionKind!);
                      }}
                    >
                      {isOpeningAssessment
                        ? "جارٍ إنشاء الرابط الآمن..."
                        : state.actionLabel}
                      <Icon
                        name={isOpeningAssessment ? "clock" : "external"}
                        size={16}
                      />
                    </button>
                  ) : state.actionUrl?.startsWith("/") ? (
                    <Link className="button button-primary" href={state.actionUrl}>
                      {state.actionLabel}
                      <Icon name="external" size={16} />
                    </Link>
                  ) : (
                    <a
                      className="button button-primary"
                      href={state.actionUrl ?? undefined}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {state.actionLabel}
                      <Icon name="external" size={16} />
                    </a>
                  ))}
                {actionErrorMessage ? (
                  <p className="field-error" role="alert">
                    {actionErrorMessage}
                  </p>
                ) : null}
              </div>
            </div>
          )}

          <div className="privacy-note">
            <Icon name="lock" size={17} />
            <span>
              لا تعرض هذه الصفحة اسم المتدرب أو هاتفه أو بريده الإلكتروني.
              ينتقل المعرف إلى نموذج القياس تلقائيًا عند جاهزيته.
            </span>
          </div>
        </section>
      </div>
    </main>
  );
}
