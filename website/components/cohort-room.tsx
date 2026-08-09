"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { AppShell, StatusBadge } from "./app-shell";
import { Icon } from "./icons";
import { createSupabaseBrowserClient } from "../lib/supabase/client";
import { xapiVerbLabel } from "../lib/xapi-display";

type RoomStage = "pre" | "live" | "post" | "report" | "certificate";
type Tone = "success" | "warning" | "danger" | "system" | "muted";

type CohortRecord = {
  id: string;
  code: string;
  title: string;
  status: "draft" | "open" | "in_progress" | "closed" | "archived";
  starts_on: string | null;
  ends_on: string | null;
  program_id: string;
  program_version_id: string;
};

type CohortReportRecord = {
  id: string;
  version_number: number;
  sample_pre: number;
  sample_post: number;
  sample_matched: number;
  warnings: unknown;
  computed_at: string;
};

type CertificateRecord = {
  enrollment_id: string;
  certificate_number: string;
  verify_code: string;
  issued_at: string;
};

type ParticipantRecord = {
  enrollment_id: string;
  trainee_id: string;
  enrollment_status: "invited" | "active" | "completed";
  enrolled_at: string;
  trainee_code: string | null;
  trainee_name: string | null;
  trainee_status: "active" | "inactive" | "archived" | null;
  has_pre: boolean;
  has_live: boolean;
  has_unmatched: boolean;
  has_post: boolean;
  report_verdict: "passed" | "not_passed" | "pending" | null;
  has_valid_certificate: boolean;
};

type XapiRoomEvent = {
  id: string;
  enrollment_id: string | null;
  trainee_code_received: string;
  verb_id: string;
  processing_status: "accepted" | "unmatched";
  occurred_at: string;
  is_test_event: boolean;
};

type CohortRoomData = {
  cohort: CohortRecord;
  programTitle: string;
  passThreshold: number;
  enrollmentCount: number;
  participantLimit: number;
  participants: ParticipantRecord[];
  stageCounts: Record<RoomStage, number>;
  assessmentSummary: {
    preAverage: number | null;
    preLatestSubmission: string | null;
    postAverage: number | null;
    postLatestSubmission: string | null;
  };
  xapiSummary: {
    acceptedCount: number;
    unmatchedCount: number;
    testCount: number;
    events: XapiRoomEvent[];
  };
  reportSummary: {
    computedCount: number;
    passedCount: number;
    notPassedCount: number;
    pendingCount: number;
    cohortReport: CohortReportRecord | null;
  };
  certificateSummary: {
    validCount: number;
    revokedCount: number;
    supersededCount: number;
    validCertificates: CertificateRecord[];
  };
};

type StageDefinition = {
  id: RoomStage;
  index: string;
  label: string;
  source: string;
  received: number;
  target: number;
};

type ParticipantView = {
  participant: ParticipantRecord;
  state: string;
  tone: Tone;
};

type LoadFailureKind = "authentication" | "authorization" | "not_found" | "other";

class CohortRoomLoadError extends Error {
  constructor(
    message: string,
    readonly kind: LoadFailureKind,
  ) {
    super(message);
    this.name = "CohortRoomLoadError";
  }
}

const stageOrder: RoomStage[] = [
  "pre",
  "live",
  "post",
  "report",
  "certificate",
];

const dateFormatter = new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
  dateStyle: "medium",
  timeZone: "Asia/Riyadh",
});

const dateTimeFormatter = new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Asia/Riyadh",
});

const timeFormatter = new Intl.DateTimeFormat("ar-SA", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "Asia/Riyadh",
});

function formatDate(value: string | null) {
  return value ? dateFormatter.format(new Date(value)) : "غير محدد";
}

function formatDateTime(value: string | null) {
  return value ? dateTimeFormatter.format(new Date(value)) : "—";
}

function percentage(received: number, target: number) {
  if (target <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round((received / target) * 100)));
}

function cohortStatus(status: CohortRecord["status"]) {
  const labels: Record<CohortRecord["status"], { label: string; tone: Tone }> = {
    draft: { label: "مسودة", tone: "muted" },
    open: { label: "مفتوحة للتسجيل", tone: "system" },
    in_progress: { label: "قيد التنفيذ", tone: "success" },
    closed: { label: "مغلقة", tone: "muted" },
    archived: { label: "مؤرشفة", tone: "warning" },
  };

  return labels[status];
}

function warningText(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const candidate = (value as Record<string, unknown>).message;
    return typeof candidate === "string" && candidate.trim()
      ? candidate.trim()
      : null;
  }

  return null;
}

function reportWarnings(value: unknown) {
  return Array.isArray(value)
    ? value.map(warningText).filter((item): item is string => Boolean(item))
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCohortRoomData(value: unknown): CohortRoomData {
  if (
    !isRecord(value) ||
    !isRecord(value.cohort) ||
    !Array.isArray(value.participants) ||
    !isRecord(value.stageCounts) ||
    !isRecord(value.assessmentSummary) ||
    !isRecord(value.xapiSummary) ||
    !Array.isArray(value.xapiSummary.events) ||
    !isRecord(value.reportSummary) ||
    !isRecord(value.certificateSummary) ||
    !Array.isArray(value.certificateSummary.validCertificates) ||
    typeof value.programTitle !== "string" ||
    typeof value.enrollmentCount !== "number"
  ) {
    throw new CohortRoomLoadError(
      "استجابت قاعدة البيانات بصيغة غير متوقعة.",
      "other",
    );
  }

  return value as unknown as CohortRoomData;
}

function classifyLoadFailure(error: unknown) {
  if (error instanceof CohortRoomLoadError) {
    return error;
  }

  const failure = isRecord(error) ? error : {};
  const code = typeof failure.code === "string" ? failure.code : "";
  const rawMessage =
    typeof failure.message === "string" ? failure.message : "";
  const normalizedMessage = rawMessage.toLowerCase();

  if (
    code === "PGRST301" ||
    code === "PGRST302" ||
    normalizedMessage.includes("jwt") ||
    normalizedMessage.includes("not authenticated")
  ) {
    return new CohortRoomLoadError(
      "انتهت جلسة الدخول. جارٍ إعادتك إلى صفحة الدخول.",
      "authentication",
    );
  }

  if (code === "42501") {
    return new CohortRoomLoadError(
      "لم تعد تملك صلاحية عرض غرفة هذه الدفعة.",
      "authorization",
    );
  }

  if (code === "P0002") {
    return new CohortRoomLoadError(
      "لم يُعثر على هذه الدفعة داخل الجهة الحالية.",
      "not_found",
    );
  }

  return new CohortRoomLoadError("تعذر تحديث بيانات غرفة الدفعة.", "other");
}

function StageRail({
  stages,
  active,
  onChange,
}: {
  stages: StageDefinition[];
  active: RoomStage;
  onChange: (stage: RoomStage) => void;
}) {
  const tabRefs = useRef<Partial<Record<RoomStage, HTMLButtonElement | null>>>(
    {},
  );

  function selectByKeyboard(
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) {
    let nextIndex: number | null = null;

    const isRtl = document.documentElement.dir === "rtl";

    if (event.key === "ArrowRight") {
      nextIndex = isRtl
        ? (currentIndex - 1 + stages.length) % stages.length
        : (currentIndex + 1) % stages.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = isRtl
        ? (currentIndex + 1) % stages.length
        : (currentIndex - 1 + stages.length) % stages.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = stages.length - 1;
    }

    if (nextIndex === null) {
      return;
    }

    event.preventDefault();
    const nextStage = stages[nextIndex].id;
    onChange(nextStage);
    tabRefs.current[nextStage]?.focus();
  }

  return (
    <div
      className="stage-rail cohort-stage-rail"
      role="tablist"
      aria-label="محطات بيانات الدفعة"
      aria-orientation="horizontal"
    >
      {stages.map((stage, index) => {
        const isActive = stage.id === active;
        const complete = stage.target > 0 && stage.received >= stage.target;

        return (
          <button
            key={stage.id}
            ref={(node) => {
              tabRefs.current[stage.id] = node;
            }}
            id={`cohort-stage-tab-${stage.id}`}
            className={`stage-tab ${
              isActive
                ? "active tone-system"
                : complete
                  ? "tone-success"
                  : ""
            }`}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls="cohort-stage-panel"
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(stage.id)}
            onKeyDown={(event) => selectByKeyboard(event, index)}
          >
            <span className="stage-progress" />
            <span className="stage-index">{stage.index}</span>
            <span>
              <strong>{stage.label}</strong>
              <small dir="auto">
                {stage.received}/{stage.target} · {stage.source}
              </small>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ProgressPanel({ stage }: { stage: StageDefinition }) {
  const progress = percentage(stage.received, stage.target);

  return (
    <section className="room-progress-panel" aria-label="اكتمال المحطة">
      <div className="room-progress-copy">
        <div>
          <span>المتدرّبون المكتملون</span>
          <strong dir="ltr">
            {stage.received} / {stage.target}
          </strong>
        </div>
        <small>
          {stage.target === 0
            ? "لا يوجد تسجيل فعّال في هذه الدفعة."
            : stage.received >= stage.target
              ? "اكتملت هذه المحطة لكل المسجلين."
              : `متبقٍ ${stage.target - stage.received} من المسجلين.`}
        </small>
      </div>
      <div
        className="room-progress-track"
        role="progressbar"
        aria-label={`اكتمال ${stage.label}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        aria-valuetext={
          stage.target === 0
            ? "لا يوجد مسجلون"
            : `${stage.received} من ${stage.target}`
        }
      >
        <span
          style={{
            width: "100%",
            transform: `scaleX(${progress / 100})`,
            transformOrigin: "right center",
          }}
        />
      </div>
    </section>
  );
}

function AssessmentStage({
  kind,
  stage,
  averageScore,
  latestSubmission,
}: {
  kind: "pre" | "post";
  stage: StageDefinition;
  averageScore: number | null;
  latestSubmission: string | null;
}) {
  return (
    <div className="room-entry-stage">
      <section className="room-instruction cohort-data-note">
        <div className="room-qr-mark">
          <Icon name="source" size={58} />
        </div>
        <div>
          <span className="eyebrow">بيانات مستلمة من Jotform</span>
          <h3>
            نتائج {kind === "pre" ? "القياس القبلي" : "القياس البعدي"}
          </h3>
          <p>
            يحتسب الاكتمال من سجلات assessments المرتبطة بتسجيلات هذه الدفعة
            فقط. لا تنشئ هذه الشاشة نتائج ولا تغيّر بيانات المتدرّبين.
          </p>
          <Link className="button button-secondary" href="/trainees">
            فتح سجل المتدرّبين
          </Link>
        </div>
      </section>

      <div className="room-impact-grid" aria-label="مؤشرات نتائج القياس">
        <div>
          <span>النتائج المستلمة</span>
          <strong>{stage.received}</strong>
        </div>
        <div>
          <span>بانتظار النتيجة</span>
          <strong>{Math.max(stage.target - stage.received, 0)}</strong>
        </div>
        <div>
          <span>متوسط النتيجة</span>
          <strong dir="ltr">{averageScore === null ? "—" : `${averageScore}%`}</strong>
        </div>
        <div>
          <span>آخر استلام</span>
          <strong className="cohort-compact-value">
            {formatDateTime(latestSubmission)}
          </strong>
        </div>
      </div>

      <ProgressPanel stage={stage} />
    </div>
  );
}

function LiveStage({
  stage,
  acceptedCount,
  unmatchedCount,
  testCount,
  events,
}: {
  stage: StageDefinition;
  acceptedCount: number;
  unmatchedCount: number;
  testCount: number;
  events: XapiRoomEvent[];
}) {
  return (
    <div>
      <div className="room-live-metrics">
        <div>
          <span>متدرّبون بأداء مقبول</span>
          <strong dir="ltr">
            {stage.received}/{stage.target}
          </strong>
          <small>لديهم حدث أداء accepted</small>
        </div>
        <div>
          <span>أحداث accepted</span>
          <strong>{acceptedCount}</strong>
          <small>تشمل {testCount} اختبار اتصال</small>
        </div>
        <div>
          <span>أحداث غير مطابقة</span>
          <strong className="warning-value">{unmatchedCount}</strong>
          <small>مرتبطة بمعرّفات مسجلي الدفعة</small>
        </div>
      </div>

      <ProgressPanel stage={stage} />

      <section className="room-live-feed">
        <div className="section-title">
          <div>
            <span className="eyebrow">آخر أحداث الدفعة</span>
            <h3>سجل xAPI المقبول وغير المطابق</h3>
          </div>
          <StatusBadge tone={unmatchedCount > 0 ? "warning" : "system"}>
            {testCount} اختبار اتصال
          </StatusBadge>
        </div>

        {events.length === 0 ? (
          <div className="empty-state compact-empty-state">
            <Icon name="sessions" size={28} />
            <h3>لا توجد أحداث xAPI لهذه الدفعة</h3>
            <p>ستظهر الأحداث هنا بعد استقبالها وربطها بهذه الدفعة.</p>
          </div>
        ) : (
          <div
            className="event-stream cohort-event-stream"
            role="table"
            aria-label="آخر أحداث xAPI الخاصة بالدفعة"
          >
            <div className="event-stream-head" role="row">
              <span role="columnheader">الوقت</span>
              <span role="columnheader">المعرّف</span>
              <span role="columnheader">الفعل</span>
              <span role="columnheader">الحالة</span>
            </div>
            {events.map((event) => (
              <div className="event-stream-row" role="row" key={event.id}>
                <span className="mono" role="cell">
                  {timeFormatter.format(new Date(event.occurred_at))}
                </span>
                <span className="mono" dir="ltr" role="cell">
                  {event.trainee_code_received}
                </span>
                <span role="cell">
                  {event.is_test_event
                    ? "اختبار اتصال"
                    : xapiVerbLabel(event.verb_id)}
                </span>
                <span role="cell">
                  <StatusBadge
                    tone={
                      event.processing_status === "accepted"
                        ? "success"
                        : "warning"
                    }
                  >
                    {event.processing_status === "accepted"
                      ? "مقبول"
                      : "غير مطابق"}
                  </StatusBadge>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ReportStage({
  stage,
  cohortReport,
  passedCount,
  notPassedCount,
  pendingCount,
}: {
  stage: StageDefinition;
  cohortReport: CohortReportRecord | null;
  passedCount: number;
  notPassedCount: number;
  pendingCount: number;
}) {
  const warnings = reportWarnings(cohortReport?.warnings);

  return (
    <div className="room-result-stage cohort-result-stage">
      <div className="room-impact-grid" aria-label="مؤشرات تقارير الأثر">
        <div>
          <span>تقارير أفراد محسوبة</span>
          <strong>{stage.received}</strong>
        </div>
        <div>
          <span>مجتازون</span>
          <strong>{passedCount}</strong>
        </div>
        <div>
          <span>غير مجتازين</span>
          <strong>{notPassedCount}</strong>
        </div>
        <div>
          <span>النتيجة معلّقة</span>
          <strong>{pendingCount}</strong>
        </div>
      </div>

      <ProgressPanel stage={stage} />

      {cohortReport ? (
        <section className="content-section cohort-report-summary">
          <div className="section-title">
            <div>
              <span className="eyebrow">تقرير الدفعة المحسوب</span>
              <h3>الإصدار {cohortReport.version_number}</h3>
            </div>
            <span className="table-muted">
              {formatDateTime(cohortReport.computed_at)}
            </span>
          </div>
          <dl className="cohort-report-facts">
            <div>
              <dt>العينة القبلية</dt>
              <dd>{cohortReport.sample_pre}</dd>
            </div>
            <div>
              <dt>العينة البعدية</dt>
              <dd>{cohortReport.sample_post}</dd>
            </div>
            <div>
              <dt>العينة المتطابقة</dt>
              <dd>{cohortReport.sample_matched}</dd>
            </div>
          </dl>
          {warnings.map((warning, index) => (
            <div className="sample-warning" key={`${warning}-${index}`}>
              <Icon name="warning" size={18} />
              <span>{warning}</span>
            </div>
          ))}
        </section>
      ) : (
        <div className="empty-state compact-empty-state">
          <Icon name="reports" size={30} />
          <h3>لا يوجد تقرير دفعة محسوب</h3>
          <p>تقارير الأفراد أعلاه مستقلة عن تقرير التجميع الخاص بالدفعة.</p>
        </div>
      )}

      <Link className="button button-primary" href="/reports">
        فتح إدارة التقارير
      </Link>
    </div>
  );
}

function CertificateStage({
  stage,
  validCertificates,
  revokedCount,
  supersededCount,
  passThreshold,
}: {
  stage: StageDefinition;
  validCertificates: CertificateRecord[];
  revokedCount: number;
  supersededCount: number;
  passThreshold: number;
}) {
  return (
    <div className="room-result-stage cohort-result-stage">
      <div className="room-impact-grid" aria-label="مؤشرات الشهادات">
        <div>
          <span>شهادات صالحة</span>
          <strong>{stage.received}</strong>
        </div>
        <div>
          <span>بدون شهادة صالحة</span>
          <strong>{Math.max(stage.target - stage.received, 0)}</strong>
        </div>
        <div>
          <span>ملغاة</span>
          <strong>{revokedCount}</strong>
        </div>
        <div>
          <span>مستبدلة</span>
          <strong>{supersededCount}</strong>
        </div>
      </div>

      <ProgressPanel stage={stage} />

      <section className="content-section cohort-certificate-list">
        <div className="section-title">
          <div>
            <span className="eyebrow">الشهادات الفعّالة</span>
            <h3>حد الاجتياز المسجل: {passThreshold}%</h3>
          </div>
        </div>
        {validCertificates.length === 0 ? (
          <div className="empty-state compact-empty-state">
            <Icon name="certificates" size={30} />
            <h3>لا توجد شهادة صالحة لهذه الدفعة</h3>
            <p>الإصدار لا يتم من هذه الشاشة.</p>
          </div>
        ) : (
          <div className="cohort-certificate-rows">
            {validCertificates.map((certificate) => (
              <div key={certificate.verify_code}>
                <span>
                  <strong dir="ltr">{certificate.certificate_number}</strong>
                  <small>{formatDateTime(certificate.issued_at)}</small>
                </span>
                <Link
                  className="table-action"
                  href={`/verify/${encodeURIComponent(certificate.verify_code)}`}
                >
                  التحقق العام <Icon name="external" size={14} />
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>

      <Link className="button button-primary" href="/certificates">
        فتح إدارة الشهادات
      </Link>
    </div>
  );
}

export function CohortRoom({
  cohortId,
  organizationId,
}: {
  cohortId: string;
  organizationId: string;
}) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [activeStage, setActiveStage] = useState<RoomStage>("pre");
  const [data, setData] = useState<CohortRoomData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const requestVersion = useRef(0);
  const abortController = useRef<AbortController | null>(null);

  const loadData = useCallback(
    async (initialLoad = false) => {
      const currentVersion = requestVersion.current + 1;
      requestVersion.current = currentVersion;
      abortController.current?.abort();
      const controller = new AbortController();
      abortController.current = controller;

      if (initialLoad) {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }
      setErrorMessage("");

      try {
        const result = await supabase
          .rpc("get_cohort_room", {
            target_org_id: organizationId,
            target_cohort_id: cohortId,
          })
          .abortSignal(controller.signal);

        if (result.error) {
          throw result.error;
        }

        const nextData = parseCohortRoomData(result.data);
        if (requestVersion.current !== currentVersion) {
          return;
        }

        setData(nextData);
        setLastRefreshedAt(new Date());
      } catch (error) {
        if (
          controller.signal.aborted ||
          requestVersion.current !== currentVersion
        ) {
          return;
        }

        const failure = classifyLoadFailure(error);
        setErrorMessage(failure.message);

        if (
          failure.kind === "authentication" ||
          failure.kind === "authorization" ||
          failure.kind === "not_found"
        ) {
          setData(null);
        }

        if (failure.kind === "authentication") {
          window.location.replace(
            `/login?next=${encodeURIComponent(`/cohorts/${cohortId}/run`)}`,
          );
        } else if (failure.kind === "authorization") {
          window.location.replace(
            `/forbidden?from=${encodeURIComponent(`/cohorts/${cohortId}/run`)}`,
          );
        }
      } finally {
        if (requestVersion.current === currentVersion) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [cohortId, organizationId, supabase],
  );

  useEffect(() => {
    void loadData(true);
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadData(false);
      }
    }, 30_000);

    function refreshWhenVisible() {
      if (document.visibilityState === "visible") {
        void loadData(false);
      }
    }

    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      requestVersion.current += 1;
      abortController.current?.abort();
    };
  }, [loadData]);

  const derived = useMemo(() => {
    if (!data) {
      return null;
    }

    const targets = data.enrollmentCount;
    const stages: StageDefinition[] = [
      {
        id: "pre",
        index: "01",
        label: "القياس القبلي",
        source: "Jotform",
        received: data.stageCounts.pre,
        target: targets,
      },
      {
        id: "live",
        index: "02",
        label: "الأداء اللحظي",
        source: "AmadXR · xAPI",
        received: data.stageCounts.live,
        target: targets,
      },
      {
        id: "post",
        index: "03",
        label: "القياس البعدي",
        source: "Jotform",
        received: data.stageCounts.post,
        target: targets,
      },
      {
        id: "report",
        index: "04",
        label: "تقرير الأثر",
        source: "محرك المقياس",
        received: data.stageCounts.report,
        target: targets,
      },
      {
        id: "certificate",
        index: "05",
        label: "الشهادات",
        source: "منظومة المقياس",
        received: data.stageCounts.certificate,
        target: targets,
      },
    ];

    const participants: ParticipantView[] = data.participants.map(
      (participant) => {
        let state = "لا توجد بيانات";
        let tone: Tone = "muted";

        if (activeStage === "pre") {
          state = participant.has_pre ? "مكتمل" : "بانتظار النتيجة";
          tone = participant.has_pre ? "success" : "warning";
        } else if (activeStage === "live") {
          if (participant.has_live) {
            state = "أداء مقبول";
            tone = "success";
          } else if (participant.has_unmatched) {
            state = "يحتاج مطابقة";
            tone = "warning";
          } else {
            state = "لا توجد جلسة";
            tone = "muted";
          }
        } else if (activeStage === "post") {
          state = participant.has_post ? "مكتمل" : "بانتظار النتيجة";
          tone = participant.has_post ? "success" : "warning";
        } else if (activeStage === "report") {
          if (participant.report_verdict === "passed") {
            state = "مجتاز";
            tone = "success";
          } else if (participant.report_verdict === "not_passed") {
            state = "غير مجتاز";
            tone = "danger";
          } else if (participant.report_verdict === "pending") {
            state = "نتيجة معلّقة";
            tone = "warning";
          } else {
            state = "لم يُحسب";
            tone = "muted";
          }
        } else if (participant.has_valid_certificate) {
          state = "شهادة صالحة";
          tone = "success";
        } else if (participant.report_verdict === "passed") {
          state = "مستحق غير مُصدر";
          tone = "warning";
        } else {
          state = "غير مستحق حاليًا";
          tone = "muted";
        }

        return { participant, state, tone };
      },
    );

    return { stages, participants };
  }, [activeStage, data]);

  if (isLoading && !data) {
    return (
      <AppShell title="تشغيل الدفعة">
        <section className="content-section loading-state" aria-live="polite">
          جارٍ تحميل بيانات الدفعة الفعلية...
        </section>
      </AppShell>
    );
  }

  if (!data || !derived) {
    return (
      <AppShell title="تشغيل الدفعة">
        <section className="content-section empty-state" role="alert">
          <Icon name="warning" size={32} />
          <h1>تعذر فتح غرفة الدفعة</h1>
          <p>{errorMessage || "لا توجد بيانات متاحة لهذه الدفعة."}</p>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => void loadData(true)}
          >
            إعادة المحاولة
          </button>
        </section>
      </AppShell>
    );
  }

  const activeIndex = derived.stages.findIndex(
    (stage) => stage.id === activeStage,
  );
  const current = derived.stages[activeIndex];
  const currentProgress = percentage(current.received, current.target);
  const status = cohortStatus(data.cohort.status);

  return (
    <AppShell title="تشغيل الدفعة">
      <div className="cohort-room-header">
        <div>
          <div className="breadcrumb-row">
            <Link href="/programs">البرامج والدفعات</Link>
            <Icon name="chevron" size={14} />
            <span>مراقبة الدفعة</span>
          </div>
          <span className="eyebrow">{data.programTitle}</span>
          <h1>{data.cohort.title}</h1>
          <p>
            متابعة قراءة فقط لنتائج القياس والأداء والتقارير والشهادات الخاصة
            بهذه الدفعة.
          </p>
        </div>
        <div className="cohort-room-actions">
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => void loadData(false)}
            disabled={isRefreshing}
            aria-busy={isRefreshing}
          >
            <Icon name="source" size={16} />
            {isRefreshing ? "جارٍ التحديث..." : "تحديث البيانات"}
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="inline-feedback danger-feedback" role="alert">
          <Icon name="warning" size={17} />
          {errorMessage} المعروض أدناه هو آخر تحديث ناجح.
        </div>
      )}

      <div className="live-data-notice">
        <Icon name="check" size={17} />
        <span>
          <strong>بيانات فعلية من Supabase.</strong> آخر تحديث: {" "}
          {lastRefreshedAt
            ? dateTimeFormatter.format(lastRefreshedAt)
            : "لم يكتمل بعد"}
          . يتم التحديث تلقائيًا كل 30 ثانية عند ظهور الصفحة.
        </span>
      </div>

      <section className="cohort-overview" aria-label="ملخص الدفعة">
        <div>
          <span>رمز الدفعة</span>
          <strong className="mono" dir="ltr">
            {data.cohort.code}
          </strong>
        </div>
        <div>
          <span>التسجيلات المحتسبة</span>
          <strong>{data.enrollmentCount}</strong>
        </div>
        <div>
          <span>فترة الدفعة</span>
          <strong className="cohort-compact-value">
            {formatDate(data.cohort.starts_on)} — {formatDate(data.cohort.ends_on)}
          </strong>
        </div>
        <div>
          <span>اكتمال المحطة المعروضة</span>
          <strong>{currentProgress}%</strong>
        </div>
      </section>

      <section className="cohort-run-shell">
        <header className="cohort-run-title">
          <div>
            <span className="eyebrow">مسار الإثبات</span>
            <h2>البيانات الحالية من الدخول إلى الشهادة</h2>
          </div>
          <StatusBadge
            tone={
              current.target > 0 && current.received >= current.target
                ? "success"
                : "system"
            }
          >
            {current.target > 0 && current.received >= current.target
              ? "المحطة مكتملة"
              : `${current.received} من ${current.target}`}
          </StatusBadge>
        </header>

        <StageRail
          stages={derived.stages}
          active={activeStage}
          onChange={setActiveStage}
        />

        <div className="cohort-room-grid">
          <article className="room-stage-panel">
            <header>
              <div>
                <span>المحطة {current.index} من 05</span>
                <h2>{current.label}</h2>
                <p dir="auto">المصدر: {current.source}</p>
              </div>
              <strong dir="ltr">
                {current.received} / {current.target}
              </strong>
            </header>

            <div
              className="room-stage-content"
              id="cohort-stage-panel"
              role="tabpanel"
              aria-labelledby={`cohort-stage-tab-${activeStage}`}
              tabIndex={0}
            >
              {activeStage === "pre" && (
                <AssessmentStage
                  kind="pre"
                  stage={current}
                  averageScore={data.assessmentSummary.preAverage}
                  latestSubmission={
                    data.assessmentSummary.preLatestSubmission
                  }
                />
              )}
              {activeStage === "live" && (
                <LiveStage
                  stage={current}
                  acceptedCount={data.xapiSummary.acceptedCount}
                  unmatchedCount={data.xapiSummary.unmatchedCount}
                  testCount={data.xapiSummary.testCount}
                  events={data.xapiSummary.events}
                />
              )}
              {activeStage === "post" && (
                <AssessmentStage
                  kind="post"
                  stage={current}
                  averageScore={data.assessmentSummary.postAverage}
                  latestSubmission={
                    data.assessmentSummary.postLatestSubmission
                  }
                />
              )}
              {activeStage === "report" && (
                <ReportStage
                  stage={current}
                  cohortReport={data.reportSummary.cohortReport}
                  passedCount={data.reportSummary.passedCount}
                  notPassedCount={data.reportSummary.notPassedCount}
                  pendingCount={data.reportSummary.pendingCount}
                />
              )}
              {activeStage === "certificate" && (
                <CertificateStage
                  stage={current}
                  validCertificates={
                    data.certificateSummary.validCertificates
                  }
                  revokedCount={data.certificateSummary.revokedCount}
                  supersededCount={data.certificateSummary.supersededCount}
                  passThreshold={data.passThreshold}
                />
              )}
            </div>
          </article>

          <aside className="participant-monitor" aria-label="حالة المسجلين">
            <div className="participant-monitor-head">
              <div>
                <span className="eyebrow">التسجيلات الفعلية</span>
                <h2>حالة المتدرّبين</h2>
              </div>
              <span>
                {data.enrollmentCount > derived.participants.length
                  ? `أول ${derived.participants.length} من ${data.enrollmentCount}`
                  : `${data.enrollmentCount} مسجل`}
              </span>
            </div>
            {derived.participants.length === 0 ? (
              <div className="empty-state compact-empty-state">
                <Icon name="trainees" size={28} />
                <h3>لا يوجد مسجلون</h3>
                <p>لا توجد تسجيلات محتسبة في هذه الدفعة.</p>
              </div>
            ) : (
              <div className="participant-list">
                {derived.participants.map((participant) => (
                  <div
                    key={participant.participant.enrollment_id}
                    className="participant-row"
                  >
                    <span className="participant-avatar">
                      {participant.participant.trainee_name?.charAt(0) ?? "—"}
                    </span>
                    <span>
                      <strong>
                        {participant.participant.trainee_name ??
                          "متدرّب غير متاح"}
                      </strong>
                      <small className="mono" dir="ltr">
                        {participant.participant.trainee_code ??
                          participant.participant.enrollment_id}
                      </small>
                    </span>
                    <StatusBadge tone={participant.tone}>
                      {participant.state}
                    </StatusBadge>
                    {participant.participant.trainee_code &&
                    participant.participant.trainee_name ? (
                      <Link
                        href={`/trainees/${encodeURIComponent(
                          participant.participant.trainee_code,
                        )}`}
                        aria-label={`فتح سجل ${participant.participant.trainee_name}`}
                      >
                        <Icon name="chevron" size={15} />
                      </Link>
                    ) : (
                      <span aria-hidden="true" />
                    )}
                  </div>
                ))}
              </div>
            )}
            <Link href="/trainees" className="participant-all-link">
              عرض سجل المتدرّبين <Icon name="arrow" size={15} />
            </Link>
          </aside>
        </div>

        <footer className="cohort-room-nav">
          <button
            className="button button-secondary"
            type="button"
            onClick={() => setActiveStage(stageOrder[activeIndex - 1])}
            disabled={activeIndex === 0}
          >
            المحطة السابقة
          </button>
          <span>التنقل يغيّر العرض فقط ولا يعدّل سجلات الدفعة.</span>
          <button
            className="button button-primary"
            type="button"
            onClick={() => setActiveStage(stageOrder[activeIndex + 1])}
            disabled={activeIndex === stageOrder.length - 1}
          >
            المحطة التالية <Icon name="arrow" size={16} />
          </button>
        </footer>
      </section>
    </AppShell>
  );
}
