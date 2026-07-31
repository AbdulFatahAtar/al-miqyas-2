"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppShell, PageHeader, StatusBadge } from "./app-shell";
import { Icon } from "./icons";
import { createSupabaseBrowserClient } from "../lib/supabase/client";

type JsonRecord = Record<string, unknown>;

type EnrollmentRecord = {
  id: string;
  trainee_id: string;
  cohort_id: string;
  status: "invited" | "active" | "completed" | "withdrawn" | "cancelled";
};

type TraineeRecord = {
  id: string;
  code: string;
  full_name: string;
};

type CohortRecord = {
  id: string;
  title: string;
  program_id: string;
  program_version_id: string;
};

type ProgramRecord = {
  id: string;
  title_ar: string;
};

type ProgramVersionRecord = {
  id: string;
  pass_threshold: number;
};

type TestProgramVersionRecord = ProgramVersionRecord & {
  answer_key: JsonRecord;
  confidence_config: JsonRecord;
};

type TestTraineeRecord = TraineeRecord & {
  email: string | null;
};

type TestEnrollmentResult = {
  trainee_id: string;
  trainee_code: string;
  enrollment_id: string;
};

type AssessmentPreviewResult = {
  form_id: string;
  trainee_code: string;
  submission_token: string;
};

type AssessmentRecord = {
  enrollment_id: string;
  score_percentage: number;
  submitted_at: string;
};

type CertificateStatus = "valid" | "revoked" | "superseded";

type CertificateRecord = {
  id: string;
  certificate_number: string;
  verify_code: string;
  enrollment_id: string;
  status: CertificateStatus;
  public_snapshot: JsonRecord;
  metrics_snapshot: JsonRecord;
  issued_at: string;
  revoked_at: string | null;
  revoke_reason: string | null;
  supersedes_certificate_id: string | null;
};

type EligibilityRow = {
  enrollmentId: string;
  traineeCode: string;
  traineeName: string;
  cohortTitle: string;
  programTitle: string;
  postScore: number | null;
  passThreshold: number;
  certificate: CertificateRecord | null;
};

function certificateHasCurrentData(row: EligibilityRow) {
  const certificate = row.certificate;

  if (!certificate) {
    return true;
  }

  return (
    snapshotText(certificate.public_snapshot, "trainee_name") ===
      row.traineeName &&
    snapshotText(certificate.public_snapshot, "trainee_code") ===
      row.traineeCode &&
    snapshotText(certificate.public_snapshot, "program_title") ===
      row.programTitle &&
    snapshotText(certificate.public_snapshot, "cohort_title") ===
      row.cohortTitle
  );
}

function snapshotText(snapshot: JsonRecord, key: string) {
  const value = snapshot[key];
  return typeof value === "string" ? value : "";
}

function formatScore(value: number | null) {
  return value === null
    ? "—"
    : `${new Intl.NumberFormat("ar-SA", {
        maximumFractionDigits: 2,
      }).format(value)}%`;
}

function formatDate(value: string | null) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("ar-SA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function certificateStatusMeta(status: CertificateStatus) {
  if (status === "valid") {
    return { label: "صالحة", tone: "success" as const };
  }

  if (status === "revoked") {
    return { label: "ملغاة", tone: "danger" as const };
  }

  return { label: "مستبدلة", tone: "muted" as const };
}

function eligibilityMeta(row: EligibilityRow) {
  if (row.certificate?.status === "valid") {
    if (!certificateHasCurrentData(row)) {
      return { label: "تحتاج إصدارًا جديدًا", tone: "warning" as const };
    }

    return { label: "صادرة", tone: "success" as const };
  }

  if (row.certificate?.status === "revoked") {
    return { label: "تحتاج إعادة إصدار", tone: "warning" as const };
  }

  if (row.certificate?.status === "superseded") {
    return { label: "مستبدلة", tone: "muted" as const };
  }

  if (row.postScore === null) {
    return { label: "بانتظار البعدي", tone: "muted" as const };
  }

  if (row.postScore >= row.passThreshold) {
    return { label: "مستحقة", tone: "success" as const };
  }

  return { label: "غير مستحقة", tone: "danger" as const };
}

const certificateTestEmail =
  "certificate-lifecycle-20260728@example.test";

function firstRpcRow<T>(data: T | T[] | null) {
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

function jsonObject(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

export function CertificatesLivePage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const automaticTestStarted = useRef(false);
  const [orgId, setOrgId] = useState("");
  const [role, setRole] = useState<"owner" | "trainer" | "viewer">(
    "viewer",
  );
  const [rows, setRows] = useState<EligibilityRow[]>([]);
  const [certificates, setCertificates] = useState<CertificateRecord[]>([]);
  const [filter, setFilter] = useState<
    "all" | "valid" | "revoked" | "superseded"
  >("all");
  const [isLoading, setIsLoading] = useState(true);
  const [isIssuing, setIsIssuing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [selectedCertificate, setSelectedCertificate] =
    useState<CertificateRecord | null>(null);
  const [modalMode, setModalMode] = useState<
    "revoke" | "reissue" | "replace" | null
  >(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [isApplyingAction, setIsApplyingAction] = useState(false);
  const [isCreatingTestCandidate, setIsCreatingTestCandidate] =
    useState(false);
  const [downloadingCertificateId, setDownloadingCertificateId] =
    useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setErrorMessage("تعذر التحقق من جلسة المستخدم.");
      setIsLoading(false);
      return;
    }

    const { data: membership } = await supabase
      .from("memberships")
      .select("org_id, role")
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

    setOrgId(membership.org_id);
    setRole(membership.role);

    const [
      { data: enrollmentRows, error: enrollmentError },
      { data: traineeRows },
      { data: cohortRows },
      { data: programRows },
      { data: versionRows },
      { data: assessmentRows },
      { data: certificateRows, error: certificateError },
    ] = await Promise.all([
      supabase
        .from("enrollments")
        .select("id, trainee_id, cohort_id, status")
        .eq("org_id", membership.org_id)
        .in("status", ["active", "completed"]),
      supabase
        .from("trainees")
        .select("id, code, full_name")
        .eq("org_id", membership.org_id),
      supabase
        .from("cohorts")
        .select("id, title, program_id, program_version_id")
        .eq("org_id", membership.org_id),
      supabase
        .from("programs")
        .select("id, title_ar")
        .eq("org_id", membership.org_id),
      supabase
        .from("program_versions")
        .select("id, pass_threshold")
        .eq("org_id", membership.org_id),
      supabase
        .from("assessments")
        .select("enrollment_id, score_percentage, submitted_at")
        .eq("org_id", membership.org_id)
        .eq("assessment_kind", "post")
        .order("submitted_at", { ascending: false }),
      supabase
        .from("certificates")
        .select(
          "id, certificate_number, verify_code, enrollment_id, status, public_snapshot, metrics_snapshot, issued_at, revoked_at, revoke_reason, supersedes_certificate_id",
        )
        .eq("org_id", membership.org_id)
        .order("issued_at", { ascending: false }),
    ]);

    if (enrollmentError || certificateError) {
      setErrorMessage("تعذر تحميل بيانات الشهادات.");
      setIsLoading(false);
      return;
    }

    const enrollments = (enrollmentRows ?? []) as EnrollmentRecord[];
    const trainees = (traineeRows ?? []) as TraineeRecord[];
    const cohorts = (cohortRows ?? []) as CohortRecord[];
    const programs = (programRows ?? []) as ProgramRecord[];
    const versions = (versionRows ?? []) as ProgramVersionRecord[];
    const assessments = (assessmentRows ?? []) as AssessmentRecord[];
    const nextCertificates = (certificateRows ?? []) as CertificateRecord[];

    setCertificates(nextCertificates);
    setRows(
      enrollments.map((enrollment) => {
        const trainee = trainees.find(
          (item) => item.id === enrollment.trainee_id,
        );
        const cohort = cohorts.find(
          (item) => item.id === enrollment.cohort_id,
        );
        const program = programs.find(
          (item) => item.id === cohort?.program_id,
        );
        const version = versions.find(
          (item) => item.id === cohort?.program_version_id,
        );
        const assessment = assessments.find(
          (item) => item.enrollment_id === enrollment.id,
        );
        const latestCertificate = nextCertificates.find(
          (item) => item.enrollment_id === enrollment.id,
        );

        return {
          enrollmentId: enrollment.id,
          traineeCode: trainee?.code ?? "غير معروف",
          traineeName: trainee?.full_name ?? "متدرّب غير معروف",
          cohortTitle: cohort?.title ?? "دفعة غير معروفة",
          programTitle: program?.title_ar ?? "برنامج غير معروف",
          postScore: assessment?.score_percentage ?? null,
          passThreshold: Math.max(version?.pass_threshold ?? 80, 80),
          certificate: latestCertificate ?? null,
        };
      }),
    );
    setIsLoading(false);
  }, [supabase]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const createCertificateTestCandidate = useCallback(async () => {
    if (
      process.env.NODE_ENV === "production" ||
      !orgId ||
      role === "viewer" ||
      isCreatingTestCandidate
    ) {
      return;
    }

    setIsCreatingTestCandidate(true);
    setErrorMessage("");
    setFeedbackMessage("");

    try {
      const { data: cohort, error: cohortError } = await supabase
        .from("cohorts")
        .select("id, program_version_id")
        .eq("org_id", orgId)
        .in("status", ["draft", "open", "in_progress"])
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (cohortError || !cohort) {
        throw new Error("لا توجد دفعة متاحة لإنشاء متدرّب الاختبار.");
      }

      const { data: version, error: versionError } = await supabase
        .from("program_versions")
        .select("id, pass_threshold, answer_key, confidence_config")
        .eq("id", cohort.program_version_id)
        .eq("org_id", orgId)
        .maybeSingle<TestProgramVersionRecord>();

      if (versionError || !version) {
        throw new Error("تعذر قراءة إعدادات القياس للدفعة.");
      }

      const questions = jsonObject(version.answer_key.questions);
      const confidenceConfig = jsonObject(version.confidence_config);
      const confidenceItems = jsonObject(confidenceConfig.items);
      const responseValues = jsonObject(
        confidenceConfig.response_values,
      );
      const questionEntries = Object.entries(questions);
      const confidenceKeys = Object.keys(confidenceItems);

      if (questionEntries.length !== 10 || confidenceKeys.length !== 6) {
        throw new Error(
          "إعدادات الاختبار غير مكتملة: يلزم 10 أسئلة و6 بنود ثقة.",
        );
      }

      const confidenceAnswer = (targetValue: number) => {
        const match = Object.entries(responseValues).find(
          ([, value]) => Number(value) === targetValue,
        );

        if (!match) {
          throw new Error("تعذر مطابقة مقياس الثقة التجريبي.");
        }

        return match[0];
      };

      const { data: existingTraineeData, error: existingTraineeError } =
        await supabase
          .from("trainees")
          .select("id, code, full_name, email")
          .eq("org_id", orgId)
          .eq("email", certificateTestEmail)
          .maybeSingle<TestTraineeRecord>();

      if (existingTraineeError) {
        throw existingTraineeError;
      }

      let traineeId = existingTraineeData?.id ?? "";
      let traineeCode = existingTraineeData?.code ?? "";
      let enrollmentId = "";

      if (existingTraineeData) {
        const { data: existingEnrollment, error: enrollmentError } =
          await supabase
            .from("enrollments")
            .select("id")
            .eq("org_id", orgId)
            .eq("cohort_id", cohort.id)
            .eq("trainee_id", existingTraineeData.id)
            .maybeSingle();

        if (enrollmentError || !existingEnrollment) {
          throw new Error(
            "متدرّب الاختبار موجود لكنه غير مربوط بالدفعة المختارة.",
          );
        }

        enrollmentId = existingEnrollment.id;
      } else {
        const { data: createdData, error: createError } =
          await supabase.rpc("create_trainee_with_enrollment", {
            p_org_id: orgId,
            p_cohort_id: cohort.id,
            p_full_name: "متدرّب اختبار دورة الشهادة",
            p_phone: null,
            p_email: certificateTestEmail,
          });

        if (createError) {
          throw createError;
        }

        const created = firstRpcRow(
          createdData as TestEnrollmentResult[],
        );

        if (!created) {
          throw new Error("لم تُرجع عملية التسجيل بيانات المتدرّب.");
        }

        traineeId = created.trainee_id;
        traineeCode = created.trainee_code;
        enrollmentId = created.enrollment_id;
      }

      const { data: existingAssessments, error: assessmentsError } =
        await supabase
          .from("assessments")
          .select("assessment_kind")
          .eq("org_id", orgId)
          .eq("enrollment_id", enrollmentId);

      if (assessmentsError) {
        throw assessmentsError;
      }

      const completedKinds = new Set(
        (existingAssessments ?? []).map(
          (assessment) => assessment.assessment_kind,
        ),
      );

      for (const kind of ["pre", "post"] as const) {
        if (completedKinds.has(kind)) {
          continue;
        }

        const { data: previewData, error: previewError } =
          await supabase.rpc("create_staff_assessment_preview_link", {
            target_trainee_code: traineeCode,
            target_assessment_kind: kind,
          });

        if (previewError) {
          throw previewError;
        }

        const preview = firstRpcRow(
          previewData as AssessmentPreviewResult[],
        );

        if (!preview) {
          throw new Error("تعذر إنشاء رمز إرسال القياس التجريبي.");
        }

        const answers: JsonRecord = {};
        questionEntries.forEach(([key, rawConfig], index) => {
          const config = jsonObject(rawConfig);
          answers[key] =
            kind === "post" || index < 4
              ? config.correct_value
              : `TEST-WRONG-${key}`;
        });
        confidenceKeys.forEach((key) => {
          answers[key] = confidenceAnswer(kind === "pre" ? 2 : 5);
        });

        const { error: processingError } = await supabase.rpc(
          "process_jotform_submission",
          {
            target_form_id: preview.form_id,
            target_submission_id:
              `certificate-test-${kind}-${traineeCode}-20260728`,
            target_submission_token: preview.submission_token,
            target_submitted_at: new Date().toISOString(),
            target_answers: answers,
            target_payload: {
              test_data: true,
              generated_by: "local-certificate-lifecycle-test",
              trainee_code: traineeCode,
              assessment_kind: kind,
            },
          },
        );

        if (processingError) {
          throw processingError;
        }
      }

      const { error: impactError } = await supabase.rpc(
        "compute_enrollment_impact",
        {
          target_enrollment_id: enrollmentId,
        },
      );

      if (impactError) {
        throw impactError;
      }

      const { data: existingCertificate } = await supabase
        .from("certificates")
        .select("id")
        .eq("org_id", orgId)
        .eq("enrollment_id", enrollmentId)
        .eq("status", "valid")
        .maybeSingle();

      if (!existingCertificate) {
        const { error: certificateError } = await supabase.rpc(
          "issue_enrollment_certificate",
          {
            target_enrollment_id: enrollmentId,
          },
        );

        if (certificateError) {
          throw certificateError;
        }
      }

      setFeedbackMessage(
        `اكتمل متدرّب الاختبار ${traineeCode}: قبلي 40%، بعدي 100%، وحُسب الأثر وأُصدرت الشهادة.`,
      );
      await loadData();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "فشل إنشاء متدرّب اختبار الشهادة.",
      );
    } finally {
      setIsCreatingTestCandidate(false);
    }
  }, [
    isCreatingTestCandidate,
    loadData,
    orgId,
    role,
    supabase,
  ]);

  useEffect(() => {
    if (
      process.env.NODE_ENV === "production" ||
      automaticTestStarted.current ||
      !orgId ||
      role === "viewer"
    ) {
      return;
    }

    const shouldCreate =
      new URLSearchParams(window.location.search).get(
        "createCertificateTest",
      ) === "1";

    if (!shouldCreate) {
      return;
    }

    automaticTestStarted.current = true;
    void createCertificateTestCandidate();
  }, [createCertificateTestCandidate, orgId, role]);

  async function issueEligible() {
    if (!orgId || role === "viewer") {
      return;
    }

    setIsIssuing(true);
    setErrorMessage("");
    setFeedbackMessage("");

    const { data, error } = await supabase.rpc(
      "issue_eligible_certificates",
      {
        target_org_id: orgId,
        target_cohort_id: null,
      },
    );

    if (error) {
      setErrorMessage(error.message || "تعذر إصدار الشهادات.");
      setIsIssuing(false);
      return;
    }

    const result = Array.isArray(data) ? data[0] : data;
    const issued = Number(result?.issued_count ?? 0);
    const existing = Number(result?.existing_count ?? 0);
    const skipped = Number(result?.skipped_count ?? 0);

    setFeedbackMessage(
      `صدرت ${issued} شهادة جديدة، ووجدت ${existing} شهادة صالحة، وتجاوز النظام ${skipped} تسجيلات غير مستحقة أو تحتاج إجراءً منفصلًا.`,
    );
    await loadData();
    setIsIssuing(false);
  }

  async function downloadCertificate(certificate: CertificateRecord) {
    if (certificate.status !== "valid") {
      setErrorMessage(
        "لا يمكن تنزيل شهادة ملغاة أو مستبدلة كوثيقة صالحة.",
      );
      return;
    }

    setDownloadingCertificateId(certificate.id);
    setErrorMessage("");

    try {
      const { downloadCertificatePdf } = await import(
        "../lib/certificate-pdf"
      );

      await downloadCertificatePdf({
        certificateNumber: certificate.certificate_number,
        verifyCode: certificate.verify_code,
        traineeName: snapshotText(
          certificate.public_snapshot,
          "trainee_name",
        ),
        traineeCode: snapshotText(
          certificate.public_snapshot,
          "trainee_code",
        ),
        programTitle: snapshotText(
          certificate.public_snapshot,
          "program_title",
        ),
        organizationName: snapshotText(
          certificate.public_snapshot,
          "organization_name",
        ),
        cohortTitle: snapshotText(
          certificate.public_snapshot,
          "cohort_title",
        ),
        issuedAt: certificate.issued_at,
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "تعذر إنشاء ملف الشهادة.",
      );
    } finally {
      setDownloadingCertificateId(null);
    }
  }

  function openAction(
    certificate: CertificateRecord,
    mode: "revoke" | "reissue" | "replace",
  ) {
    setSelectedCertificate(certificate);
    setModalMode(mode);
    setRevokeReason("");
    setErrorMessage("");
    setFeedbackMessage("");
  }

  function closeAction() {
    if (isApplyingAction) {
      return;
    }
    setSelectedCertificate(null);
    setModalMode(null);
    setRevokeReason("");
  }

  async function applyCertificateAction() {
    if (!selectedCertificate || !modalMode || role !== "owner") {
      return;
    }

    setIsApplyingAction(true);
    setErrorMessage("");

    const { error } =
      modalMode === "revoke"
        ? await supabase.rpc("revoke_certificate", {
            target_certificate_id: selectedCertificate.id,
            target_reason: revokeReason,
          })
        : modalMode === "replace"
          ? await supabase.rpc(
              "replace_certificate_with_current_data",
              {
                target_certificate_id: selectedCertificate.id,
              },
            )
          : await supabase.rpc("reissue_certificate", {
              target_certificate_id: selectedCertificate.id,
            });

    if (error) {
      setErrorMessage(
        error.message ||
          (modalMode === "revoke"
            ? "تعذر إلغاء الشهادة."
            : "تعذر إنشاء الشهادة البديلة."),
      );
      setIsApplyingAction(false);
      return;
    }

    setFeedbackMessage(
      modalMode === "revoke"
        ? "أُلغيت الشهادة، وأصبح رابط التحقق يوضح أنها غير صالحة."
        : "أُصدرت شهادة جديدة بالبيانات الحالية ورقم ورمز تحقق جديدين، وحُفظت القديمة كسجل مستبدل.",
    );
    closeAction();
    await loadData();
    setIsApplyingAction(false);
  }

  if (isLoading) {
    return (
      <AppShell title="الشهادات">
        <section className="content-section loading-state">
          جارٍ تحميل بيانات الشهادات...
        </section>
      </AppShell>
    );
  }

  const eligibleCount = rows.filter(
    (row) =>
      !row.certificate &&
      row.postScore !== null &&
      row.postScore >= row.passThreshold,
  ).length;
  const belowThresholdCount = rows.filter(
    (row) =>
      row.postScore !== null &&
      row.postScore < row.passThreshold,
  ).length;
  const missingPostCount = rows.filter(
    (row) => row.postScore === null,
  ).length;
  const validCount = certificates.filter(
    (certificate) => certificate.status === "valid",
  ).length;
  const filteredCertificates = certificates.filter(
    (certificate) => filter === "all" || certificate.status === filter,
  );

  return (
    <AppShell title="الشهادات">
      <PageHeader
        eyebrow="الإصدار والتحقق"
        title="الشهادات"
        description="إصدار الشهادات المستحقة ومتابعة صلاحيتها دون تعديل الدليل الأصلي."
        actions={
          <>
            {process.env.NODE_ENV !== "production" && (
              <button
                className="button button-secondary"
                onClick={() => void createCertificateTestCandidate()}
                disabled={
                  role === "viewer" || isCreatingTestCandidate
                }
              >
                <Icon name="trainees" size={17} />
                {isCreatingTestCandidate
                  ? "جارٍ إنشاء الاختبار..."
                  : "إنشاء متدرّب اختبار"}
              </button>
            )}
            <button
              className="button button-primary"
              onClick={() => void issueEligible()}
              disabled={role === "viewer" || isIssuing}
            >
              <Icon name="plus" size={17} />
              {isIssuing ? "جارٍ الإصدار..." : "إصدار المستحقة"}
            </button>
          </>
        }
      />

      {errorMessage && (
        <div className="inline-feedback error-feedback">
          <Icon name="warning" size={18} />
          {errorMessage}
        </div>
      )}
      {feedbackMessage && (
        <div className="inline-feedback success-feedback">
          <Icon name="check" size={18} />
          {feedbackMessage}
        </div>
      )}

      <section className="certificate-summary-grid">
        <article>
          <span>صالحة</span>
          <strong>{validCount}</strong>
          <small>روابط تحقق نشطة</small>
        </article>
        <article>
          <span>مستحقة الآن</span>
          <strong>{eligibleCount}</strong>
          <small>بعدي يحقق الحد</small>
        </article>
        <article>
          <span>دون حد الاجتياز</span>
          <strong>{belowThresholdCount}</strong>
          <small>لا تُصدر لها شهادة</small>
        </article>
        <article>
          <span>بانتظار البعدي</span>
          <strong>{missingPostCount}</strong>
          <small>الاستحقاق غير محسوم</small>
        </article>
      </section>

      <section className="content-section table-section certificate-eligibility">
        <div className="section-title">
          <div>
            <span className="eyebrow">قواعد الاستحقاق</span>
            <h2>حالة جميع التسجيلات</h2>
          </div>
        </div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>المتدرّب</th>
                <th>البرنامج</th>
                <th>نتيجة البعدي</th>
                <th>حد الاجتياز</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const eligibility = eligibilityMeta(row);
                return (
                  <tr key={row.enrollmentId}>
                    <td>
                      <strong>{row.traineeName}</strong>
                      <small className="table-subtext mono" dir="ltr">
                        {row.traineeCode}
                      </small>
                    </td>
                    <td>
                      <strong>{row.programTitle}</strong>
                      <small className="table-subtext">
                        {row.cohortTitle}
                      </small>
                    </td>
                    <td>{formatScore(row.postScore)}</td>
                    <td>{formatScore(row.passThreshold)}</td>
                    <td>
                      <StatusBadge tone={eligibility.tone}>
                        {eligibility.label}
                      </StatusBadge>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5}>لا توجد تسجيلات نشطة.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="content-section table-section">
        <div className="table-toolbar">
          <div className="segmented-control compact-control">
            {(
              [
                ["all", "الكل"],
                ["valid", "صالحة"],
                ["revoked", "ملغاة"],
                ["superseded", "مستبدلة"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="result-count">
            {filteredCertificates.length} شهادات
          </span>
        </div>

        {filteredCertificates.length === 0 ? (
          <div className="empty-state certificate-empty">
            <Icon name="certificates" size={30} />
            <h3>لا توجد شهادات ضمن هذا التصنيف</h3>
            <p>
              المتدرّب الحالي غير مستحق لأن نتيجة البعدي أقل من حد
              الاجتياز.
            </p>
          </div>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table certificates-data-table">
              <thead>
                <tr>
                  <th>المتدرّب</th>
                  <th>رقم الشهادة</th>
                  <th>البرنامج</th>
                  <th>تاريخ الإصدار</th>
                  <th>الحالة</th>
                  <th>التحقق</th>
                  <th>ملف الشهادة</th>
                  <th>الإجراء</th>
                </tr>
              </thead>
              <tbody>
                {filteredCertificates.map((certificate) => {
                  const status = certificateStatusMeta(
                    certificate.status,
                  );
                  const eligibilityRow = rows.find(
                    (row) =>
                      row.enrollmentId === certificate.enrollment_id,
                  );
                  const hasCurrentData = eligibilityRow
                    ? certificateHasCurrentData(eligibilityRow)
                    : true;
                  return (
                    <tr key={certificate.id}>
                      <td>
                        <strong>
                          {snapshotText(
                            certificate.public_snapshot,
                            "trainee_name",
                          )}
                        </strong>
                        <small className="table-subtext mono" dir="ltr">
                          {snapshotText(
                            certificate.public_snapshot,
                            "trainee_code",
                          )}
                        </small>
                      </td>
                      <td className="mono" dir="ltr">
                        {certificate.certificate_number}
                      </td>
                      <td>
                        {snapshotText(
                          certificate.public_snapshot,
                          "program_title",
                        )}
                      </td>
                      <td>{formatDate(certificate.issued_at)}</td>
                      <td>
                        <StatusBadge tone={status.tone}>
                          {status.label}
                        </StatusBadge>
                      </td>
                      <td>
                        <Link
                          href={`/verify/${certificate.verify_code}`}
                          className="table-action"
                          target="_blank"
                        >
                          فتح <Icon name="external" size={14} />
                        </Link>
                      </td>
                      <td>
                        {certificate.status === "valid" &&
                        hasCurrentData ? (
                          <button
                            className="table-text-action certificate-download-action"
                            onClick={() =>
                              void downloadCertificate(certificate)
                            }
                            disabled={
                              downloadingCertificateId ===
                              certificate.id
                            }
                          >
                            <Icon name="download" size={14} />
                            {downloadingCertificateId ===
                            certificate.id
                              ? "جارٍ الإنشاء..."
                              : "تنزيل PDF"}
                          </button>
                        ) : certificate.status === "valid" ? (
                          <span className="table-muted">
                            يلزم إصدار جديد
                          </span>
                        ) : (
                          <span className="table-muted">غير متاح</span>
                        )}
                      </td>
                      <td>
                        {role === "owner" &&
                          certificate.status === "valid" &&
                          !hasCurrentData && (
                            <button
                              className="table-text-action"
                              onClick={() =>
                                openAction(certificate, "replace")
                              }
                            >
                              تحديث وإعادة إصدار
                            </button>
                          )}
                        {role === "owner" &&
                          certificate.status === "valid" &&
                          hasCurrentData && (
                            <button
                              className="table-text-action"
                              onClick={() =>
                                openAction(certificate, "replace")
                              }
                            >
                              إعادة إصدار
                            </button>
                          )}
                        {role === "owner" &&
                          certificate.status === "valid" &&
                          hasCurrentData && (
                            <button
                              className="table-text-action danger"
                              onClick={() =>
                                openAction(certificate, "revoke")
                              }
                            >
                              إلغاء
                            </button>
                          )}
                        {role === "owner" &&
                          certificate.status === "revoked" && (
                            <button
                              className="table-text-action"
                              onClick={() =>
                                openAction(certificate, "reissue")
                              }
                            >
                              إعادة إصدار
                            </button>
                          )}
                        {certificate.status === "superseded" && (
                          <span className="table-muted">محفوظة</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedCertificate && modalMode && (
        <div
          className="modal-layer"
          role="presentation"
          onMouseDown={closeAction}
        >
          <section
            className="modal certificate-action-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="certificate-action-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <h2 id="certificate-action-title">
                {modalMode === "revoke"
                  ? "إلغاء الشهادة"
                  : modalMode === "replace"
                    ? "تحديث وإعادة إصدار الشهادة"
                    : "إعادة إصدار الشهادة"}
              </h2>
              <button
                className="icon-button"
                onClick={closeAction}
                disabled={isApplyingAction}
                aria-label="إغلاق"
              >
                <Icon name="close" />
              </button>
            </div>
            <div className="certificate-action-body">
              <div className="read-only-field">
                <span>رقم الشهادة</span>
                <strong dir="ltr">
                  {selectedCertificate.certificate_number}
                </strong>
                <Icon name="lock" size={16} />
              </div>
              {modalMode === "revoke" ? (
                <label>
                  سبب الإلغاء
                  <textarea
                    value={revokeReason}
                    onChange={(event) =>
                      setRevokeReason(event.target.value)
                    }
                    minLength={5}
                    maxLength={500}
                    rows={4}
                    placeholder="اكتب سببًا واضحًا يظهر في سجل التدقيق."
                  />
                </label>
              ) : modalMode === "replace" ? (
                <div className="sample-warning">
                  <Icon name="warning" size={18} />
                  <span>
                    ستصبح الشهادة القديمة مستبدلة، وسيُنشأ إصدار جديد
                    بالاسم والمعرّف والبيانات الحالية مع رقم شهادة ورمز
                    تحقق جديدين.
                  </span>
                </div>
              ) : (
                <div className="sample-warning">
                  <Icon name="warning" size={18} />
                  <span>
                    ستبقى الشهادة القديمة محفوظة كمستبدلة، وسيُنشأ رقم
                    ورمز تحقق جديدان.
                  </span>
                </div>
              )}
            </div>
            <div className="modal-actions certificate-action-actions">
              <button
                className="button button-secondary"
                onClick={closeAction}
                disabled={isApplyingAction}
              >
                رجوع
              </button>
              <button
                className={
                  modalMode === "revoke"
                    ? "button certificate-danger-button"
                    : "button button-primary"
                }
                onClick={() => void applyCertificateAction()}
                disabled={
                  isApplyingAction ||
                  (modalMode === "revoke" &&
                    revokeReason.trim().length < 5)
                }
              >
                {isApplyingAction
                  ? "جارٍ التنفيذ..."
                  : modalMode === "revoke"
                    ? "تأكيد الإلغاء"
                    : "إنشاء شهادة بديلة"}
              </button>
            </div>
          </section>
        </div>
      )}
    </AppShell>
  );
}
