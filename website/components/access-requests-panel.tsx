"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createSupabaseBrowserClient } from "../lib/supabase/client";
import { Icon } from "./icons";
import { StatusBadge } from "./app-shell";
import { AccessibleDialog } from "./accessible-dialog";
import styles from "./access-requests-panel.module.css";

type AccessRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "invited"
  | "completed"
  | "expired"
  | "cancelled";

type AccessRequestRecord = {
  id: string;
  reference_code: string;
  org_id: string;
  full_name: string;
  email: string;
  requested_role: "trainer" | "viewer";
  status: AccessRequestStatus;
  review_note: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  invited_at: string | null;
  expires_at: string | null;
  completed_at: string | null;
};

type OrganizationOption = {
  id: string;
  name_ar: string;
  brand_color: string;
};

type RequestFilter = "pending" | "invitations" | "completed" | "closed" | "all";

type Feedback = {
  tone: "success" | "warning" | "error";
  message: string;
};

type DecisionDialog = {
  mode: "reject" | "cancel";
  request: AccessRequestRecord;
};

const dateFormatter = new Intl.DateTimeFormat("ar-SA", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Riyadh",
});

const filterOrder: RequestFilter[] = [
  "pending",
  "invitations",
  "completed",
  "closed",
  "all",
];

function requestStatus(status: AccessRequestStatus): {
  label: string;
  tone: "success" | "warning" | "danger" | "muted";
} {
  const values: Record<
    AccessRequestStatus,
    { label: string; tone: "success" | "warning" | "danger" | "muted" }
  > = {
    pending: { label: "بانتظار القرار", tone: "warning" },
    approved: { label: "معتمد · لم تُرسل الدعوة", tone: "warning" },
    invited: { label: "الدعوة مرسلة", tone: "success" },
    completed: { label: "عضوية مفعّلة", tone: "success" },
    rejected: { label: "مرفوض", tone: "danger" },
    expired: { label: "منتهي", tone: "muted" },
    cancelled: { label: "ملغي", tone: "muted" },
  };

  return values[status];
}

function roleLabel(role: AccessRequestRecord["requested_role"]) {
  return role === "trainer" ? "مدرّب" : "مراجع نتائج";
}

function isInFilter(request: AccessRequestRecord, filter: RequestFilter) {
  if (filter === "all") {
    return true;
  }

  if (filter === "pending") {
    return request.status === "pending";
  }

  if (filter === "invitations") {
    return request.status === "approved" || request.status === "invited";
  }

  if (filter === "completed") {
    return request.status === "completed";
  }

  return ["rejected", "expired", "cancelled"].includes(request.status);
}

export function AccessRequestsPanel({
  organizations,
  onPendingCountChange,
}: {
  organizations: OrganizationOption[];
  onPendingCountChange?: (count: number) => void;
}) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [requests, setRequests] = useState<AccessRequestRecord[]>([]);
  const [filter, setFilter] = useState<RequestFilter>("pending");
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [busyRequestId, setBusyRequestId] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [loadError, setLoadError] = useState("");
  const [dialog, setDialog] = useState<DecisionDialog | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const filterRefs = useRef<
    Partial<Record<RequestFilter, HTMLButtonElement | null>>
  >({});

  const loadRequests = useCallback(async () => {
    setIsLoading(true);
    setLoadError("");

    const { data, error } = await supabase
      .from("access_requests")
      .select(
        "id, reference_code, org_id, full_name, email, requested_role, status, review_note, submitted_at, reviewed_at, invited_at, expires_at, completed_at",
      )
      .order("submitted_at", { ascending: false });

    if (error) {
      setLoadError(
        "تعذر تحميل طلبات الانضمام. تأكد من تطبيق مهاجرة نظام الطلبات ومن أن الحساب يملك دور المالك.",
      );
      setRequests([]);
      setIsLoading(false);
      return;
    }

    const loadedRequests = (data ?? []) as AccessRequestRecord[];
    setRequests(loadedRequests);
    onPendingCountChange?.(
      loadedRequests.filter((request) => request.status === "pending").length,
    );
    setIsLoading(false);
  }, [onPendingCountChange, supabase]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  const organizationMap = useMemo(
    () =>
      new Map(
        organizations.map((organization) => [
          organization.id,
          organization,
        ]),
      ),
    [organizations],
  );

  const normalizedSearch = search.trim().toLowerCase();
  const visibleRequests = requests.filter((request) => {
    if (!isInFilter(request, filter)) {
      return false;
    }

    if (!normalizedSearch) {
      return true;
    }

    const organization = organizationMap.get(request.org_id);
    return [
      request.full_name,
      request.email,
      request.reference_code,
      organization?.name_ar,
    ]
      .filter(Boolean)
      .some((value) => value?.toLowerCase().includes(normalizedSearch));
  });

  const counts = {
    pending: requests.filter((request) => request.status === "pending").length,
    invitations: requests.filter((request) =>
      ["approved", "invited"].includes(request.status),
    ).length,
    completed: requests.filter((request) => request.status === "completed")
      .length,
    closed: requests.filter((request) =>
      ["rejected", "expired", "cancelled"].includes(request.status),
    ).length,
  };

  const handleFilterKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentFilter: RequestFilter,
  ) => {
    const currentIndex = filterOrder.indexOf(currentFilter);
    let nextIndex: number | null = null;

    if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex + 1) % filterOrder.length;
    } else if (event.key === "ArrowRight") {
      nextIndex =
        (currentIndex - 1 + filterOrder.length) % filterOrder.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = filterOrder.length - 1;
    }

    if (nextIndex === null) {
      return;
    }

    event.preventDefault();
    const nextFilter = filterOrder[nextIndex];
    setFilter(nextFilter);
    filterRefs.current[nextFilter]?.focus();
  };

  const runAction = async ({
    requestRecord,
    path,
    body,
  }: {
    requestRecord: AccessRequestRecord;
    path: string;
    body?: Record<string, unknown>;
  }) => {
    setBusyRequestId(requestRecord.id);
    setFeedback(null);

    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const payload = (await response.json()) as {
        message?: string;
        status?: string;
        invitationSent?: boolean;
      };

      if (!response.ok && response.status !== 202) {
        setFeedback({
          tone: "error",
          message: payload.message ?? "تعذر تنفيذ العملية.",
        });
        return;
      }

      setFeedback({
        tone:
          payload.status === "approved" || response.status === 202
            ? "warning"
            : "success",
        message: payload.message ?? "تم حفظ العملية.",
      });
      setDialog(null);
      setDecisionNote("");
      await loadRequests();
    } catch {
      setFeedback({
        tone: "error",
        message: "تعذر الاتصال بالخادم. حاول مرة أخرى.",
      });
    } finally {
      setBusyRequestId("");
    }
  };

  const approveRequest = (requestRecord: AccessRequestRecord) =>
    runAction({
      requestRecord,
      path: `/api/access-requests/${requestRecord.id}/review`,
      body: { decision: "approve" },
    });

  const resendInvitation = (requestRecord: AccessRequestRecord) =>
    runAction({
      requestRecord,
      path: `/api/access-requests/${requestRecord.id}/resend`,
    });

  const submitDecision = () => {
    if (!dialog) {
      return;
    }

    if (dialog.mode === "reject") {
      void runAction({
        requestRecord: dialog.request,
        path: `/api/access-requests/${dialog.request.id}/review`,
        body: { decision: "reject", note: decisionNote },
      });
      return;
    }

    void runAction({
      requestRecord: dialog.request,
      path: `/api/access-requests/${dialog.request.id}/cancel`,
      body: { note: decisionNote },
    });
  };

  return (
    <section className={styles.panel} aria-label="طابور قرارات طلبات الانضمام">
      {feedback && (
        <div
          className={`${styles.feedback} ${
            feedback.tone === "success"
              ? styles.feedbackSuccess
              : feedback.tone === "warning"
                ? styles.feedbackWarning
                : styles.feedbackDanger
          }`}
          role={feedback.tone === "error" ? "alert" : "status"}
        >
          <Icon
            name={feedback.tone === "success" ? "check" : "warning"}
            size={18}
          />
          <span>{feedback.message}</span>
        </div>
      )}

      <dl className={styles.summaryRail} aria-label="ملخص طابور القرارات">
        <div>
          <dt><Icon name="clock" size={17} /> بانتظار القرار</dt>
          <dd>{isLoading ? "—" : counts.pending}</dd>
          <small>تحتاج مراجعة بشرية</small>
        </div>
        <div>
          <dt><Icon name="mail" size={17} /> دعوات مفتوحة</dt>
          <dd>{isLoading ? "—" : counts.invitations}</dd>
          <small>معتمدة أو مرسلة</small>
        </div>
        <div>
          <dt><Icon name="check" size={17} /> عضويات مفعّلة</dt>
          <dd>{isLoading ? "—" : counts.completed}</dd>
          <small>اكتملت دورة الوصول</small>
        </div>
        <div>
          <dt><Icon name="lock" size={17} /> طلبات مغلقة</dt>
          <dd>{isLoading ? "—" : counts.closed}</dd>
          <small>مرفوضة أو منتهية أو ملغاة</small>
        </div>
      </dl>

      <div className={styles.toolbar}>
        <div
          className={styles.filterTabs}
          role="tablist"
          aria-label="تصفية طابور الطلبات"
        >
          {([
            ["pending", "الجديدة", counts.pending],
            ["invitations", "الدعوات", counts.invitations],
            ["completed", "المفعّلة", counts.completed],
            ["closed", "المغلقة", counts.closed],
            ["all", "الكل", requests.length],
          ] as Array<[RequestFilter, string, number]>).map(
            ([value, label, count]) => (
              <button
                key={value}
                ref={(node) => {
                  filterRefs.current[value] = node;
                }}
                id={`request-filter-${value}`}
                type="button"
                role="tab"
                aria-selected={filter === value}
                aria-controls="requests-queue-panel"
                tabIndex={filter === value ? 0 : -1}
                onClick={() => setFilter(value)}
                onKeyDown={(event) => handleFilterKeyDown(event, value)}
              >
                <span>{label}</span><strong>{isLoading ? "—" : count}</strong>
              </button>
            ),
          )}
        </div>
        <label className={styles.searchField}>
          <span>البحث في الطابور</span>
          <div>
            <Icon name="search" size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="الاسم أو البريد أو الرقم المرجعي"
              autoComplete="off"
            />
          </div>
        </label>
      </div>

      {loadError && (
        <div className={styles.loadError} role="alert">
          <Icon name="warning" size={18} />
          <span>{loadError}</span>
          <button type="button" onClick={() => void loadRequests()}>
            إعادة المحاولة
          </button>
        </div>
      )}

      <div
        className={styles.queuePanel}
        id="requests-queue-panel"
        role="tabpanel"
        aria-labelledby={`request-filter-${filter}`}
        tabIndex={0}
      >
      {isLoading ? (
        <div className={styles.loadingState} aria-live="polite">
          <span className={styles.loadingLine} />
          <span>جارٍ ترتيب الطلبات حسب حالة القرار…</span>
        </div>
      ) : visibleRequests.length ? (
        <ol
          className={styles.requestQueue}
        >
          {visibleRequests.map((requestRecord, index) => {
            const status = requestStatus(requestRecord.status);
            const organization = organizationMap.get(requestRecord.org_id);
            const busy = busyRequestId === requestRecord.id;

            return (
              <li className={styles.requestRecord} key={requestRecord.id}>
                <span className={styles.recordNumber} aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>

                <div className={styles.requestIdentity}>
                  <div className={styles.sourceStamp}>
                    <Icon name="source" size={15} />
                    <code dir="ltr">{requestRecord.reference_code}</code>
                  </div>
                  <h3>{requestRecord.full_name}</h3>
                  <a href={`mailto:${requestRecord.email}`} dir="ltr">
                    {requestRecord.email}
                  </a>
                </div>

                <dl className={styles.requestFacts}>
                  <div>
                    <dt>الجهة المطلوبة</dt>
                    <dd>{organization?.name_ar ?? "جهة غير متاحة"}</dd>
                  </div>
                  <div>
                    <dt>الدور المطلوب</dt>
                    <dd>{roleLabel(requestRecord.requested_role)}</dd>
                  </div>
                  <div>
                    <dt>تاريخ التقديم</dt>
                    <dd>{dateFormatter.format(new Date(requestRecord.submitted_at))}</dd>
                  </div>
                </dl>

                <div className={styles.decisionState}>
                  <small>قرار الوصول</small>
                  <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                  <span>
                    {requestRecord.status === "pending"
                      ? "لم يصدر قرار بعد"
                      : requestRecord.status === "completed"
                        ? "اكتملت العضوية"
                        : "الحالة مسجلة في سجل الطلب"}
                  </span>
                </div>

                <div className={styles.lifecycle} aria-label="سلسلة دليل الطلب">
                  <span>
                    <i>01</i>
                    <small>قُدّم</small>
                    <strong>{dateFormatter.format(new Date(requestRecord.submitted_at))}</strong>
                  </span>
                  {requestRecord.reviewed_at && (
                    <span>
                      <i>02</i>
                      <small>رُوجع</small>
                      <strong>{dateFormatter.format(new Date(requestRecord.reviewed_at))}</strong>
                    </span>
                  )}
                  {requestRecord.invited_at && (
                    <span>
                      <i>03</i>
                      <small>أُرسلت الدعوة</small>
                      <strong>{dateFormatter.format(new Date(requestRecord.invited_at))}</strong>
                    </span>
                  )}
                  {requestRecord.completed_at && (
                    <span>
                      <i>04</i>
                      <small>اكتملت</small>
                      <strong>{dateFormatter.format(new Date(requestRecord.completed_at))}</strong>
                    </span>
                  )}
                </div>

                {requestRecord.review_note && (
                  <div className={styles.reviewNote}>
                    <strong>ملاحظة المراجعة</strong>
                    <p>{requestRecord.review_note}</p>
                  </div>
                )}

                <details className={styles.mobileDisclosure}>
                  <summary>تفاصيل دورة القرار</summary>
                  <dl>
                    <div>
                      <dt>الجهة</dt>
                      <dd>{organization?.name_ar ?? "جهة غير متاحة"}</dd>
                    </div>
                    <div>
                      <dt>الدور المطلوب</dt>
                      <dd>{roleLabel(requestRecord.requested_role)}</dd>
                    </div>
                    <div>
                      <dt>التقديم</dt>
                      <dd>{dateFormatter.format(new Date(requestRecord.submitted_at))}</dd>
                    </div>
                    {requestRecord.reviewed_at && <div><dt>المراجعة</dt><dd>{dateFormatter.format(new Date(requestRecord.reviewed_at))}</dd></div>}
                    {requestRecord.invited_at && <div><dt>الدعوة</dt><dd>{dateFormatter.format(new Date(requestRecord.invited_at))}</dd></div>}
                    {requestRecord.expires_at && <div><dt>انتهاء الدعوة</dt><dd>{dateFormatter.format(new Date(requestRecord.expires_at))}</dd></div>}
                  </dl>
                  {requestRecord.review_note && <p>{requestRecord.review_note}</p>}
                </details>

                <div className={styles.requestActions}>
                    {requestRecord.status === "pending" && (
                      <>
                        <button
                          className={styles.primaryAction}
                          type="button"
                          disabled={busy}
                          onClick={() => void approveRequest(requestRecord)}
                        >
                          <Icon name="check" size={16} />
                          {busy ? "جارٍ التنفيذ..." : "موافقة وإرسال دعوة"}
                        </button>
                        <button
                          className={styles.secondaryAction}
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setDecisionNote("");
                            setDialog({ mode: "reject", request: requestRecord });
                          }}
                        >
                          رفض الطلب
                        </button>
                      </>
                    )}

                    {requestRecord.status === "approved" && (
                      <>
                        <button
                          className={styles.primaryAction}
                          type="button"
                          disabled={busy}
                          onClick={() => void resendInvitation(requestRecord)}
                        >
                          <Icon name="mail" size={16} />
                          {busy ? "جارٍ الإرسال..." : "إرسال الدعوة"}
                        </button>
                        <button
                          className={styles.secondaryAction}
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setDecisionNote("");
                            setDialog({ mode: "cancel", request: requestRecord });
                          }}
                        >
                          إلغاء الاعتماد
                        </button>
                      </>
                    )}

                    {requestRecord.status === "invited" && (
                      <>
                        <button
                          className={styles.secondaryAction}
                          type="button"
                          disabled={busy}
                          onClick={() => void resendInvitation(requestRecord)}
                        >
                          <Icon name="mail" size={16} />
                          {busy ? "جارٍ الإرسال..." : "إعادة إرسال الدعوة"}
                        </button>
                        <button
                          className={styles.dangerAction}
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setDecisionNote("");
                            setDialog({ mode: "cancel", request: requestRecord });
                          }}
                        >
                          إلغاء الدعوة
                        </button>
                      </>
                    )}
                  </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <div
          className={styles.emptyState}
        >
          <Icon name="mail" size={27} />
          <div>
            <h3>{requests.length ? "لا توجد نتيجة مطابقة" : "طابور الطلبات خالٍ"}</h3>
            <p>
              {requests.length
                ? "غيّر البحث أو قسم الحالة؛ لم تُحذف أي طلبات."
                : "لم يرجع سجل الوصول أي طلب قابل للعرض ضمن نطاقك."}
            </p>
          </div>
        </div>
      )}
      </div>

      {dialog && (
        <AccessibleDialog
          labelledBy="request-decision-title"
          describedBy="request-decision-description"
          onClose={() => setDialog(null)}
          className={styles.decisionDialog}
          disableClose={Boolean(busyRequestId)}
        >
            <div className={styles.dialogHead}>
              <div>
                <small>
                  {dialog.request.reference_code}
                </small>
                <h2 id="request-decision-title">
                  {dialog.mode === "reject"
                    ? "رفض طلب الانضمام"
                    : "إلغاء الدعوة"}
                </h2>
              </div>
              <button
                className={styles.iconButton}
                type="button"
                aria-label="إغلاق"
                disabled={Boolean(busyRequestId)}
                onClick={() => setDialog(null)}
              >
                <Icon name="close" />
              </button>
            </div>
            <div className={styles.dialogBody}>
              <div className={styles.dialogApplicant}>
                <span>{dialog.request.full_name.slice(0, 1)}</span>
                <div>
                  <strong>{dialog.request.full_name}</strong>
                  <small dir="ltr">{dialog.request.email}</small>
                </div>
              </div>
              <label>
                {dialog.mode === "reject"
                  ? "سبب الرفض"
                  : "ملاحظة الإلغاء"}
                <textarea
                  required={dialog.mode === "reject"}
                  minLength={dialog.mode === "reject" ? 3 : undefined}
                  maxLength={1000}
                  rows={4}
                  value={decisionNote}
                  onChange={(event) => setDecisionNote(event.target.value)}
                  placeholder={
                    dialog.mode === "reject"
                      ? "اكتب سببًا واضحًا يمكن الرجوع إليه..."
                      : "اختياري: اكتب سبب إلغاء الدعوة..."
                  }
                />
              </label>
              <p id="request-decision-description">
                {dialog.mode === "reject"
                  ? "لن يُنشأ حساب أو عضوية لهذا الطلب."
                  : "سيُلغى رابط الدعوة ولن يستطيع مقدم الطلب تفعيل العضوية من خلاله."}
              </p>
            </div>
            <div className={styles.dialogActions}>
              <button
                className={styles.secondaryAction}
                type="button"
                disabled={Boolean(busyRequestId)}
                onClick={() => setDialog(null)}
              >
                تراجع
              </button>
              <button
                className={styles.dangerAction}
                type="button"
                disabled={
                  Boolean(busyRequestId) ||
                  (dialog.mode === "reject" && decisionNote.trim().length < 3)
                }
                onClick={submitDecision}
              >
                {busyRequestId
                  ? "جارٍ الحفظ..."
                  : dialog.mode === "reject"
                    ? "تأكيد الرفض"
                    : "تأكيد الإلغاء"}
              </button>
            </div>
        </AccessibleDialog>
      )}
    </section>
  );
}
