"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { AppShell, StatusBadge } from "./app-shell";
import { Icon } from "./icons";
import { createSupabaseBrowserClient } from "../lib/supabase/client";
import styles from "./reports-live-page.module.css";

type JsonRecord = Record<string, unknown>;
type ReportTab = "cohort" | "individual";

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

const reportTabs: Array<{ id: ReportTab; label: string; index: string }> = [
  { id: "cohort", label: "سجل الدفعة", index: "01" },
  { id: "individual", label: "سجل فردي", index: "02" },
];

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
  const delta = numericValue(report.knowledge_metrics, "matched_delta_mean");

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

function missingEvidenceLabels(items: string[] | undefined) {
  const labels: Record<string, string> = {
    pre_assessment: "القياس القبلي",
    post_assessment: "القياس البعدي",
    live_performance: "الأداء اللحظي",
  };

  return (items ?? []).map((item) => labels[item] ?? item).join("، ");
}

export function ReportsLivePage({
  organizationId,
  canComputeReports,
  canExportReports,
}: {
  organizationId: string;
  canComputeReports: boolean;
  canExportReports: boolean;
}) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [cohorts, setCohorts] = useState<CohortOption[]>([]);
  const [selectedCohortId, setSelectedCohortId] = useState("");
  const [report, setReport] = useState<CohortReportRecord | null>(null);
  const [tab, setTab] = useState<ReportTab>("cohort");
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState("");
  const [canCompute, setCanCompute] = useState(canComputeReports);
  const [isLoading, setIsLoading] = useState(true);
  const [isReportLoading, setIsReportLoading] = useState(true);
  const [isComputing, setIsComputing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const tabRefs = useRef<Record<ReportTab, HTMLButtonElement | null>>({
    cohort: null,
    individual: null,
  });
  const reportRequestId = useRef(0);

  const loadWorkspace = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");
    setCanCompute(canComputeReports);

    const [{ data: cohortRows, error: cohortError }, { data: programRows }] =
      await Promise.all([
        supabase
          .from("cohorts")
          .select("id, title, code, status, program_id, created_at")
          .eq("org_id", organizationId)
          .neq("status", "archived")
          .order("created_at", { ascending: false }),
        supabase
          .from("programs")
          .select("id, title_ar")
          .eq("org_id", organizationId),
      ]);

    if (cohortError) {
      setErrorMessage("تعذر تحميل دفعات الجهة.");
      setIsReportLoading(false);
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
    setIsReportLoading(nextCohorts.length > 0);
    setSelectedCohortId((current) =>
      nextCohorts.some((cohort) => cohort.id === current)
        ? current
        : (nextCohorts[0]?.id ?? ""),
    );
    setIsLoading(false);
  }, [canComputeReports, organizationId, supabase]);

  const loadReport = useCallback(
    async (cohortId: string) => {
      const requestId = ++reportRequestId.current;
      if (!cohortId) {
        setReport(null);
        setIsReportLoading(false);
        return false;
      }

      setIsReportLoading(true);
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

      if (requestId !== reportRequestId.current) {
        return false;
      }

      if (error) {
        setErrorMessage("تعذر تحميل تقرير الدفعة.");
        setReport(null);
        setIsReportLoading(false);
        return false;
      }

      const nextReport = data ? (data as CohortReportRecord) : null;
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
      setIsReportLoading(false);
      return true;
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
      setErrorMessage(error.message || "تعذر حساب تقرير الأثر.");
      setIsComputing(false);
      return;
    }

    const reportReloaded = await loadReport(selectedCohortId);
    if (reportReloaded) {
      setFeedbackMessage(
        "أُعيد حساب التقرير من نتائج القياس وأحداث الأداء الحالية.",
      );
    }
    setIsComputing(false);
  }

  function handleTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    currentTab: ReportTab,
  ) {
    const currentIndex = reportTabs.findIndex((item) => item.id === currentTab);
    let nextIndex = currentIndex;

    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex - 1 + reportTabs.length) % reportTabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex + 1) % reportTabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = reportTabs.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    const nextTab = reportTabs[nextIndex].id;
    setTab(nextTab);
    tabRefs.current[nextTab]?.focus();
  }

  if (isLoading) {
    return (
      <AppShell title="التقارير">
        <section className={styles.statePanel} role="status" aria-live="polite">
          <span className={styles.stateIndex}>05</span>
          <div>
            <h1>جارٍ فتح سجل الأثر</h1>
            <p>تُقرأ الدفعات ونسخ التقارير من قاعدة البيانات.</p>
          </div>
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
      <header className={styles.pageIntro}>
        <div className={styles.pageIdentity}>
          <span className={styles.pageIndex} aria-hidden="true">05</span>
          <div>
            <p>سجل الأثر والقرار</p>
            <h1>التقارير</h1>
            <span>
              مقارنة العينة قبل التدريب وبعده، ثم توثيق القرار ومصدر كل قيمة.
            </span>
          </div>
        </div>
        <div className={styles.pageActions}>
          {canExportReports && (
            <button
              type="button"
              className={styles.secondaryAction}
              onClick={() => window.print()}
              disabled={!report}
            >
              <Icon name="download" size={17} />
              طباعة أو حفظ التقرير
            </button>
          )}
          {canCompute && (
            <button
              type="button"
              className={styles.primaryAction}
              onClick={() => void refreshReport()}
              disabled={!selectedCohortId || isComputing}
            >
              <Icon name="reports" size={17} />
              {isComputing
                ? "جارٍ إعادة الحساب..."
                : report
                  ? "إعادة الحساب"
                  : "حساب التقرير"}
            </button>
          )}
        </div>
      </header>

      <section className={styles.registerBar} aria-label="نطاق التقرير الحالي">
        <label className={styles.cohortPicker}>
          <span>الدفعة المسجّلة</span>
          <select
            value={selectedCohortId}
            onChange={(event) => {
              setReport(null);
              setIsReportLoading(true);
              setSelectedCohortId(event.target.value);
              setFeedbackMessage("");
            }}
            disabled={cohorts.length === 0}
          >
            {cohorts.length === 0 && <option value="">لا توجد دفعات</option>}
            {cohorts.map((cohort) => (
              <option key={cohort.id} value={cohort.id}>
                {cohort.title} · {cohort.programTitle}
              </option>
            ))}
          </select>
        </label>
        <dl className={styles.reportStamp}>
          <div>
            <dt>المعرّف</dt>
            <dd dir="ltr">{selectedCohort?.code ?? "—"}</dd>
          </div>
          <div>
            <dt>نسخة الحساب</dt>
            <dd dir="ltr">{report ? `v${report.version_number}` : "—"}</dd>
          </div>
          <div>
            <dt>آخر احتساب</dt>
            <dd>{report ? formatDate(report.computed_at) : "غير محسوب"}</dd>
          </div>
        </dl>
      </section>

      {(errorMessage || feedbackMessage) && (
        <p
          className={`${styles.feedback} ${
            errorMessage ? styles.feedbackDanger : styles.feedbackSuccess
          }`}
          role={errorMessage ? "alert" : "status"}
        >
          <Icon name={errorMessage ? "warning" : "check"} size={18} />
          {errorMessage || feedbackMessage}
        </p>
      )}

      {errorMessage && cohorts.length === 0 ? (
        <EmptyRegister
          title="تعذر التحقق من سجل الدفعات"
          description="لم يثبت النظام وجود دفعات أو غيابها. أعد المحاولة قبل اتخاذ أي قرار."
          action={
            <button
              type="button"
              className={styles.secondaryAction}
              onClick={() => void loadWorkspace()}
            >
              إعادة تحميل السجل
            </button>
          }
        />
      ) : cohorts.length === 0 ? (
        <EmptyRegister
          title="لا توجد دفعات في سجل التقارير"
          description="أنشئ برنامجًا ودفعة، ثم سجّل المتدرّبين قبل احتساب الأثر."
          action={
            <Link className={styles.primaryAction} href="/programs">
              فتح سجل البرامج
              <span className={styles.forwardIcon}>
                <Icon name="arrow" size={15} />
              </span>
            </Link>
          }
        />
      ) : isReportLoading ? (
        <section className={styles.statePanel} role="status" aria-live="polite">
          <span className={styles.stateIndex}>05</span>
          <div>
            <h2>جارٍ تحميل نسخة الدفعة</h2>
            <p>لن تُعرض نسخة دفعة أخرى أثناء الانتظار.</p>
          </div>
        </section>
      ) : errorMessage && !report ? (
        <EmptyRegister
          title="تعذر التحقق من نسخة التقرير"
          description="لم يثبت النظام وجود التقرير أو غيابه. أعد القراءة قبل احتساب نسخة جديدة."
          action={
            <button
              type="button"
              className={styles.secondaryAction}
              onClick={() => void loadReport(selectedCohortId)}
            >
              إعادة قراءة النسخة
            </button>
          }
        />
      ) : !report ? (
        <EmptyRegister
          title="لا توجد نسخة محسوبة لهذه الدفعة"
          description="عند الحساب سيحتفظ السجل بالنواقص كما هي، ولن يحوّل العينة غير المكتملة إلى نتيجة مؤكدة."
          action={
            canCompute ? (
              <button
                type="button"
                className={styles.primaryAction}
                onClick={() => void refreshReport()}
                disabled={isComputing}
              >
                {isComputing ? "جارٍ الحساب..." : "احتساب النسخة الأولى"}
              </button>
            ) : (
              <p className={styles.permissionNote}>
                حساب التقرير غير متاح ضمن صلاحيات دورك الحالي.
              </p>
            )
          }
        />
      ) : (
        <>
          <div
            className={styles.documentTabs}
            role="tablist"
            aria-label="نوع سجل التقرير"
            aria-orientation="horizontal"
          >
            {reportTabs.map((item) => (
              <button
                key={item.id}
                ref={(element) => {
                  tabRefs.current[item.id] = element;
                }}
                id={`report-tab-${item.id}`}
                type="button"
                role="tab"
                tabIndex={tab === item.id ? 0 : -1}
                aria-selected={tab === item.id}
                aria-controls={`report-panel-${item.id}`}
                className={tab === item.id ? styles.activeTab : undefined}
                onClick={() => setTab(item.id)}
                onKeyDown={(event) => handleTabKeyDown(event, item.id)}
              >
                <span>{item.index}</span>
                {item.label}
              </button>
            ))}
          </div>

          <div
            id={`report-panel-${tab}`}
            role="tabpanel"
            tabIndex={0}
            aria-labelledby={`report-tab-${tab}`}
            className={styles.tabPanel}
          >
            {tab === "cohort" ? (
              <CohortReportView report={report} cohort={selectedCohort} />
            ) : (
              <IndividualReportView
                trainees={report.trainee_breakdown}
                selectedEnrollmentId={selectedEnrollmentId}
                selectedTrainee={selectedTrainee}
                onSelect={setSelectedEnrollmentId}
              />
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}

function EmptyRegister({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action: ReactNode;
}) {
  return (
    <section className={styles.emptyRegister}>
      <span className={styles.emptyRule} aria-hidden="true" />
      <div>
        <p>حالة السجل</p>
        <h2>{title}</h2>
        <span>{description}</span>
      </div>
      <div className={styles.emptyAction}>{action}</div>
    </section>
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
  const preMax = numericValue(pre, "max");
  const postMax = numericValue(post, "max");
  const preStddev = numericValue(pre, "stddev");
  const postStddev = numericValue(post, "stddev");
  const passRate = numericValue(report.knowledge_metrics, "pass_rate");
  const matchedDelta = numericValue(
    report.knowledge_metrics,
    "matched_delta_mean",
  );
  const liveAccuracy = numericValue(report.live_metrics, "accuracy_percentage");

  return (
    <div className={styles.cohortRecord}>
      <section className={styles.decisionBrief} aria-labelledby="cohort-decision">
        <div className={styles.decisionCopy}>
          <span className={styles.decisionLabel}>حكم النسخة الحالية</span>
          <h2 id="cohort-decision">{reportHeadline(report)}</h2>
          <p>
            {cohort?.title ?? "تقرير الدفعة"} · {cohort?.programTitle ?? ""}
          </p>
          <span>
            القرار مبني على المتدرّبين الذين أمكن ربط قياسهم القبلي والبعدي
            داخل الدفعة نفسها. اختبارات اتصال xAPI مستبعدة من الأثر.
          </span>
        </div>
        <ol className={styles.sampleChain} aria-label="اكتمال عينة المقارنة">
          <li>
            <span>01</span>
            <small>عينة قبلي</small>
            <strong>{report.sample_pre}</strong>
          </li>
          <li>
            <span>02</span>
            <small>عينة مطابقة</small>
            <strong>{report.sample_matched}</strong>
          </li>
          <li>
            <span>03</span>
            <small>عينة بعدي</small>
            <strong>{report.sample_post}</strong>
          </li>
        </ol>
      </section>

      <section className={styles.measureLedger} aria-labelledby="measure-ledger-title">
        <header className={styles.sectionHeading}>
          <div>
            <span>02 / القياسات الحاكمة</span>
            <h2 id="measure-ledger-title">سجل المقارنة الإحصائية</h2>
          </div>
          <SourceStamp label="محسوب داخليًا" tone="calculation" />
        </header>
        <dl className={styles.statLedger}>
          <LedgerMetric
            label="أدنى نتيجة"
            value={`${formatMetric(preMin)} ← ${formatMetric(postMin)}`}
            detail="قبلي ← بعدي"
          />
          <LedgerMetric
            label="أعلى نتيجة"
            value={`${formatMetric(preMax)} ← ${formatMetric(postMax)}`}
            detail="قبلي ← بعدي"
          />
          <LedgerMetric
            label="متوسط العينة"
            value={`${formatMetric(preMean)} ← ${formatMetric(postMean)}`}
            detail={`فرق المطابقين ${formatMetric(matchedDelta)}`}
          />
          <LedgerMetric
            label="الانحراف المعياري"
            value={`${formatMetric(preStddev)} ← ${formatMetric(postStddev)}`}
            detail="انخفاضه يعني تقارب النتائج"
          />
          <LedgerMetric
            label="نسبة الاجتياز"
            value={formatMetric(passRate, "%")}
            detail={`من ${report.sample_post} نتيجة بعدية`}
          />
        </dl>
      </section>

      <section className={styles.evidenceComparison} aria-labelledby="comparison-title">
        <header className={styles.sectionHeading}>
          <div>
            <span>03 / أثر القياس</span>
            <h2 id="comparison-title">قراءة القبلي والبعدي</h2>
          </div>
          <SourceStamp label="Jotform" tone="assessment" />
        </header>
        <div className={styles.comparisonRows}>
          <ComparisonRow label="أدنى نتيجة" pre={preMin} post={postMin} />
          <ComparisonRow label="المتوسط" pre={preMean} post={postMean} />
          <ComparisonRow label="أعلى نتيجة" pre={preMax} post={postMax} />
        </div>
        <dl className={styles.liveLedger}>
          <LedgerMetric
            label="متدرّبون بأداء لحظي"
            value={formatMetric(numericValue(report.live_metrics, "enrollment_count"))}
            detail="أفراد لهم أحداث أداء فعلية"
          />
          <LedgerMetric
            label="أحداث الأداء"
            value={formatMetric(numericValue(report.live_metrics, "event_count"))}
            detail="بعد استبعاد اختبارات الاتصال"
          />
          <LedgerMetric
            label="دقة البنود"
            value={formatMetric(liveAccuracy, "%")}
            detail="من أحداث xAPI المقبولة"
          />
        </dl>
        <div className={styles.sourceLine} aria-label="مصادر التقرير">
          <SourceStamp label="Jotform · قبلي وبعدي" tone="assessment" />
          <span aria-hidden="true" />
          <SourceStamp label="xAPI · أداء لحظي" tone="live" />
          <span aria-hidden="true" />
          <SourceStamp label="محرك الأثر · قرار" tone="calculation" />
        </div>
      </section>

      {report.warnings.length > 0 && (
        <section className={styles.warningRegister} aria-labelledby="warnings-title">
          <header>
            <Icon name="warning" size={20} />
            <div>
              <span>استثناءات النسخة</span>
              <h2 id="warnings-title">نواقص يجب قراءتها قبل اعتماد القرار</h2>
            </div>
          </header>
          <ol>
            {report.warnings.map((warning, index) => (
              <li key={`${index}-${warning}`}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <p>{warning}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className={styles.traineeLedger} aria-labelledby="trainee-ledger-title">
        <header className={styles.sectionHeading}>
          <div>
            <span>04 / دفتر العينة</span>
            <h2 id="trainee-ledger-title">المطابقة والاجتياز لكل متدرّب</h2>
          </div>
          <p>{report.trainee_breakdown.length} سجلًا في النسخة</p>
        </header>
        <ReportTraineeLedger rows={report.trainee_breakdown} />
      </section>
    </div>
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
      <EmptyRegister
        title="لا يوجد متدرّبون في هذه النسخة"
        description="يظهر السجل الفردي بعد دخول أول متدرّب في عينة التقرير."
        action={<span />}
      />
    );
  }

  const verdict = verdictMeta(selectedTrainee.verdict);
  const evidenceComplete = selectedTrainee.completeness.is_complete === true;

  return (
    <div className={styles.individualRecord}>
      <section className={styles.individualPicker}>
        <label>
          <span>سجل المتدرّب</span>
          <select
            value={selectedEnrollmentId}
            onChange={(event) => onSelect(event.target.value)}
          >
            {trainees.map((trainee) => (
              <option key={trainee.enrollment_id} value={trainee.enrollment_id}>
                {trainee.trainee_name} · {trainee.trainee_code}
              </option>
            ))}
          </select>
        </label>
        <Link
          href={`/trainees/${selectedTrainee.trainee_code}`}
          className={styles.secondaryAction}
        >
          فتح رحلة الدليل
          <span className={styles.forwardIcon}>
            <Icon name="arrow" size={15} />
          </span>
        </Link>
      </section>

      <section className={styles.individualDecision} aria-labelledby="individual-decision-title">
        <div className={styles.identityBlock}>
          <span dir="ltr">{selectedTrainee.trainee_code}</span>
          <h2 id="individual-decision-title">{selectedTrainee.trainee_name}</h2>
          <p>قرار الشهادة يعتمد على نتيجة القياس البعدي فقط.</p>
        </div>
        <div className={styles.verdictBlock}>
          <span>الحكم المعرفي</span>
          <strong>{verdict.label}</strong>
          <StatusBadge tone={verdict.tone}>
            البعدي {formatMetric(selectedTrainee.post_score, "%")}
          </StatusBadge>
        </div>
      </section>

      <section className={styles.evidenceRailSection} aria-labelledby="evidence-rail-title">
        <header className={styles.sectionHeading}>
          <div>
            <span>تتابع الدليل</span>
            <h2 id="evidence-rail-title">ثلاثة مصادر، وحكم واحد مستقل</h2>
          </div>
          <StatusBadge tone={evidenceComplete ? "success" : "warning"}>
            {evidenceComplete ? "الدليل مكتمل" : "الدليل ناقص"}
          </StatusBadge>
        </header>
        <ol className={styles.evidenceRail}>
          <EvidenceStep
            index="01"
            title="القياس القبلي"
            value={formatMetric(selectedTrainee.pre_score, "%")}
            detail="خط الأساس المعرفي"
            source="Jotform"
            state={selectedTrainee.completeness.has_pre ? "complete" : "missing"}
          />
          <EvidenceStep
            index="02"
            title="الأداء اللحظي"
            value={formatMetric(selectedTrainee.live_accuracy, "%")}
            detail={`${selectedTrainee.live_event_count} أحداث فعلية`}
            source="xAPI"
            state={selectedTrainee.completeness.has_live ? "complete" : "missing"}
          />
          <EvidenceStep
            index="03"
            title="القياس البعدي"
            value={formatMetric(selectedTrainee.post_score, "%")}
            detail={`فرق المعرفة ${formatMetric(selectedTrainee.knowledge_delta)}`}
            source="Jotform"
            state={selectedTrainee.completeness.has_post ? "complete" : "missing"}
          />
        </ol>
      </section>

      <dl className={styles.individualMetrics}>
        <LedgerMetric
          label="نمو المعرفة"
          value={formatMetric(selectedTrainee.knowledge_delta)}
          detail={`${formatMetric(selectedTrainee.pre_score, "%")} ← ${formatMetric(selectedTrainee.post_score, "%")}`}
        />
        <LedgerMetric
          label="نمو الثقة"
          value={formatMetric(selectedTrainee.confidence_delta)}
          detail={`${formatMetric(selectedTrainee.pre_confidence)} ← ${formatMetric(selectedTrainee.post_confidence)}`}
        />
        <LedgerMetric
          label="دقة الأداء"
          value={formatMetric(selectedTrainee.live_accuracy, "%")}
          detail={`${selectedTrainee.live_event_count} أحداث أداء`}
        />
      </dl>

      {!evidenceComplete && (
        <p className={styles.incompleteNote} role="note">
          <Icon name="warning" size={18} />
          الدليل غير مكتمل لغياب: {missingEvidenceLabels(selectedTrainee.completeness.missing)}.
        </p>
      )}
    </div>
  );
}

function SourceStamp({
  label,
  tone,
}: {
  label: string;
  tone: "assessment" | "live" | "calculation";
}) {
  return (
    <span className={`${styles.sourceStamp} ${styles[`source_${tone}`]}`}>
      <Icon name="source" size={14} />
      {label}
    </span>
  );
}

function LedgerMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd dir="auto">{value}</dd>
      <dd className={styles.metricDetail}>{detail}</dd>
    </div>
  );
}

function ComparisonRow({
  label,
  pre,
  post,
}: {
  label: string;
  pre: number | null;
  post: number | null;
}) {
  return (
    <div className={styles.comparisonRow}>
      <strong>{label}</strong>
      <div>
        <span>قبلي</span>
        <i aria-hidden="true"><b style={{ width: barWidth(pre) }} /></i>
        <b>{formatMetric(pre)}</b>
      </div>
      <div className={styles.afterRow}>
        <span>بعدي</span>
        <i aria-hidden="true"><b style={{ width: barWidth(post) }} /></i>
        <b>{formatMetric(post)}</b>
      </div>
    </div>
  );
}

function EvidenceStep({
  index,
  title,
  value,
  detail,
  source,
  state,
}: {
  index: string;
  title: string;
  value: string;
  detail: string;
  source: string;
  state: "complete" | "missing";
}) {
  return (
    <li className={state === "complete" ? styles.evidenceComplete : styles.evidenceMissing}>
      <span className={styles.evidenceIndex}>{index}</span>
      <div>
        <small>{title}</small>
        <strong>{value}</strong>
        <p>{detail}</p>
      </div>
      <span className={styles.miniSource}>{source}</span>
      <b>{state === "complete" ? "موثق" : "مفقود"}</b>
    </li>
  );
}

function ReportTraineeLedger({ rows }: { rows: TraineeBreakdown[] }) {
  if (rows.length === 0) {
    return <p className={styles.ledgerEmpty}>لا يوجد متدرّبون مسجّلون.</p>;
  }

  return (
    <>
      <div className={styles.tableWrap}>
        <table className={styles.ledgerTable}>
          <thead>
            <tr>
              <th>المتدرّب</th>
              <th>القبلي</th>
              <th>البعدي</th>
              <th>الفرق</th>
              <th>الأداء</th>
              <th>الحكم</th>
              <th><span className={styles.visuallyHidden}>فتح السجل</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const verdict = verdictMeta(row.verdict);
              return (
                <tr key={row.enrollment_id}>
                  <td>
                    <strong>{row.trainee_name}</strong>
                    <small dir="ltr">{row.trainee_code}</small>
                  </td>
                  <td>{formatMetric(row.pre_score, "%")}</td>
                  <td>{formatMetric(row.post_score, "%")}</td>
                  <td>{formatMetric(row.knowledge_delta)}</td>
                  <td>{row.live_event_count} أحداث</td>
                  <td><StatusBadge tone={verdict.tone}>{verdict.label}</StatusBadge></td>
                  <td>
                    <Link href={`/trainees/${row.trainee_code}`} aria-label={`فتح سجل ${row.trainee_name}`}>
                      فتح
                      <span className={styles.forwardIcon}><Icon name="arrow" size={14} /></span>
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className={styles.mobileLedger} aria-label="سجلات المتدرّبين">
        {rows.map((row, index) => {
          const verdict = verdictMeta(row.verdict);
          return (
            <details key={row.enrollment_id}>
              <summary>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{row.trainee_name}</strong>
                  <small dir="ltr">{row.trainee_code}</small>
                </div>
                <StatusBadge tone={verdict.tone}>{verdict.label}</StatusBadge>
              </summary>
              <dl>
                <div><dt>القبلي</dt><dd>{formatMetric(row.pre_score, "%")}</dd></div>
                <div><dt>البعدي</dt><dd>{formatMetric(row.post_score, "%")}</dd></div>
                <div><dt>فرق المعرفة</dt><dd>{formatMetric(row.knowledge_delta)}</dd></div>
                <div><dt>أحداث الأداء</dt><dd>{row.live_event_count}</dd></div>
              </dl>
              {!row.completeness.is_complete && (
                <p>ناقص: {missingEvidenceLabels(row.completeness.missing)}</p>
              )}
              <Link href={`/trainees/${row.trainee_code}`}>
                فتح رحلة الدليل
                <span className={styles.forwardIcon}><Icon name="arrow" size={14} /></span>
              </Link>
            </details>
          );
        })}
      </div>
    </>
  );
}
