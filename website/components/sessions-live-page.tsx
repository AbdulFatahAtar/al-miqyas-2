"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell, StatusBadge } from "./app-shell";
import { Icon } from "./icons";
import { createSupabaseBrowserClient } from "../lib/supabase/client";
import {
  isXapiTestEvent,
  shortSessionId,
  type XapiDisplayRecord,
  xapiObjectLabel,
  xapiResultLabel,
  xapiVerbLabel,
} from "../lib/xapi-display";
import styles from "./sessions-live-page.module.css";

type EnrollmentLookup = {
  id: string;
  trainee_id: string;
  cohort_id: string;
};

type TraineeLookup = {
  id: string;
  code: string;
  full_name: string;
};

type ProgramLookup = {
  id: string;
  title_ar: string;
};

type SessionView = {
  id: string;
  traineeCode: string;
  traineeName: string;
  programTitle: string;
  events: XapiDisplayRecord[];
  performanceEventCount: number;
  testEventCount: number;
  unmatchedCount: number;
  latestAt: string;
};

function sessionStatus(session: SessionView) {
  if (session.unmatchedCount > 0) {
    return { label: "تحتاج مطابقة", tone: "warning" as const };
  }
  if (session.performanceEventCount === 0 && session.testEventCount > 0) {
    return { label: "اختبار تقني", tone: "system" as const };
  }
  return { label: "مقبولة", tone: "success" as const };
}

function eventStatus(event: XapiDisplayRecord) {
  if (event.processing_status === "unmatched") {
    return { label: "غير مطابق", tone: "warning" as const };
  }
  if (isXapiTestEvent(event)) {
    return { label: "اختبار", tone: "system" as const };
  }
  return { label: "مقبول", tone: "success" as const };
}

function formatEventTime(value: string) {
  return new Intl.DateTimeFormat("ar-SA", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatSessionTime(value: string) {
  return new Intl.DateTimeFormat("ar-SA", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export function SessionsLivePage({ organizationId }: { organizationId: string }) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const loadRequestId = useRef(0);

  const loadSessions = useCallback(
    async (showLoading = false) => {
      const requestId = ++loadRequestId.current;
      if (showLoading) {
        setIsLoading(true);
      }
      setErrorMessage("");

      const { data: eventRows, error: eventsError } = await supabase
        .from("xapi_statements")
        .select(
          "id, statement_id, enrollment_id, trainee_code_received, program_id, session_id, verb_id, object_id, result, context, processing_status, rejection_reason, occurred_at, received_at",
        )
        .eq("org_id", organizationId)
        .in("processing_status", ["accepted", "unmatched"])
        .order("occurred_at", { ascending: false })
        .limit(300);

      if (eventsError) {
        if (requestId === loadRequestId.current) {
          setErrorMessage("تعذر تحميل سجل أحداث xAPI. ستبقى آخر نسخة ناجحة ظاهرة إن وجدت.");
          setIsLoading(false);
        }
        return;
      }

      const events = (eventRows ?? []) as XapiDisplayRecord[];
      const enrollmentIds = Array.from(
        new Set(
          events
            .map((event) => event.enrollment_id)
            .filter((value): value is string => Boolean(value)),
        ),
      );
      const programIds = Array.from(new Set(events.map((event) => event.program_id)));

      const [{ data: enrollmentRows }, { data: programRows }] = await Promise.all([
        enrollmentIds.length > 0
          ? supabase
              .from("enrollments")
              .select("id, trainee_id, cohort_id")
              .eq("org_id", organizationId)
              .in("id", enrollmentIds)
          : Promise.resolve({ data: [] as EnrollmentLookup[] }),
        programIds.length > 0
          ? supabase
              .from("programs")
              .select("id, title_ar")
              .eq("org_id", organizationId)
              .in("id", programIds)
          : Promise.resolve({ data: [] as ProgramLookup[] }),
      ]);

      const enrollments = (enrollmentRows ?? []) as EnrollmentLookup[];
      const traineeIds = Array.from(
        new Set(enrollments.map((enrollment) => enrollment.trainee_id)),
      );
      const { data: traineeRows } =
        traineeIds.length > 0
          ? await supabase
              .from("trainees")
              .select("id, code, full_name")
              .eq("org_id", organizationId)
              .in("id", traineeIds)
          : { data: [] as TraineeLookup[] };
      const trainees = (traineeRows ?? []) as TraineeLookup[];
      const programs = (programRows ?? []) as ProgramLookup[];
      const grouped = new Map<string, XapiDisplayRecord[]>();

      for (const event of events) {
        const existing = grouped.get(event.session_id) ?? [];
        existing.push(event);
        grouped.set(event.session_id, existing);
      }

      const nextSessions = Array.from(grouped.entries())
        .map(([sessionId, sessionEvents]) => {
          const firstEvent = sessionEvents[0];
          const enrollment = enrollments.find(
            (item) => item.id === firstEvent.enrollment_id,
          );
          const trainee = trainees.find(
            (item) => item.id === enrollment?.trainee_id,
          );
          const program = programs.find(
            (item) => item.id === firstEvent.program_id,
          );

          return {
            id: sessionId,
            traineeCode: firstEvent.trainee_code_received,
            traineeName: trainee?.full_name ?? "غير مطابق",
            programTitle: program?.title_ar ?? "برنامج غير معروف",
            events: sessionEvents,
            performanceEventCount: sessionEvents.filter(
              (event) =>
                event.processing_status === "accepted" && !isXapiTestEvent(event),
            ).length,
            testEventCount: sessionEvents.filter(isXapiTestEvent).length,
            unmatchedCount: sessionEvents.filter(
              (event) => event.processing_status === "unmatched",
            ).length,
            latestAt: firstEvent.occurred_at,
          };
        })
        .sort(
          (left, right) =>
            new Date(right.latestAt).valueOf() - new Date(left.latestAt).valueOf(),
        );

      if (requestId !== loadRequestId.current) {
        return;
      }

      setSessions(nextSessions);
      setSelectedSessionId((current) =>
        nextSessions.some((session) => session.id === current)
          ? current
          : (nextSessions[0]?.id ?? ""),
      );
      setLastRefreshedAt(new Date());
      setIsLoading(false);
    },
    [organizationId, supabase],
  );

  useEffect(() => {
    void loadSessions(true);
    const intervalId = window.setInterval(() => {
      void loadSessions();
    }, 10_000);

    return () => {
      window.clearInterval(intervalId);
      loadRequestId.current += 1;
    };
  }, [loadSessions]);

  async function refreshNow() {
    setIsRefreshing(true);
    await loadSessions();
    setIsRefreshing(false);
  }

  const selectedSession =
    sessions.find((session) => session.id === selectedSessionId) ?? null;
  const performanceEventTotal = sessions.reduce(
    (total, session) => total + session.performanceEventCount,
    0,
  );
  const testEventTotal = sessions.reduce(
    (total, session) => total + session.testEventCount,
    0,
  );
  const unmatchedTotal = sessions.reduce(
    (total, session) => total + session.unmatchedCount,
    0,
  );

  return (
    <AppShell title="الجلسات الحية">
      <header className={styles.pageIntro}>
        <div className={styles.pageIdentity}>
          <span className={styles.pageIndex} aria-hidden="true">04</span>
          <div>
            <p>سجل التشغيل اللحظي</p>
            <h1>الجلسات الحية</h1>
            <span>
              كل جلسة تسلسل أحداث مستلم من AmadXR، مع حالة المطابقة ووقت المصدر.
            </span>
          </div>
        </div>
        <div className={styles.liveControl}>
          <div aria-live="polite">
            <span className={errorMessage ? styles.signalError : styles.signalLive} aria-hidden="true" />
            <div>
              <strong>{errorMessage ? "تعذر آخر تحديث" : "تحديث تلقائي نشط"}</strong>
              <small>
                {lastRefreshedAt
                  ? `آخر قراءة ${formatSessionTime(lastRefreshedAt.toISOString())}`
                  : "بانتظار القراءة الأولى"}
              </small>
            </div>
          </div>
          <button type="button" onClick={() => void refreshNow()} disabled={isRefreshing}>
            <Icon name="clock" size={16} />
            {isRefreshing ? "جارٍ التحديث..." : "تحديث الآن"}
          </button>
        </div>
      </header>

      <dl className={styles.operationLedger} aria-label="ملخص آخر 300 حدث مستلم">
        <OperationMetric
          index="01"
          label="الجلسات"
          value={sessions.length}
          detail="ضمن نافذة القراءة الحالية"
        />
        <OperationMetric
          index="02"
          label="أحداث الأداء"
          value={performanceEventTotal}
          detail="بعد استبعاد الاختبارات"
          tone="success"
        />
        <OperationMetric
          index="03"
          label="اختبارات الاتصال"
          value={testEventTotal}
          detail="لا تدخل في حساب الأثر"
          tone="system"
        />
        <OperationMetric
          index="04"
          label="أحداث غير مطابقة"
          value={unmatchedTotal}
          detail="تحتاج ربطًا أو تصحيحًا"
          tone="warning"
        />
      </dl>

      {errorMessage && (
        <p className={styles.errorNotice} role="alert">
          <Icon name="warning" size={18} />
          {errorMessage}
        </p>
      )}

      {isLoading ? (
        <section className={styles.statePanel} role="status" aria-live="polite">
          <span>04</span>
          <div>
            <h2>جارٍ فتح سجل التشغيل</h2>
            <p>تُجمع الأحداث وتُرتب حسب معرّف الجلسة.</p>
          </div>
        </section>
      ) : sessions.length === 0 ? (
        <section className={styles.statePanel}>
          <span>—</span>
          <div>
            <h2>لم يصل أي سجل جلسة</h2>
            <p>ستظهر أول جلسة بعد قبول Statement صحيح من نقطة استقبال xAPI.</p>
          </div>
        </section>
      ) : (
        <div className={styles.sessionWorkspace}>
          <nav className={styles.sessionIndex} aria-label="فهرس الجلسات المستلمة">
            <header>
              <div>
                <span>فهرس التشغيل</span>
                <h2>الجلسات</h2>
              </div>
              <small>الأحدث أولًا</small>
            </header>
            <ol>
              {sessions.map((session, index) => {
                const status = sessionStatus(session);
                const isSelected = selectedSessionId === session.id;

                return (
                  <li key={session.id}>
                    <button
                      type="button"
                      className={isSelected ? styles.selectedSession : undefined}
                      aria-pressed={isSelected}
                      onClick={() => setSelectedSessionId(session.id)}
                    >
                      <span className={styles.sessionNumber}>
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className={styles.sessionIdentity}>
                        <strong dir="ltr">{shortSessionId(session.id)}</strong>
                        <small dir="ltr">{session.traineeCode}</small>
                      </span>
                      <span className={styles.sessionMeta}>
                        <b className={styles[`status_${status.tone}`]}>{status.label}</b>
                        <time dateTime={session.latestAt}>{formatEventTime(session.latestAt)}</time>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          {selectedSession && <SessionRecord session={selectedSession} refreshedAt={lastRefreshedAt} />}
        </div>
      )}
    </AppShell>
  );
}

function OperationMetric({
  index,
  label,
  value,
  detail,
  tone = "default",
}: {
  index: string;
  label: string;
  value: number;
  detail: string;
  tone?: "default" | "success" | "system" | "warning";
}) {
  return (
    <div className={styles[`metric_${tone}`]}>
      <dt><span>{index}</span><b>{label}</b></dt>
      <dd>{new Intl.NumberFormat("ar-SA").format(value)}</dd>
      <dd className={styles.metricDetail}>{detail}</dd>
    </div>
  );
}

function SessionRecord({
  session,
  refreshedAt,
}: {
  session: SessionView;
  refreshedAt: Date | null;
}) {
  const status = sessionStatus(session);
  const chronologicalEvents = [...session.events].reverse();

  return (
    <article className={styles.sessionRecord} aria-labelledby="selected-session-title">
      <header className={styles.recordHeader}>
        <div>
          <span>سجل جلسة مستلمة</span>
          <h2 id="selected-session-title" dir="ltr">{shortSessionId(session.id)}</h2>
          <p dir="ltr">{session.id}</p>
        </div>
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
      </header>

      <dl className={styles.sessionFacts}>
        <div>
          <dt>المتدرّب</dt>
          <dd>{session.traineeName}</dd>
          <dd>
            <Link href={`/trainees/${session.traineeCode}`} dir="ltr">
              {session.traineeCode}
              <span className={styles.forwardIcon}><Icon name="arrow" size={13} /></span>
            </Link>
          </dd>
        </div>
        <div>
          <dt>البرنامج</dt>
          <dd>{session.programTitle}</dd>
          <dd>{session.performanceEventCount} أحداث أداء</dd>
        </div>
        <div>
          <dt>آخر حدث بالمصدر</dt>
          <dd><time dateTime={session.latestAt}>{formatSessionTime(session.latestAt)}</time></dd>
          <dd>{session.events.length} أحداث في السجل</dd>
        </div>
      </dl>

      <section className={styles.eventRegister} aria-labelledby="event-register-title">
        <header>
          <div>
            <span>Evidence Rail · xAPI</span>
            <h3 id="event-register-title">تتابع الأحداث</h3>
          </div>
          <p>
            آخر تحديث للعرض: {refreshedAt ? formatSessionTime(refreshedAt.toISOString()) : "—"}
          </p>
        </header>
        <ol>
          {chronologicalEvents.map((event, index) => {
            const statusMeta = eventStatus(event);
            return (
              <li key={event.id} className={styles[`event_${statusMeta.tone}`]}>
                <span className={styles.eventSequence}>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className={styles.eventRail} aria-hidden="true"><i /></span>
                <details className={styles.eventDisclosure}>
                  <summary>
                    <time dateTime={event.occurred_at}>{formatEventTime(event.occurred_at)}</time>
                    <div>
                      <strong>{xapiVerbLabel(event.verb_id)}</strong>
                      <small>{xapiObjectLabel(event)}</small>
                    </div>
                    <span className={styles.eventResult}>{xapiResultLabel(event)}</span>
                    <StatusBadge tone={statusMeta.tone}>{statusMeta.label}</StatusBadge>
                  </summary>
                  <dl>
                    <div>
                      <dt>Statement ID</dt>
                      <dd dir="ltr">{event.statement_id}</dd>
                    </div>
                    <div>
                      <dt>وقت المصدر</dt>
                      <dd><time dateTime={event.occurred_at}>{formatSessionTime(event.occurred_at)}</time></dd>
                    </div>
                    <div>
                      <dt>وقت الاستقبال</dt>
                      <dd><time dateTime={event.received_at}>{formatSessionTime(event.received_at)}</time></dd>
                    </div>
                    {event.rejection_reason && (
                      <div>
                        <dt>سبب عدم المطابقة</dt>
                        <dd>{event.rejection_reason}</dd>
                      </div>
                    )}
                  </dl>
                </details>
              </li>
            );
          })}
        </ol>
      </section>
    </article>
  );
}
