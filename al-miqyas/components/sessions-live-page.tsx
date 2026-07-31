"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell, PageHeader, StatusBadge } from "./app-shell";
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
    return {
      label: "تحتاج مطابقة",
      tone: "warning" as const,
    };
  }

  if (session.performanceEventCount === 0 && session.testEventCount > 0) {
    return {
      label: "اختبار تقني",
      tone: "system" as const,
    };
  }

  return {
    label: "مقبولة",
    tone: "success" as const,
  };
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

export function SessionsLivePage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(
    null,
  );

  const loadSessions = useCallback(
    async (showLoading = false) => {
      if (showLoading) {
        setIsLoading(true);
      }
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

      const { data: eventRows, error: eventsError } = await supabase
        .from("xapi_statements")
        .select(
          "id, statement_id, enrollment_id, trainee_code_received, program_id, session_id, verb_id, object_id, result, context, raw_statement, processing_status, rejection_reason, occurred_at, received_at",
        )
        .eq("org_id", membership.org_id)
        .in("processing_status", ["accepted", "unmatched"])
        .order("occurred_at", { ascending: false })
        .limit(300);

      if (eventsError) {
        setErrorMessage("تعذر تحميل أحداث xAPI.");
        setIsLoading(false);
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
      const programIds = Array.from(
        new Set(events.map((event) => event.program_id)),
      );

      const [{ data: enrollmentRows }, { data: programRows }] =
        await Promise.all([
          enrollmentIds.length > 0
            ? supabase
                .from("enrollments")
                .select("id, trainee_id, cohort_id")
                .eq("org_id", membership.org_id)
                .in("id", enrollmentIds)
            : Promise.resolve({ data: [] as EnrollmentLookup[] }),
          programIds.length > 0
            ? supabase
                .from("programs")
                .select("id, title_ar")
                .eq("org_id", membership.org_id)
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
              .eq("org_id", membership.org_id)
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
                event.processing_status === "accepted" &&
                !isXapiTestEvent(event),
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
            new Date(right.latestAt).valueOf() -
            new Date(left.latestAt).valueOf(),
        );

      setSessions(nextSessions);
      setSelectedSessionId((current) =>
        nextSessions.some((session) => session.id === current)
          ? current
          : (nextSessions[0]?.id ?? ""),
      );
      setLastRefreshedAt(new Date());
      setIsLoading(false);
    },
    [supabase],
  );

  useEffect(() => {
    void loadSessions(true);
    const intervalId = window.setInterval(() => {
      void loadSessions();
    }, 10_000);

    return () => window.clearInterval(intervalId);
  }, [loadSessions]);

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
      <PageHeader
        eyebrow="AmadXR · xAPI"
        title="الجلسات الحية"
        description="عرض الأحداث المستلمة فعليًا وربطها بالمتدرّب والبرنامج والجلسة."
        actions={
          <StatusBadge tone={errorMessage ? "danger" : "system"}>
            تحديث تلقائي كل 10 ثوانٍ
          </StatusBadge>
        }
      />

      <section className="metric-strip compact xapi-session-metrics">
        <div className="metric-block">
          <span>الجلسات المستلمة</span>
          <strong>{sessions.length}</strong>
          <small>من قاعدة البيانات</small>
        </div>
        <div className="metric-block metric-block-success">
          <span>أحداث الأداء</span>
          <strong>{performanceEventTotal}</strong>
          <small>لا تشمل الاختبارات التقنية</small>
        </div>
        <div className="metric-block">
          <span>اختبارات الاتصال</span>
          <strong>{testEventTotal}</strong>
          <small>مستبعدة من الأثر</small>
        </div>
        <div className="metric-block metric-block-warning">
          <span>غير مطابقة</span>
          <strong>{unmatchedTotal}</strong>
          <small>تحتاج معالجة</small>
        </div>
      </section>

      {errorMessage && (
        <div className="inline-feedback danger-feedback">
          <Icon name="warning" size={17} />
          {errorMessage}
        </div>
      )}

      {isLoading ? (
        <section className="content-section loading-state">
          جارٍ تحميل جلسات xAPI...
        </section>
      ) : sessions.length === 0 ? (
        <section className="content-section empty-state">
          <Icon name="sessions" size={30} />
          <h2>لا توجد جلسات مستلمة</h2>
          <p>ستظهر هنا أول جلسة فور وصول Statement صحيح.</p>
        </section>
      ) : (
        <div className="sessions-layout">
          <aside className="session-list" aria-label="قائمة الجلسات">
            {sessions.map((session) => {
              const status = sessionStatus(session);

              return (
                <button
                  key={session.id}
                  className={
                    selectedSessionId === session.id ? "selected" : ""
                  }
                  onClick={() => setSelectedSessionId(session.id)}
                >
                  <span
                    className={`status-pin ${
                      status.tone === "success"
                        ? "success"
                        : status.tone === "warning"
                          ? "warning"
                          : "system"
                    }`}
                  />
                  <span>
                    <strong dir="ltr">
                      {shortSessionId(session.id)}
                    </strong>
                    <small>
                      {session.traineeCode} · {session.events.length} أحداث
                    </small>
                  </span>
                  <span className="mono">
                    {formatEventTime(session.latestAt)}
                  </span>
                </button>
              );
            })}
          </aside>

          {selectedSession && (
            <section className="content-section live-session">
              <div className="section-title">
                <div>
                  <span className="eyebrow">جلسة مستلمة</span>
                  <h2 dir="ltr">
                    {shortSessionId(selectedSession.id)}
                  </h2>
                </div>
                <StatusBadge tone={sessionStatus(selectedSession).tone}>
                  {sessionStatus(selectedSession).label}
                </StatusBadge>
              </div>

              <div className="xapi-session-facts">
                <div>
                  <span>المتدرّب</span>
                  <strong>{selectedSession.traineeName}</strong>
                  <Link
                    href={`/trainees/${selectedSession.traineeCode}`}
                    dir="ltr"
                  >
                    {selectedSession.traineeCode}
                  </Link>
                </div>
                <div>
                  <span>البرنامج</span>
                  <strong>{selectedSession.programTitle}</strong>
                </div>
                <div>
                  <span>آخر حدث</span>
                  <strong>
                    {formatSessionTime(selectedSession.latestAt)}
                  </strong>
                </div>
              </div>

              <div className="event-stream">
                <div className="event-stream-head">
                  <span>الوقت</span>
                  <span>الفعل</span>
                  <span>الكائن</span>
                  <span>النتيجة</span>
                </div>
                {selectedSession.events.map((event) => (
                  <div className="event-stream-row" key={event.id}>
                    <span className="mono">
                      {formatEventTime(event.occurred_at)}
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

              <div className="xapi-refresh-note">
                <Icon name="clock" size={15} />
                آخر تحديث:{" "}
                {lastRefreshedAt
                  ? formatSessionTime(lastRefreshedAt.toISOString())
                  : "—"}
              </div>
            </section>
          )}
        </div>
      )}
    </AppShell>
  );
}

