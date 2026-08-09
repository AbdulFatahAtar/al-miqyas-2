"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AppShell } from "./app-shell";
import { AccessibleDialog } from "./accessible-dialog";
import { Icon } from "./icons";
import { createSupabaseBrowserClient } from "../lib/supabase/client";
import styles from "./certificates-live-page.module.css";

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

function decisionClass(tone: "success" | "warning" | "danger" | "muted") {
  if (tone === "success") return styles.decisionSuccess;
  if (tone === "warning") return styles.decisionWarning;
  if (tone === "danger") return styles.decisionDanger;
  return styles.decisionMuted;
}

function decisionIcon(tone: "success" | "warning" | "danger" | "muted") {
  if (tone === "success") return "check" as const;
  if (tone === "danger" || tone === "warning") return "warning" as const;
  return "clock" as const;
}

export function CertificatesLivePage({
  organizationId,
  accessRole,
}: {
  organizationId: string;
  accessRole: "platform_owner" | "owner" | "trainer" | "viewer";
}) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [orgId, setOrgId] = useState(organizationId);
  const [role, setRole] = useState<
    "platform_owner" | "owner" | "trainer" | "viewer"
  >(accessRole);
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
  const [downloadingCertificateId, setDownloadingCertificateId] =
    useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");

    setOrgId(organizationId);
    setRole(accessRole);

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
        .eq("org_id", organizationId)
        .in("status", ["active", "completed"]),
      supabase
        .from("trainees")
        .select("id, code, full_name")
        .eq("org_id", organizationId),
      supabase
        .from("cohorts")
        .select("id, title, program_id, program_version_id")
        .eq("org_id", organizationId),
      supabase
        .from("programs")
        .select("id, title_ar")
        .eq("org_id", organizationId),
      supabase
        .from("program_versions")
        .select("id, pass_threshold")
        .eq("org_id", organizationId),
      supabase
        .from("assessments")
        .select("enrollment_id, score_percentage, submitted_at")
        .eq("org_id", organizationId)
        .eq("assessment_kind", "post")
        .order("submitted_at", { ascending: false }),
      supabase
        .from("certificates")
        .select(
          "id, certificate_number, verify_code, enrollment_id, status, public_snapshot, metrics_snapshot, issued_at, revoked_at, revoke_reason, supersedes_certificate_id",
        )
        .eq("org_id", organizationId)
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
  }, [accessRole, organizationId, supabase]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const canIssueCertificates = role !== "viewer";
  const canManageCertificateLifecycle =
    role === "platform_owner" || role === "owner";

  async function issueEligible() {
    if (!orgId || !canIssueCertificates) {
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
    if (
      !selectedCertificate ||
      !modalMode ||
      !canManageCertificateLifecycle
    ) {
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
        <section className={styles.loading} aria-busy="true" aria-live="polite">
          <span>
            <Icon name="clock" size={19} />
            جارٍ قراءة سجل الشهادات والاستحقاق...
          </span>
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
      <div className={styles.page}>
        <header className={styles.header}>
          <div>
            <span className={styles.kicker}>سجل الإصدار والتحقق</span>
            <h1>دفتر الشهادات</h1>
            <p>
              افحص الاستحقاق، أصدر الشهادات المطابقة، وتابع دورة حياتها مع
              بقاء سجل المصدر والنسخ المستبدلة محفوظًا.
            </p>
          </div>
          <div className={styles.headerAction}>
            <button
              className={styles.button}
              type="button"
              onClick={() => void issueEligible()}
              disabled={!canIssueCertificates || isIssuing}
              aria-describedby={!canIssueCertificates ? "issue-permission-note" : undefined}
            >
              <Icon name="plus" size={17} />
              {isIssuing ? "جارٍ فحص الاستحقاق والإصدار..." : "إصدار جميع المستحقة"}
            </button>
            {!canIssueCertificates && (
              <small id="issue-permission-note">
                صلاحية المشاهدة لا تسمح بإصدار الشهادات.
              </small>
            )}
          </div>
        </header>

        {(errorMessage || feedbackMessage) && (
          <div className={styles.feedbackStack} aria-live="polite">
            {errorMessage && (
              <p className={`${styles.feedback} ${styles.feedbackError}`} role="alert">
                <Icon name="warning" size={18} />
                <span>{errorMessage}</span>
              </p>
            )}
            {feedbackMessage && (
              <p className={`${styles.feedback} ${styles.feedbackSuccess}`}>
                <Icon name="check" size={18} />
                <span>{feedbackMessage}</span>
              </p>
            )}
          </div>
        )}

        <dl className={styles.summary} aria-label="ملخص سجل الشهادات">
          <div className={styles.summarySuccess}>
            <dt>شهادات صالحة</dt>
            <dd>{validCount}</dd>
            <small>روابط تحقق نشطة</small>
          </div>
          <div className={styles.summarySuccess}>
            <dt>مستحقة للإصدار</dt>
            <dd>{eligibleCount}</dd>
            <small>نتيجة بعدية تحقق الحد</small>
          </div>
          <div className={styles.summaryDanger}>
            <dt>دون حد الاجتياز</dt>
            <dd>{belowThresholdCount}</dd>
            <small>لا يجوز إصدار شهادة</small>
          </div>
          <div className={styles.summaryWarning}>
            <dt>بيانات غير مكتملة</dt>
            <dd>{missingPostCount}</dd>
            <small>القياس البعدي لم يصل</small>
          </div>
        </dl>

        <section className={styles.section} aria-labelledby="eligibility-title">
          <header className={styles.sectionHead}>
            <div className={styles.sectionTitle}>
              <span className={styles.sectionIndex}>01</span>
              <div>
                <h2 id="eligibility-title">سجل قرارات الاستحقاق</h2>
                <p>الحد الأدنى الفعلي لا يقل عن 80% ويقرأ من نسخة البرنامج.</p>
              </div>
            </div>
            <span className={styles.count}>{rows.length} تسجيلات</span>
          </header>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
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
                      <span className={styles.primaryCell}>
                        <strong>{row.traineeName}</strong>
                        <small className={styles.technical} dir="ltr">{row.traineeCode}</small>
                      </span>
                    </td>
                    <td>
                      <span className={styles.primaryCell}>
                        <strong>{row.programTitle}</strong>
                        <small>{row.cohortTitle}</small>
                      </span>
                    </td>
                    <td className={styles.technical}>{formatScore(row.postScore)}</td>
                    <td className={styles.technical}>{formatScore(row.passThreshold)}</td>
                    <td>
                      <span className={`${styles.decision} ${decisionClass(eligibility.tone)}`}>
                        <Icon name={decisionIcon(eligibility.tone)} size={14} />
                        {eligibility.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className={styles.muted}>لا توجد تسجيلات نشطة يمكن حساب استحقاقها.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </section>

        <section className={styles.section} aria-labelledby="issued-title">
          <header className={styles.sectionHead}>
            <div className={styles.sectionTitle}>
              <span className={styles.sectionIndex}>02</span>
              <div>
                <h2 id="issued-title">سجل الإصدارات</h2>
                <p>كل إصدار يحتفظ برقم مستقل وحالة ورابط تحقق.</p>
              </div>
            </div>
            <span className={styles.count}>{certificates.length} شهادات</span>
          </header>
          <div className={styles.filterBar}>
          <div className={styles.filters} role="group" aria-label="تصفية سجل الشهادات">
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
                type="button"
                className={`${styles.filterButton} ${filter === value ? styles.filterActive : ""}`}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <span className={styles.count} aria-live="polite">
            {filteredCertificates.length} ضمن التصنيف
          </span>
        </div>

        {filteredCertificates.length === 0 ? (
          <div className={styles.empty}>
            <Icon name="certificates" size={30} />
            <h3>لا توجد شهادات ضمن هذا التصنيف</h3>
            <p>
              {filter === "all"
                ? "لم يصدر سجل شهادات لهذه الجهة بعد. راجع قرارات الاستحقاق أعلاه قبل الإصدار."
                : "غيّر التصنيف لعرض حالات أخرى، أو ارجع إلى سجل الاستحقاق لمعرفة ما يمنع الإصدار."}
            </p>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={`${styles.table} ${styles.certificateTable}`}>
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
                        <span className={styles.primaryCell}>
                          <strong>
                            {snapshotText(certificate.public_snapshot, "trainee_name")}
                          </strong>
                          <small className={styles.technical} dir="ltr">
                            {snapshotText(certificate.public_snapshot, "trainee_code")}
                          </small>
                        </span>
                      </td>
                      <td className={styles.technical} dir="ltr">
                        {certificate.certificate_number}
                      </td>
                      <td>
                        {snapshotText(
                          certificate.public_snapshot,
                          "program_title",
                        )}
                      </td>
                      <td className={styles.technical}>{formatDate(certificate.issued_at)}</td>
                      <td>
                        <span className={`${styles.decision} ${decisionClass(status.tone)}`}>
                          <Icon name={decisionIcon(status.tone)} size={14} />
                          {status.label}
                        </span>
                      </td>
                      <td>
                        <Link
                          href={`/verify/${certificate.verify_code}`}
                          className={styles.verificationLink}
                          target="_blank"
                          rel="noreferrer"
                        >
                          فتح السجل <Icon name="external" size={14} />
                        </Link>
                      </td>
                      <td>
                        {certificate.status === "valid" &&
                        hasCurrentData ? (
                          <button
                            type="button"
                            className={styles.textAction}
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
                          <span className={styles.muted}>
                            يلزم إصدار جديد
                          </span>
                        ) : (
                          <span className={styles.muted}>غير متاح</span>
                        )}
                      </td>
                      <td>
                        <div className={styles.rowActions}>
                        {canManageCertificateLifecycle &&
                          certificate.status === "valid" &&
                          !hasCurrentData && (
                            <button
                              type="button"
                              className={styles.textAction}
                              onClick={() =>
                                openAction(certificate, "replace")
                              }
                            >
                              تحديث وإعادة إصدار
                            </button>
                          )}
                        {canManageCertificateLifecycle &&
                          certificate.status === "valid" &&
                          hasCurrentData && (
                            <button
                              type="button"
                              className={styles.textAction}
                              onClick={() =>
                                openAction(certificate, "replace")
                              }
                            >
                              إعادة إصدار
                            </button>
                          )}
                        {canManageCertificateLifecycle &&
                          certificate.status === "valid" &&
                          hasCurrentData && (
                            <button
                              type="button"
                              className={`${styles.textAction} ${styles.textActionDanger}`}
                              onClick={() =>
                                openAction(certificate, "revoke")
                              }
                            >
                              إلغاء
                            </button>
                          )}
                        {canManageCertificateLifecycle &&
                          certificate.status === "revoked" && (
                            <button
                              type="button"
                              className={styles.textAction}
                              onClick={() =>
                                openAction(certificate, "reissue")
                              }
                            >
                              إعادة إصدار
                            </button>
                          )}
                        {certificate.status === "superseded" && (
                          <span className={styles.muted}>محفوظة كسجل سابق</span>
                        )}
                        </div>
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
          <AccessibleDialog
            labelledBy="certificate-action-title"
            describedBy="certificate-action-description"
            onClose={closeAction}
            className={styles.dialog}
            disableClose={isApplyingAction}
          >
            <div className={styles.dialogHead}>
              <h2 id="certificate-action-title">
                {modalMode === "revoke"
                  ? "إلغاء الشهادة"
                  : modalMode === "replace"
                    ? "تحديث وإعادة إصدار الشهادة"
                    : "إعادة إصدار الشهادة"}
              </h2>
              <button
                className={styles.closeButton}
                type="button"
                onClick={closeAction}
                disabled={isApplyingAction}
                aria-label="إغلاق"
              >
                <Icon name="close" />
              </button>
            </div>
            <div className={styles.dialogBody} id="certificate-action-description">
              <div className={styles.readOnly}>
                <span>رقم الشهادة</span>
                <strong dir="ltr">
                  {selectedCertificate.certificate_number}
                </strong>
                <Icon name="lock" size={16} />
              </div>
              {modalMode === "revoke" ? (
                <label htmlFor="certificate-revoke-reason">
                  سبب الإلغاء
                  <textarea
                    id="certificate-revoke-reason"
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
                <div className={styles.warningNote}>
                  <Icon name="warning" size={18} />
                  <span>
                    ستصبح الشهادة القديمة مستبدلة، وسيُنشأ إصدار جديد
                    بالاسم والمعرّف والبيانات الحالية مع رقم شهادة ورمز
                    تحقق جديدين.
                  </span>
                </div>
              ) : (
                <div className={styles.warningNote}>
                  <Icon name="warning" size={18} />
                  <span>
                    ستبقى الشهادة القديمة محفوظة كمستبدلة، وسيُنشأ رقم
                    ورمز تحقق جديدان.
                  </span>
                </div>
              )}
            </div>
            <div className={styles.dialogActions}>
              <button
                className={`${styles.button} ${styles.buttonSecondary}`}
                type="button"
                onClick={closeAction}
                disabled={isApplyingAction}
              >
                رجوع
              </button>
              <button
                type="button"
                className={
                  modalMode === "revoke"
                    ? `${styles.button} ${styles.buttonDanger}`
                    : styles.button
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
          </AccessibleDialog>
        )}
      </div>
    </AppShell>
  );
}
