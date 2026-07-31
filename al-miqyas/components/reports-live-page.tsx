"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell, PageHeader, StatusBadge } from "./app-shell";
import { Icon } from "./icons";
import { createSupabaseBrowserClient } from "../lib/supabase/client";

type JsonRecord = Record<string, unknown>;

type CohortRecord = {
  id: string;
  title: string;
  code: string;
  status: "draft" | "open" | "in_progress" | "closed" | "archived";
  program_id: string;
  created_at: string;
};

type ProgramRecord = {
  id: string;
  title_ar: string;
};

type CohortOption = CohortRecord & {
  programTitle: string;
};

type TraineeBreakdown = {
  enrollment_id: string;
  trainee_code: string;
  trainee_name: string;
  pre_score: number | null;
  post_score: number | null;
  knowledge_delta: number | null;
  pre_confidence: number | null;
  post_confidence: number | null;
  confidence_delta: number | null;
  live_event_count: number;
  live_accuracy: number | null;
  verdict: "passed" | "not_passed" | "pending";
  completeness: {
    has_pre?: boolean;
    has_post?: boolean;
    has_live?: boolean;
    is_complete?: boolean;
    missing?: string[];
  };
};

type CohortReportRecord = {
  id: string;
  cohort_id: string;
  version_number: number;
  sample_pre: number;
  sample_post: number;
  sample_matched: number;
  knowledge_metrics: JsonRecord;
  confidence_metrics: JsonRecord;
  live_metrics: JsonRecord;
  trainee_breakdown: TraineeBreakdown[];
  warnings: string[];
  computed_at: string;
};

function objectValue(source: JsonRecord, key: string) {
  const value = source[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function numericValue(source: JsonRecord, key: string) {
  const value = source[key];
  return typeof value === "number" ? value : null;
}

function formatMetric(value: number | null, suffix = "") {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }

  return `${new Intl.NumberFormat("ar-SA", {
    maximumFractionDigits: 2,
  }).format(value)}${suffix}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ar-SA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function barWidth(value: number | null) {
  if (value === null) {
    return "0%";
  }

  return `${Math.min(100, Math.max(0, value))}%`;
}

function verdictMeta(verdict: TraineeBreakdown["verdict"]) {
  if (verdict === "passed") {
    return { label: "مجتاز", tone: "success" as const };
  }

  if (verdict === "not_passed") {
    return { label: "غير مجتاز", tone: "danger" as const };
  }

  return { label: "غير مكتمل", tone: "warning" as const };
}

function reportHeadline(report: CohortReportRecord) {
  const delta = numericValue(
    report.knowledge_metrics,
    "matched_delta_mean",
  );

  if (report.sample_post === 0) {
    return "بانتظار القياس البعدي";
  }

  if (delta === null) {
    return "العينة غير مكتملة للمقارنة";
  }

  if (delta > 0) {
    return "تحسن معرفي في العينة المطابقة";
  }

  if (delta < 0) {
    return "تراجع معرفي يحتاج مراجعة";
  }

  return "لم يتغير المتوسط المعرفي";
}

export function ReportsLivePage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [cohorts, setCohorts] = useState<CohortOption[]>([]);
  const [selectedCohortId, setSelectedCohortId] = useState("");
  const [report, setReport] = useState<CohortReportRecord | null>(null);
  const [tab, setTab] = useState<"cohort" | "individual">("cohort");
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState("");
  const [canCompute, setCanCompute] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isComputing, setIsComputing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [feedbackMessage, setFeedbackMessage] = useState("");

  const loadWorkspace = useCallback(async () => {
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

    setCanCompute(["owner", "trainer"].includes(membership.role));

    const [{ data: cohortRows, error: cohortError }, { data: programRows }] =
      await Promise.all([
        supabase
          .from("cohorts")
          .select("id, title, code, status, program_id, created_at")
          .eq("org_id", membership.org_id)
          .neq("status", "archived")
          .order("created_at", { ascending: false }),
        supabase
          .from("programs")
          .select("id, title_ar")
          .eq("org_id", membership.org_id),
      ]);

    if (cohortError) {
      setErrorMessage("تعذر تحميل دفعات الجهة.");
      setIsLoading(false);
      return;
    }

    const programs = (programRows ?? []) as ProgramRecord[];
    const nextCohorts = ((cohortRows ?? []) as CohortRecord[]).map(
      (cohort) => ({
        ...cohort,
        programTitle:
          programs.find((program) => program.id === cohort.program_id)
            ?.title_ar ?? "برنامج غير معروف",
      }),
    );

    setCohorts(nextCohorts);
    setSelectedCohortId((current) => {
      if (nextCohorts.some((cohort) => cohort.id === current)) {
        return current;
      }
      return nextCohorts[0]?.id ?? "";
    });
    setIsLoading(false);
  }, [supabase]);

  const loadReport = useCallback(
    async (cohortId: string) => {
      if (!cohortId) {
        setReport(null);
        return;
      }

      setErrorMessage("");
      const { data, error } = await supabase
        .from("cohort_reports")
        .select(
          "id, cohort_id, version_number, sample_pre, sample_post, sample_matched, knowledge_metrics, confidence_metrics, live_metrics, trainee_breakdown, warnings, computed_at",
        )
        .eq("cohort_id", cohortId)
        .eq("status", "computed")
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        setErrorMessage("تعذر تحميل تقرير الدفعة.");
        setReport(null);
        return;
      }

      const nextReport = data
        ? (data as CohortReportRecord)
        : null;
      setReport(nextReport);
      setSelectedEnrollmentId((current) => {
        if (
          nextReport?.trainee_breakdown.some(
            (trainee) => trainee.enrollment_id === current,
          )
        ) {
          return current;
        }
        return nextReport?.trainee_breakdown[0]?.enrollment_id ?? "";
      });
    },
    [supabase],
  );

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  useEffect(() => {
    void loadReport(selectedCohortId);
  }, [loadReport, selectedCohortId]);

  async function refreshReport() {
    if (!selectedCohortId || !canCompute) {
      return;
    }

    setIsComputing(true);
    setErrorMessage("");
    setFeedbackMessage("");

    const { error } = await supabase.rpc("refresh_cohort_impact", {
      target_cohort_id: selectedCohortId,
    });

    if (error) {
      setErrorMessage(
        error.message || "تعذر حساب تقرير الأثر.",
      );
      setIsComputing(false);
      return;
    }

    await loadReport(selectedCohortId);
    setFeedbackMessage(
      "أُعيد حساب التقارير من نتائج القياس وأحداث الأداء الحالية.",
    );
    setIsComputing(false);
  }

  if (isLoading) {
    return (
      <AppShell title="التقارير">
        <section className="content-section loading-state">
          جارٍ تحميل بيانات التقارير...
        </section>
      </AppShell>
    );
  }

  const selectedCohort = cohorts.find(
    (cohort) => cohort.id === selectedCohortId,
  );
  const selectedTrainee = report?.trainee_breakdown.find(
    (trainee) => trainee.enrollment_id === selectedEnrollmentId,
  );

  return (
    <AppShell title="التقارير">
      <PageHeader
        eyebrow="محرك الأثر"
        title="التقارير"
        description="تقارير محسوبة من القياس القبلي والبعدي والأداء اللحظي الفعلي."
        actions={
          <div className="report-actions">
            <button
              className="button button-secondary"
              onClick={() => window.print()}
              disabled={!report}
            >
              <Icon name="download" size={16} />
              تصدير PDF
            </button>
            <button
              className="button button-primary"
              onClick={() => void refreshReport()}
              disabled={
                !selectedCohortId || !canCompute || isComputing
              }
            >
              <Icon name="reports" size={16} />
              {isComputing
                ? "جارٍ الحساب..."
                : report
                  ? "تحديث الحساب"
                  : "حساب التقرير"}
            </button>
          </div>
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

      <section className="report-toolbar">
        <label>
          <span>الدفعة</span>
          <select
            value={selectedCohortId}
            onChange={(event) => {
              setSelectedCohortId(event.target.value);
              setFeedbackMessage("");
            }}
          >
            {cohorts.map((cohort) => (
              <option key={cohort.id} value={cohort.id}>
                {cohort.title} · {cohort.programTitle}
              </option>
            ))}
          </select>
        </label>
        {report && (
          <div className="report-version">
            <span>نسخة التقرير</span>
            <strong dir="ltr">v{report.version_number}</strong>
            <small>{formatDate(report.computed_at)}</small>
          </div>
        )}
      </section>

      {cohorts.length === 0 ? (
        <section className="content-section empty-state">
          <Icon name="reports" size={30} />
          <h3>لا توجد دفعات</h3>
          <p>أنشئ دفعة وسجّل فيها متدرّبين قبل حساب الأثر.</p>
          <Link className="button button-primary" href="/programs">
            فتح البرامج والدفعات
          </Link>
        </section>
      ) : !report ? (
        <section className="content-section empty-state">
          <Icon name="reports" size={30} />
          <h3>لم يُحسب تقرير هذه الدفعة</h3>
          <p>
            سيعرض المحرك البيانات المتاحة بصدق، حتى لو كانت بعض المراحل
            ناقصة.
          </p>
          {canCompute ? (
            <button
              className="button button-primary"
              onClick={() => void refreshReport()}
              disabled={isComputing}
            >
              {isComputing ? "جارٍ الحساب..." : "حساب التقرير الآن"}
            </button>
          ) : (
            <p>حساب التقرير متاح لمالك الجهة والمدرّب فقط.</p>
          )}
        </section>
      ) : (
        <>
          <div className="segmented-control" role="tablist">
            <button
              role="tab"
              aria-selected={tab === "cohort"}
              onClick={() => setTab("cohort")}
            >
              تقرير الدفعة
            </button>
            <button
              role="tab"
              aria-selected={tab === "individual"}
              onClick={() => setTab("individual")}
            >
              تقرير فردي
            </button>
          </div>

          {tab === "cohort" ? (
            <CohortReportView
              report={report}
              cohort={selectedCohort}
            />
          ) : (
            <IndividualReportView
              trainees={report.trainee_breakdown}
              selectedEnrollmentId={selectedEnrollmentId}
              selectedTrainee={selectedTrainee}
              onSelect={setSelectedEnrollmentId}
            />
          )}
        </>
      )}
    </AppShell>
  );
}

function CohortReportView({
  report,
  cohort,
}: {
  report: CohortReportRecord;
  cohort: CohortOption | undefined;
}) {
  const pre = objectValue(report.knowledge_metrics, "pre");
  const post = objectValue(report.knowledge_metrics, "post");
  const preMean = numericValue(pre, "mean");
  const postMean = numericValue(post, "mean");
  const preMin = numericValue(pre, "min");
  const postMin = numericValue(post, "min");
  const preStddev = numericValue(pre, "stddev");
  const postStddev = numericValue(post, "stddev");
  const passRate = numericValue(report.knowledge_metrics, "pass_rate");
  const liveAccuracy = numericValue(
    report.live_metrics,
    "accuracy_percentage",
  );

  return (
    <>
      <section className="report-hero">
        <div>
          <span className="eyebrow">
            {cohort?.title ?? "تقرير الدفعة"} ·{" "}
            {cohort?.programTitle ?? ""}
          </span>
          <h2>{reportHeadline(report)}</h2>
          <p>
            المقارنة مبنية على المتدرّبين الذين أمكن ربط نتائجهم داخل
            الدفعة نفسها. لا تُحتسب اختبارات اتصال xAPI ضمن الأداء.
          </p>
        </div>
        <div className="report-sample">
          <span>
            <small>القبلي</small>
            <strong>{report.sample_pre}</strong>
          </span>
          <i />
          <span>
            <small>المطابقون</small>
            <strong>{report.sample_matched}</strong>
          </span>
          <i />
          <span>
            <small>البعدي</small>
            <strong>{report.sample_post}</strong>
          </span>
        </div>
      </section>

      <div className="metric-strip">
        <MetricBlock
          label="أدنى نتيجة"
          value={`${formatMetric(preMin)} ← ${formatMetric(postMin)}`}
          detail="قبلي مقابل بعدي"
          tone={
            preMin !== null && postMin !== null && postMin > preMin
              ? "success"
              : "default"
          }
        />
        <MetricBlock
          label="الانحراف المعياري"
          value={`${formatMetric(preStddev)} ← ${formatMetric(postStddev)}`}
          detail="انخفاضه يعني تقارب النتائج"
          tone={
            preStddev !== null &&
            postStddev !== null &&
            postStddev < preStddev
              ? "success"
              : "default"
          }
        />
        <MetricBlock
          label="المتوسط"
          value={`${formatMetric(preMean)} ← ${formatMetric(postMean)}`}
          detail={`فرق المطابقين ${formatMetric(
            numericValue(
              report.knowledge_metrics,
              "matched_delta_mean",
            ),
          )}`}
        />
        <MetricBlock
          label="نسبة الاجتياز"
          value={formatMetric(passRate, "%")}
          detail={`من ${report.sample_post} نتيجة بعدية`}
          tone="success"
        />
      </div>

      <section className="content-section report-chart-section">
        <div className="section-title">
          <div>
            <span className="eyebrow">مقارنة النتائج</span>
            <h2>القبلي مقابل البعدي</h2>
          </div>
          <span className="data-source">
            بيانات فعلية · Jotform + AmadXR
          </span>
        </div>
        <div className="bar-comparison">
          <div>
            <span>أدنى نتيجة</span>
            <div className="bar-row">
              <small>قبلي</small>
              <i>
                <b style={{ width: barWidth(preMin) }} />
              </i>
              <strong>{formatMetric(preMin)}</strong>
            </div>
            <div className="bar-row after">
              <small>بعدي</small>
              <i>
                <b style={{ width: barWidth(postMin) }} />
              </i>
              <strong>{formatMetric(postMin)}</strong>
            </div>
          </div>
          <div>
            <span>المتوسط</span>
            <div className="bar-row">
              <small>قبلي</small>
              <i>
                <b style={{ width: barWidth(preMean) }} />
              </i>
              <strong>{formatMetric(preMean)}</strong>
            </div>
            <div className="bar-row after">
              <small>بعدي</small>
              <i>
                <b style={{ width: barWidth(postMean) }} />
              </i>
              <strong>{formatMetric(postMean)}</strong>
            </div>
          </div>
        </div>
        <div className="report-live-summary">
          <div>
            <span>متدرّبون بأداء لحظي</span>
            <strong>
              {formatMetric(
                numericValue(report.live_metrics, "enrollment_count"),
              )}
            </strong>
          </div>
          <div>
            <span>أحداث أداء فعلية</span>
            <strong>
              {formatMetric(
                numericValue(report.live_metrics, "event_count"),
              )}
            </strong>
          </div>
          <div>
            <span>دقة البنود</span>
            <strong>{formatMetric(liveAccuracy, "%")}</strong>
          </div>
        </div>
        {report.warnings.map((warning) => (
          <div className="sample-warning" key={warning}>
            <Icon name="warning" size={18} />
            <span>{warning}</span>
          </div>
        ))}
      </section>

      <section className="content-section table-section">
        <div className="section-title">
          <div>
            <span className="eyebrow">تفصيل المتدرّبين</span>
            <h2>حالة المطابقة والاجتياز</h2>
          </div>
        </div>
        <ReportTraineeTable rows={report.trainee_breakdown} />
      </section>
    </>
  );
}

function IndividualReportView({
  trainees,
  selectedEnrollmentId,
  selectedTrainee,
  onSelect,
}: {
  trainees: TraineeBreakdown[];
  selectedEnrollmentId: string;
  selectedTrainee: TraineeBreakdown | undefined;
  onSelect: (value: string) => void;
}) {
  if (!selectedTrainee) {
    return (
      <section className="content-section empty-state">
        <Icon name="trainees" size={30} />
        <h3>لا يوجد متدرّبون في التقرير</h3>
      </section>
    );
  }

  const verdict = verdictMeta(selectedTrainee.verdict);

  return (
    <section className="content-section individual-report">
      <div className="individual-report-picker">
        <label>
          <span>المتدرّب</span>
          <select
            value={selectedEnrollmentId}
            onChange={(event) => onSelect(event.target.value)}
          >
            {trainees.map((trainee) => (
              <option
                key={trainee.enrollment_id}
                value={trainee.enrollment_id}
              >
                {trainee.trainee_name} · {trainee.trainee_code}
              </option>
            ))}
          </select>
        </label>
        <Link
          href={`/trainees/${selectedTrainee.trainee_code}`}
          className="button button-secondary"
        >
          فتح رحلة الدليل
        </Link>
      </div>

      <div className="section-title">
        <div>
          <span className="eyebrow" dir="ltr">
            {selectedTrainee.trainee_code}
          </span>
          <h2>{selectedTrainee.trainee_name}</h2>
        </div>
        <StatusBadge tone={verdict.tone}>{verdict.label}</StatusBadge>
      </div>

      <div className="metric-strip">
        <MetricBlock
          label="نمو المعرفة"
          value={formatMetric(selectedTrainee.knowledge_delta)}
          detail={`${formatMetric(
            selectedTrainee.pre_score,
            "%",
          )} ← ${formatMetric(selectedTrainee.post_score, "%")}`}
          tone={
            (selectedTrainee.knowledge_delta ?? 0) > 0
              ? "success"
              : "default"
          }
        />
        <MetricBlock
          label="نمو الثقة"
          value={formatMetric(selectedTrainee.confidence_delta)}
          detail={`${formatMetric(
            selectedTrainee.pre_confidence,
          )} ← ${formatMetric(selectedTrainee.post_confidence)}`}
          tone={
            (selectedTrainee.confidence_delta ?? 0) > 0
              ? "success"
              : "default"
          }
        />
        <MetricBlock
          label="دقة الأداء"
          value={formatMetric(selectedTrainee.live_accuracy, "%")}
          detail={`${selectedTrainee.live_event_count} أحداث فعلية`}
          tone="system"
        />
      </div>

      <div className="verdict-panel">
        <Icon name="shield" size={34} />
        <div>
          <span>الحكم المعرفي</span>
          <h3>
            {verdict.label} · نتيجة البعدي{" "}
            {formatMetric(selectedTrainee.post_score, "%")}
          </h3>
          <p>
            قرار الاجتياز مبني على القياس البعدي. الثقة والأداء اللحظي
            أدلة أثر إضافية ولا تغيّر شرط الشهادة.
          </p>
        </div>
      </div>

      {!selectedTrainee.completeness.is_complete && (
        <div className="sample-warning">
          <Icon name="warning" size={18} />
          <span>
            التقرير غير مكتمل لغياب:{" "}
            {(
              selectedTrainee.completeness.missing ?? []
            )
              .map((item) => {
                const labels: Record<string, string> = {
                  pre_assessment: "القياس القبلي",
                  post_assessment: "القياس البعدي",
                  live_performance: "الأداء اللحظي",
                };
                return labels[item] ?? item;
              })
              .join("، ")}
          </span>
        </div>
      )}
    </section>
  );
}

function MetricBlock({
  label,
  value,
  detail,
  tone = "default",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: string;
}) {
  return (
    <div className={`metric-block metric-block-${tone}`}>
      <span>{label}</span>
      <strong dir="auto">{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function ReportTraineeTable({ rows }: { rows: TraineeBreakdown[] }) {
  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <h3>لا يوجد متدرّبون مسجّلون</h3>
      </div>
    );
  }

  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>المتدرّب</th>
            <th>القبلي</th>
            <th>البعدي</th>
            <th>الفرق</th>
            <th>الأداء</th>
            <th>الحكم</th>
            <th>
              <span className="sr-only">فتح</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const verdict = verdictMeta(row.verdict);
            return (
              <tr key={row.enrollment_id}>
                <td>
                  <strong>{row.trainee_name}</strong>
                  <small className="table-subtext mono" dir="ltr">
                    {row.trainee_code}
                  </small>
                </td>
                <td>{formatMetric(row.pre_score, "%")}</td>
                <td>{formatMetric(row.post_score, "%")}</td>
                <td>{formatMetric(row.knowledge_delta)}</td>
                <td>{row.live_event_count} أحداث</td>
                <td>
                  <StatusBadge tone={verdict.tone}>
                    {verdict.label}
                  </StatusBadge>
                </td>
                <td>
                  <Link
                    className="table-action"
                    href={`/trainees/${row.trainee_code}`}
                  >
                    فتح <Icon name="arrow" size={14} />
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
