"use client";

import Link from "next/link";
import QRCode from "qrcode";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell, StatusBadge } from "./app-shell";
import { Icon } from "./icons";
import { createSupabaseBrowserClient } from "../lib/supabase/client";
import {
  isXapiTestEvent,
  type XapiDisplayRecord,
  xapiObjectLabel,
  xapiResultLabel,
  xapiVerbLabel,
} from "../lib/xapi-display";

type Tone = "success" | "warning" | "danger" | "system" | "muted";

type TraineeRecord = {
  id: string;
  code: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  status: "active" | "inactive" | "archived";
};

type EnrollmentRecord = {
  id: string;
  cohort_id: string;
  status: "invited" | "active" | "completed" | "withdrawn" | "cancelled";
  enrolled_at: string;
};

type CohortRecord = {
  id: string;
  title: string;
  code: string;
  status: "draft" | "open" | "in_progress" | "closed" | "archived";
  program_id: string;
  program_version_id: string;
};

type ProgramRecord = {
  title_ar: string;
  slug: string;
};

type ProgramVersionRecord = {
  pass_threshold: number;
  status: "draft" | "published" | "retired";
};

type AssessmentRecord = {
  assessment_kind: "pre" | "post";
  score_percentage: number;
  submitted_at: string;
};

type JourneyData = {
  trainee: TraineeRecord;
  enrollment: EnrollmentRecord;
  cohort: CohortRecord;
  program: ProgramRecord;
  version: ProgramVersionRecord;
  hasPreForm: boolean;
  hasPostForm: boolean;
  assessments: AssessmentRecord[];
  xapiEvents: XapiDisplayRecord[];
  liveEventCount: number;
  testEventCount: number;
  hasImpactReport: boolean;
  certificateVerifyCode: string | null;
};

type StageStatus = {
  label: string;
  detail: string;
  tone: Tone;
  value: string;
};

function enrollmentLabel(status: EnrollmentRecord["status"]) {
  const labels: Record<EnrollmentRecord["status"], string> = {
    invited: "مدعو",
    active: "نشط",
    completed: "مكتمل",
    withdrawn: "منسحب",
    cancelled: "ملغى",
  };

  return labels[status];
}

export function TraineeDetailsPage({ traineeCode }: { traineeCode: string }) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [data, setData] = useState<JourneyData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [personalUrl, setPersonalUrl] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [previewKind, setPreviewKind] = useState<"pre" | "post" | null>(
    null,
  );
  const [previewError, setPreviewError] = useState("");

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setErrorMessage("تعذر التحقق من جلسة المستخدم.");
      setIsLoading(false);
      return;
    }

    const { data: membership } = await supabase
      .from("memberships")
      .select("org_id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!membership) {
      setErrorMessage("لا توجد عضوية نشطة مرتبطة بهذا الحساب.");
      setIsLoading(false);
      return;
    }

    const { data: trainee, error: traineeError } = await supabase
      .from("trainees")
      .select("id, code, full_name, phone, email, status")
      .eq("org_id", membership.org_id)
      .eq("code", traineeCode)
      .maybeSingle();

    if (traineeError || !trainee) {
      setErrorMessage("لم يُعثر على متدرب بهذا المعرّف داخل الجهة الحالية.");
      setIsLoading(false);
      return;
    }

    const { data: enrollment } = await supabase
      .from("enrollments")
      .select("id, cohort_id, status, enrolled_at")
      .eq("org_id", membership.org_id)
      .eq("trainee_id", trainee.id)
      .not("status", "in", '("withdrawn","cancelled")')
      .order("enrolled_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!enrollment) {
      setErrorMessage("المتدرب موجود، لكن لا يوجد تسجيل نشط مرتبط بدفعة.");
      setIsLoading(false);
      return;
    }

    const { data: cohort } = await supabase
      .from("cohorts")
      .select("id, title, code, status, program_id, program_version_id")
      .eq("org_id", membership.org_id)
      .eq("id", enrollment.cohort_id)
      .single();

    if (!cohort) {
      setErrorMessage("تعذر تحميل الدفعة المرتبطة بالمتدرب.");
      setIsLoading(false);
      return;
    }

    const [
      { data: program },
      { data: version },
      { data: forms },
      { data: assessments },
      { data: xapiEventRows },
      { data: impactReport },
      { data: certificate },
    ] = await Promise.all([
      supabase
        .from("programs")
        .select("title_ar, slug")
        .eq("org_id", membership.org_id)
        .eq("id", cohort.program_id)
        .single(),
      supabase
        .from("program_versions")
        .select("pass_threshold, status")
        .eq("org_id", membership.org_id)
        .eq("id", cohort.program_version_id)
        .single(),
      supabase
        .from("jotform_forms")
        .select("assessment_kind")
        .eq("org_id", membership.org_id)
        .eq("program_version_id", cohort.program_version_id)
        .eq("is_active", true),
      supabase
        .from("assessments")
        .select("assessment_kind, score_percentage, submitted_at")
        .eq("org_id", membership.org_id)
        .eq("enrollment_id", enrollment.id),
      supabase
        .from("xapi_statements")
        .select(
          "id, statement_id, enrollment_id, trainee_code_received, program_id, session_id, verb_id, object_id, result, context, raw_statement, processing_status, rejection_reason, occurred_at, received_at",
        )
        .eq("org_id", membership.org_id)
        .eq("enrollment_id", enrollment.id)
        .eq("processing_status", "accepted")
        .order("occurred_at", { ascending: false })
        .limit(50),
      supabase
        .from("impact_reports")
        .select("id")
        .eq("org_id", membership.org_id)
        .eq("enrollment_id", enrollment.id)
        .eq("status", "computed")
        .limit(1)
        .maybeSingle(),
      supabase
        .from("certificates")
        .select("verify_code")
        .eq("org_id", membership.org_id)
        .eq("enrollment_id", enrollment.id)
        .eq("status", "valid")
        .limit(1)
        .maybeSingle(),
    ]);

    if (!program || !version) {
      setErrorMessage("تعذر تحميل البرنامج أو نسخته المرتبطة.");
      setIsLoading(false);
      return;
    }

    const xapiEvents = (xapiEventRows ?? []) as XapiDisplayRecord[];
    const performanceEvents = xapiEvents.filter(
      (event) => !isXapiTestEvent(event),
    );
    const testEvents = xapiEvents.filter(isXapiTestEvent);

    setData({
      trainee: trainee as TraineeRecord,
      enrollment: enrollment as EnrollmentRecord,
      cohort: cohort as CohortRecord,
      program: program as ProgramRecord,
      version: version as ProgramVersionRecord,
      hasPreForm: (forms ?? []).some(
        (form) => form.assessment_kind === "pre",
      ),
      hasPostForm: (forms ?? []).some(
        (form) => form.assessment_kind === "post",
      ),
      assessments: (assessments ?? []) as AssessmentRecord[],
      xapiEvents,
      liveEventCount: performanceEvents.length,
      testEventCount: testEvents.length,
      hasImpactReport: Boolean(impactReport),
      certificateVerifyCode: certificate?.verify_code ?? null,
    });
    setIsLoading(false);
  }, [supabase, traineeCode]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
      window.location.origin;
    const url = `${baseUrl}/t/${encodeURIComponent(traineeCode)}`;

    setPersonalUrl(url);
    void QRCode.toDataURL(url, {
      width: 280,
      margin: 2,
      color: {
        dark: "#111827",
        light: "#ffffff",
      },
      errorCorrectionLevel: "M",
    }).then(setQrDataUrl);
  }, [traineeCode]);

  const copyUrl = async () => {
    await navigator.clipboard.writeText(personalUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const openAssessmentPreview = async (
    assessmentKind: "pre" | "post",
  ) => {
    setPreviewKind(assessmentKind);
    setPreviewError("");

    try {
      const response = await fetch("/api/assessments/preview-link", {
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
        setPreviewError(
          result.message ?? "تعذر إنشاء رابط المعاينة.",
        );
        return;
      }

      window.location.assign(result.url);
    } catch {
      setPreviewError(
        "تعذر الاتصال بخدمة المعاينة. حاول مرة أخرى.",
      );
    } finally {
      setPreviewKind(null);
    }
  };

  if (isLoading) {
    return (
      <AppShell title="تفاصيل المتدرب">
        <section className="content-section loading-state">
          جارٍ تحميل رحلة المتدرب...
        </section>
      </AppShell>
    );
  }

  if (!data) {
    return (
      <AppShell title="تفاصيل المتدرب">
        <section className="content-section empty-state">
          <Icon name="warning" size={30} />
          <h3>تعذر فتح رحلة المتدرب</h3>
          <p>{errorMessage}</p>
          <Link className="button button-secondary" href="/trainees">
            العودة إلى المتدربين
          </Link>
        </section>
      </AppShell>
    );
  }

  const preAssessment = data.assessments.find(
    (assessment) => assessment.assessment_kind === "pre",
  );
  const postAssessment = data.assessments.find(
    (assessment) => assessment.assessment_kind === "post",
  );
  const cohortCanRun = ["open", "in_progress"].includes(data.cohort.status);

  const stages: Array<{ title: string; source: string; status: StageStatus }> = [
    {
      title: "القياس القبلي",
      source: "Jotform",
      status: preAssessment
        ? {
            label: "مكتمل",
            detail: "وصلت نتيجة قبلية موثقة.",
            tone: "success",
            value: `${preAssessment.score_percentage}%`,
          }
        : data.hasPreForm
          ? {
              label: cohortCanRun ? "جاهز" : "بانتظار فتح الدفعة",
              detail: "النموذج مربوط ولم تصل نتيجة بعد.",
              tone: "warning",
              value: "—",
            }
          : {
              label: "غير مربوط",
              detail: "لم يُربط نموذج قبلي بهذه النسخة.",
              tone: "muted",
              value: "—",
            },
    },
    {
      title: "الأداء اللحظي",
      source: "AmadXR · xAPI",
      status:
        data.liveEventCount > 0
          ? {
              label: "موثّق",
              detail: "أحداث مقبولة ومطابقة للمعرّف.",
              tone: "system",
              value: String(data.liveEventCount),
            }
          : {
              label:
                data.testEventCount > 0
                  ? "الاتصال مختبر"
                  : "بانتظار البيانات",
              detail:
                data.testEventCount > 0
                  ? "نجح اختبار xAPI، ولم تصل أحداث أداء فعلية بعد."
                  : "لا توجد أحداث أداء مطابقة حتى الآن.",
              tone: data.testEventCount > 0 ? "system" : "muted",
              value: "0",
            },
    },
    {
      title: "القياس البعدي",
      source: "Jotform",
      status: postAssessment
        ? {
            label: "مكتمل",
            detail: "وصلت نتيجة بعدية موثقة.",
            tone: "success",
            value: `${postAssessment.score_percentage}%`,
          }
        : data.hasPostForm
          ? {
              label: preAssessment ? "جاهز" : "بانتظار القبلي",
              detail: "النموذج مربوط ولم تصل نتيجة بعد.",
              tone: "warning",
              value: "—",
            }
          : {
              label: "غير مربوط",
              detail: "لم يُربط نموذج بعدي بهذه النسخة.",
              tone: "muted",
              value: "—",
            },
    },
    {
      title: "تقرير الأثر",
      source: "محرك المقياس",
      status: data.hasImpactReport
        ? {
            label: "محسوب",
            detail: "تقرير الأثر الفردي محفوظ.",
            tone: "success",
            value: "جاهز",
          }
        : {
            label: "غير محسوب",
            detail: "ينتظر اكتمال بيانات القياس.",
            tone: "muted",
            value: "—",
          },
    },
    {
      title: "الشهادة",
      source: "منظومة المقياس",
      status: data.certificateVerifyCode
        ? {
            label: "صادرة",
            detail: "توجد شهادة صالحة مرتبطة بالتسجيل.",
            tone: "success",
            value: "صالحة",
          }
        : {
            label: "غير صادرة",
            detail: `تنتظر نتيجة بعدية تبلغ ${data.version.pass_threshold}% أو أكثر.`,
            tone: "muted",
            value: "—",
          },
    },
  ];

  const isLocalUrl =
    personalUrl.includes("127.0.0.1") || personalUrl.includes("localhost");

  return (
    <AppShell title="تفاصيل المتدرب">
      <div className="trainee-page-head">
        <div>
          <div className="breadcrumb-row">
            <Link href="/trainees">المتدرّبون</Link>
            <Icon name="chevron" size={14} />
            <span dir="ltr">{data.trainee.code}</span>
          </div>
          <span className="eyebrow">
            {data.cohort.title} · {enrollmentLabel(data.enrollment.status)}
          </span>
          <h1>{data.trainee.full_name}</h1>
          <p>{data.program.title_ar}</p>
        </div>
        <div className="trainee-id-card">
          <span>المعرّف الموحد</span>
          <strong dir="ltr">{data.trainee.code}</strong>
          <Link href={`/t/${data.trainee.code}`} target="_blank">
            <Icon name="external" size={14} />
            فتح الصفحة الشخصية
          </Link>
        </div>
      </div>

      <div className="live-data-notice">
        <Icon name="shield" size={17} />
        <span>
          <strong>رحلة حقيقية.</strong> لا تعرض الصفحة درجات أو أحداثًا غير
          موجودة في قاعدة البيانات.
        </span>
      </div>

      {data.cohort.status === "draft" &&
      (data.hasPreForm || data.hasPostForm) ? (
        <section className="content-section preview-assessment-panel">
          <div>
            <span className="eyebrow">اختبار التكامل قبل فتح الدفعة</span>
            <h2>معاينة نماذج القياس</h2>
            <p>
              استخدم متدرّب اختبار فقط. الإرسال الناجح سيُحفظ كتقييم حقيقي
              مرتبط بهذا المعرّف حتى نتحقق من التصحيح ومنع التكرار.
            </p>
          </div>
          <div className="preview-assessment-actions">
            {data.hasPreForm && !preAssessment ? (
              <button
                className="button button-secondary"
                type="button"
                disabled={previewKind !== null}
                onClick={() => {
                  void openAssessmentPreview("pre");
                }}
              >
                <Icon
                  name={previewKind === "pre" ? "clock" : "external"}
                  size={16}
                />
                {previewKind === "pre"
                  ? "جارٍ إنشاء الرابط..."
                  : "معاينة القياس القبلي"}
              </button>
            ) : null}
            {data.hasPostForm && !postAssessment ? (
              <button
                className="button button-secondary"
                type="button"
                disabled={previewKind !== null}
                onClick={() => {
                  void openAssessmentPreview("post");
                }}
              >
                <Icon
                  name={previewKind === "post" ? "clock" : "external"}
                  size={16}
                />
                {previewKind === "post"
                  ? "جارٍ إنشاء الرابط..."
                  : "معاينة القياس البعدي"}
              </button>
            ) : null}
          </div>
          {previewError ? (
            <p className="field-error" role="alert">
              {previewError}
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="trainee-detail-grid">
        <div className="content-section">
          <div className="section-title">
            <div>
              <span className="eyebrow">حالة الأدلة</span>
              <h2>رحلة القياس</h2>
            </div>
            <StatusBadge tone={cohortCanRun ? "system" : "warning"}>
              {data.cohort.status === "draft"
                ? "الدفعة مسودة"
                : data.cohort.status === "open"
                  ? "الدفعة مفتوحة"
                  : data.cohort.status === "in_progress"
                    ? "قيد التشغيل"
                    : "الدفعة مغلقة"}
            </StatusBadge>
          </div>
          <div className="real-journey-list">
            {stages.map((stage, index) => (
              <article key={stage.title}>
                <span className="journey-number">{index + 1}</span>
                <div>
                  <small>{stage.source}</small>
                  <strong>{stage.title}</strong>
                  <p>{stage.status.detail}</p>
                </div>
                <strong className="journey-value" dir="auto">
                  {stage.status.value}
                </strong>
                <StatusBadge tone={stage.status.tone}>
                  {stage.status.label}
                </StatusBadge>
              </article>
            ))}
          </div>
        </div>

        <aside className="content-section personal-link-card">
          <div>
            <span className="eyebrow">الرابط الشخصي</span>
            <h2>بطاقة المتدرب</h2>
            <p>
              يفتح هذا الرابط مسار المتدرب دون كشف الهاتف أو البريد الإلكتروني.
            </p>
          </div>
          {qrDataUrl && (
            <img src={qrDataUrl} alt={`رمز الاستجابة السريعة ${data.trainee.code}`} />
          )}
          <code dir="ltr">{personalUrl}</code>
          {isLocalUrl && (
            <div className="inline-feedback warning-feedback">
              <Icon name="warning" size={16} />
              هذا رابط محلي؛ لن يعمل مسحه من الجوال قبل النشر.
            </div>
          )}
          <div className="personal-link-actions">
            <button className="button button-secondary" onClick={copyUrl}>
              <Icon name={copied ? "check" : "source"} size={16} />
              {copied ? "تم النسخ" : "نسخ الرابط"}
            </button>
            {qrDataUrl && (
              <a
                className="button button-primary"
                href={qrDataUrl}
                download={`${data.trainee.code}-qr.png`}
              >
                <Icon name="download" size={16} />
                تنزيل الرمز
              </a>
            )}
          </div>
        </aside>
      </section>

      <section className="content-section trainee-xapi-events">
        <div className="section-title">
          <div>
            <span className="eyebrow">AmadXR · xAPI</span>
            <h2>سجل الأحداث المستلمة</h2>
          </div>
          <StatusBadge
            tone={data.liveEventCount > 0 ? "success" : "system"}
          >
            {data.liveEventCount > 0
              ? `${data.liveEventCount} أحداث أداء`
              : `${data.testEventCount} اختبارات اتصال`}
          </StatusBadge>
        </div>

        {data.xapiEvents.length === 0 ? (
          <div className="empty-state compact-empty-state">
            <Icon name="sessions" size={26} />
            <h3>لم تصل أحداث xAPI</h3>
            <p>ستظهر هنا الأحداث المقبولة والمطابقة لهذا التسجيل.</p>
          </div>
        ) : (
          <div className="event-stream">
            <div className="event-stream-head">
              <span>الوقت</span>
              <span>الفعل</span>
              <span>الكائن</span>
              <span>النتيجة</span>
            </div>
            {data.xapiEvents.map((event) => (
              <div className="event-stream-row" key={event.id}>
                <span className="mono">
                  {new Intl.DateTimeFormat("ar-SA", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  }).format(new Date(event.occurred_at))}
                </span>
                <span>{xapiVerbLabel(event.verb_id)}</span>
                <span>{xapiObjectLabel(event)}</span>
                <span className="xapi-event-result">
                  {xapiResultLabel(event)}
                  {isXapiTestEvent(event) && (
                    <StatusBadge tone="system">اختبار</StatusBadge>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}
