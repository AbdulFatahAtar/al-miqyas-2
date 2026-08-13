import Link from "next/link";
import { createSupabaseServerClient } from "../lib/supabase/server";
import { AppShell, StatusBadge } from "./app-shell";
import { Icon } from "./icons";
import styles from "./dashboard-live-page.module.css";

type OrganizationRow = {
  name_ar: string;
  status: "active" | "suspended" | "archived";
};

type CohortReportRow = {
  cohort_id: string;
  sample_pre: number;
  sample_post: number;
  sample_matched: number;
  computed_at: string;
};

type CohortRow = {
  id: string;
  title: string;
  status: "draft" | "open" | "in_progress" | "closed" | "archived";
};

type TraineeRow = {
  code: string;
  full_name: string;
  status: "active" | "inactive" | "archived";
  created_at: string;
};

type MetricProps = {
  label: string;
  value: number | null;
  detail: string;
  tone?: "default" | "success" | "warning";
};

const dateFormatter = new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
  dateStyle: "long",
  timeZone: "Asia/Riyadh",
});

function MetricBlock({ label, value, detail, tone = "default" }: MetricProps) {
  return (
    <div className={`${styles.metricEntry} ${styles[`metric_${tone}`]}`}>
      <dt>{label}</dt>
      <dd>{value ?? "—"}</dd>
      <small>{detail}</small>
    </div>
  );
}

function countValue(result: { count: number | null; error: unknown }) {
  return result.error ? null : (result.count ?? 0);
}

export async function DashboardLivePage({
  organizationId,
  canManageTrainees,
  canManageSessions,
}: {
  organizationId: string;
  canManageTrainees: boolean;
  canManageSessions: boolean;
}) {
  const supabase = await createSupabaseServerClient();
  const [
    organizationResult,
    traineesResult,
    cohortsResult,
    completedEnrollmentsResult,
    validCertificatesResult,
    pendingReportsResult,
    unmatchedStatementsResult,
    acceptedStatementsResult,
    computedReportsResult,
    latestCohortReportResult,
    recentTraineesResult,
  ] = await Promise.all([
    supabase
      .from("organizations")
      .select("name_ar, status")
      .eq("id", organizationId)
      .maybeSingle(),
    supabase
      .from("trainees")
      .select("id", { count: "exact", head: true })
      .eq("org_id", organizationId)
      .eq("status", "active"),
    supabase
      .from("cohorts")
      .select("id", { count: "exact", head: true })
      .eq("org_id", organizationId)
      .in("status", ["open", "in_progress"]),
    supabase
      .from("enrollments")
      .select("id", { count: "exact", head: true })
      .eq("org_id", organizationId)
      .eq("status", "completed"),
    supabase
      .from("certificates")
      .select("id", { count: "exact", head: true })
      .eq("org_id", organizationId)
      .eq("status", "valid"),
    supabase
      .from("impact_reports")
      .select("id", { count: "exact", head: true })
      .eq("org_id", organizationId)
      .eq("status", "computed")
      .eq("verdict", "pending"),
    supabase
      .from("xapi_statements")
      .select("id", { count: "exact", head: true })
      .eq("org_id", organizationId)
      .in("processing_status", ["unmatched", "rejected"]),
    supabase
      .from("xapi_statements")
      .select("id", { count: "exact", head: true })
      .eq("org_id", organizationId)
      .eq("processing_status", "accepted"),
    supabase
      .from("impact_reports")
      .select("id", { count: "exact", head: true })
      .eq("org_id", organizationId)
      .eq("status", "computed"),
    supabase
      .from("cohort_reports")
      .select("cohort_id, sample_pre, sample_post, sample_matched, computed_at")
      .eq("org_id", organizationId)
      .eq("status", "computed")
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("trainees")
      .select("code, full_name, status, created_at")
      .eq("org_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const latestCohortReport =
    (latestCohortReportResult.data as CohortReportRow | null) ?? null;
  const cohortResult = latestCohortReport
    ? await supabase
        .from("cohorts")
        .select("id, title, status")
        .eq("org_id", organizationId)
        .eq("id", latestCohortReport.cohort_id)
        .maybeSingle()
    : { data: null, error: null };
  const organization =
    (organizationResult.data as OrganizationRow | null) ?? null;
  const cohort = (cohortResult.data as CohortRow | null) ?? null;
  const recentTrainees =
    (recentTraineesResult.data as TraineeRow[] | null) ?? [];
  const loadFailures = [
    organizationResult.error && "بيانات الجهة",
    traineesResult.error && "عدد المتدرّبين",
    cohortsResult.error && "الدفعات النشطة",
    completedEnrollmentsResult.error && "الرحلات المكتملة",
    validCertificatesResult.error && "الشهادات",
    pendingReportsResult.error && "التقارير المعلقة",
    unmatchedStatementsResult.error && "أحداث xAPI غير المطابقة",
    acceptedStatementsResult.error && "أحداث xAPI المقبولة",
    computedReportsResult.error && "التقارير المحسوبة",
    latestCohortReportResult.error && "آخر تقرير دفعة",
    recentTraineesResult.error && "آخر المتدرّبين",
    cohortResult.error && "اسم الدفعة",
  ].filter(Boolean) as string[];
  const activeTrainees = countValue(traineesResult);
  const activeCohorts = countValue(cohortsResult);
  const completedEnrollments = countValue(completedEnrollmentsResult);
  const validCertificates = countValue(validCertificatesResult);
  const pendingReports = countValue(pendingReportsResult);
  const unmatchedStatements = countValue(unmatchedStatementsResult);
  const acceptedStatements = countValue(acceptedStatementsResult);
  const computedReports = countValue(computedReportsResult);
  const todayLabel = dateFormatter.format(new Date());
  const evidenceSteps: Array<{
    source: string;
    label: string;
    value: number | null;
    tone: "success" | "system";
  }> = latestCohortReport
    ? [
        {
          source: "Jotform",
          label: "القياس القبلي",
          value: latestCohortReport.sample_pre,
          tone: "success",
        },
        {
          source: "AmadXR · xAPI",
          label: "الأحداث المقبولة",
          value: acceptedStatements,
          tone: "system",
        },
        {
          source: "Jotform",
          label: "القياس البعدي",
          value: latestCohortReport.sample_post,
          tone: "success",
        },
        {
          source: "محرك المقياس",
          label: "العينة المتطابقة",
          value: latestCohortReport.sample_matched,
          tone: "system",
        },
      ]
    : [];

  return (
    <AppShell title="الملخص">
      <header className={styles.operationHeader}>
        <div className={styles.operationIndex} aria-hidden="true">
          <span>اليوم</span>
          <strong>01</strong>
        </div>
        <div className={styles.operationTitle}>
          <p>{todayLabel} · {organization?.name_ar ?? "الجهة الحالية"}</p>
          <h1>صورة التشغيل الآن</h1>
          <span>
            مؤشرات حقيقية من قاعدة البيانات للجهة الحالية، مع إظهار أي جزء تعذر
            تحميله بدل استبداله ببيانات وهمية.
          </span>
        </div>
        <div className={styles.operationActions}>
          <small>إجراءات السجل</small>
          <div>
            <Link href="/sessions" className="button button-secondary">
              <Icon name="sessions" size={17} />
              متابعة الجلسات
            </Link>
            {canManageSessions && (
              <Link href="/sessions?create=1" className="button button-primary">
                <Icon name="plus" size={17} />
                جلسة جديدة
              </Link>
            )}
            <Link href="/trainees" className="button button-primary">
              <Icon name={canManageTrainees ? "plus" : "trainees"} size={17} />
              {canManageTrainees ? "تسجيل متدرّب" : "عرض المتدرّبين"}
            </Link>
          </div>
        </div>
      </header>

      {organization?.status !== "active" && organization && (
        <div className="inline-feedback warning-feedback" role="alert">
          <Icon name="warning" size={18} />
          هذه الجهة {organization.status === "suspended" ? "معلّقة" : "مؤرشفة"}.
          العرض متاح لمالك المنصة، لكن الكتابة التشغيلية يجب أن تبقى متوقفة.
        </div>
      )}

      {loadFailures.length > 0 && (
        <div className="inline-feedback error-feedback" role="alert">
          <Icon name="warning" size={18} />
          تعذر تحميل: {loadFailures.join("، ")}.
        </div>
      )}

      <dl className={styles.summaryLedger} aria-label="مؤشرات التشغيل">
        <MetricBlock
          label="المتدرّبون النشطون"
          value={activeTrainees}
          detail={activeCohorts === null ? "تعذر تحميل الدفعات" : `ضمن ${activeCohorts} دفعة نشطة`}
        />
        <MetricBlock
          label="رحلات مكتملة"
          value={completedEnrollments}
          detail="سجلات تسجيل بحالة مكتملة"
          tone="success"
        />
        <MetricBlock
          label="تقارير بانتظار دليل"
          value={pendingReports}
          detail="النتيجة الحالية معلقة"
          tone={pendingReports && pendingReports > 0 ? "warning" : "default"}
        />
        <MetricBlock
          label="شهادات صالحة"
          value={validCertificates}
          detail="صالحة للتحقق العام"
        />
      </dl>

      <div className={styles.dashboardLedger}>
        <section className={styles.evidenceRecord} aria-labelledby="latest-evidence-title">
          <div className={styles.recordHeader}>
            <span className={styles.recordIndex} aria-hidden="true">01</span>
            <div>
              <span className={styles.kicker}>آخر عينة محسوبة</span>
              <h2 id="latest-evidence-title">
                {cohort?.title ?? "لا يوجد تقرير دفعة بعد"}
              </h2>
            </div>
            <Link className={styles.inlineAction} href="/reports">
              فتح التقارير
              <span className={styles.forwardIcon}><Icon name="arrow" size={15} /></span>
            </Link>
          </div>
          {latestCohortReport ? (
            <>
              <ol className={styles.evidenceRail} aria-label="تسلسل مصادر الدليل">
                {evidenceSteps.map((step, index) => (
                  <li className={styles[`evidence_${step.tone}`]} key={step.label}>
                    <span className={styles.evidenceSequence} aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className={styles.sourceStamp}>
                      <small>المصدر</small>
                      <bdi dir="auto">{step.source}</bdi>
                    </div>
                    <strong>{step.label}</strong>
                    <span className={styles.evidenceValue} dir="ltr">
                      {step.value ?? "—"}
                    </span>
                  </li>
                ))}
              </ol>
              {latestCohortReport.sample_pre !== latestCohortReport.sample_post && (
                <div className={styles.sampleWarning} role="status">
                  <Icon name="warning" size={18} />
                  <span>
                    <strong>العينتان غير متساويتين.</strong> لا يُفترض اعتبار فرق
                    المتوسط نتيجة نهائية قبل فحص العينة المتطابقة.
                  </span>
                </div>
              )}
            </>
          ) : (
            <div className={styles.emptyState}>
              <Icon name="reports" size={26} />
              <h3>لا توجد عينة محسوبة</h3>
              <p>سيظهر تدفق الدليل هنا بعد حساب أول تقرير دفعة حقيقي.</p>
            </div>
          )}
        </section>

        <aside className={styles.exceptionLedger} aria-labelledby="exceptions-title">
          <div className={styles.recordHeader}>
            <span className={styles.recordIndex} aria-hidden="true">!</span>
            <div>
              <span className={styles.kicker}>بحاجة إلى تدخل</span>
              <h2 id="exceptions-title">
                {unmatchedStatements === null || pendingReports === null
                  ? "تعذر الحساب"
                  : `${unmatchedStatements + pendingReports} حالات`}
              </h2>
            </div>
          </div>
          {unmatchedStatements && unmatchedStatements > 0 ? (
            <Link className={styles.exceptionLink} href="/sessions">
              <span className={styles.exceptionDanger}><Icon name="source" size={18} /></span>
              <span>
                <strong>أحداث xAPI غير مطابقة أو مرفوضة</strong>
                <small>{unmatchedStatements} أحداث تحتاج مراجعة</small>
              </span>
              <span className={styles.forwardIcon}><Icon name="chevron" size={15} /></span>
            </Link>
          ) : null}
          {pendingReports && pendingReports > 0 ? (
            <Link className={styles.exceptionLink} href="/reports">
              <span className={styles.exceptionWarning}><Icon name="reports" size={18} /></span>
              <span>
                <strong>تقارير تنتظر اكتمال الدليل</strong>
                <small>{pendingReports} نتائج معلقة</small>
              </span>
              <span className={styles.forwardIcon}><Icon name="chevron" size={15} /></span>
            </Link>
          ) : null}
          {unmatchedStatements === 0 && pendingReports === 0 && (
            <div className={styles.emptyState}>
              <Icon name="check" size={24} />
              <h3>لا توجد حالات معلقة ظاهرة</h3>
              <p>هذا الحكم مبني على البيانات التي أمكن قراءتها الآن.</p>
            </div>
          )}
        </aside>
      </div>

      <section className={styles.traineeLedger} aria-labelledby="recent-trainees-title">
        <div className={styles.recordHeader}>
          <span className={styles.recordIndex} aria-hidden="true">02</span>
          <div>
            <span className={styles.kicker}>آخر الإضافات</span>
            <h2 id="recent-trainees-title">سجل المتدرّبين</h2>
          </div>
          <Link className={styles.inlineAction} href="/trainees">
            عرض الكل
            <span className={styles.forwardIcon}><Icon name="arrow" size={15} /></span>
          </Link>
        </div>
        {recentTrainees.length > 0 ? (
          <div className={styles.tableRegion} role="region" aria-label="آخر المتدرّبين" tabIndex={0}>
            <table className={styles.ledgerTable}>
              <caption className="sr-only">آخر المتدرّبين المضافين للجهة</caption>
              <thead>
                <tr>
                  <th scope="col">المتدرّب</th>
                  <th scope="col">المعرّف</th>
                  <th scope="col">الحالة</th>
                  <th scope="col">تاريخ الإضافة</th>
                  <th scope="col"><span className="sr-only">فتح</span></th>
                </tr>
              </thead>
              <tbody>
                {recentTrainees.map((trainee) => (
                  <tr key={trainee.code}>
                    <td><strong>{trainee.full_name}</strong></td>
                    <td className={styles.identifier} dir="ltr">{trainee.code}</td>
                    <td>
                      <StatusBadge tone={trainee.status === "active" ? "success" : "muted"}>
                        {trainee.status === "active" ? "نشط" : trainee.status === "inactive" ? "غير نشط" : "مؤرشف"}
                      </StatusBadge>
                    </td>
                    <td>{dateFormatter.format(new Date(trainee.created_at))}</td>
                    <td>
                      <Link
                        className={styles.rowAction}
                        href={`/trainees/${trainee.code}`}
                        aria-label={`فتح سجل ${trainee.full_name}`}
                      >
                        <span className={styles.forwardIcon}><Icon name="chevron" size={16} /></span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.emptyState}>
            <Icon name="trainees" size={26} />
            <h3>لا يوجد متدرّبون بعد</h3>
            <p>ابدأ بتسجيل متدرّب حقيقي؛ لن نعرض أسماء تجريبية مكان البيانات.</p>
          </div>
        )}
      </section>

      <p className="sr-only" aria-live="polite">
        عُرض {computedReports ?? 0} تقريرًا محسوبًا و{validCertificates ?? 0} شهادة صالحة.
      </p>
    </AppShell>
  );
}
