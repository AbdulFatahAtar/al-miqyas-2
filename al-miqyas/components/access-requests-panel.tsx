"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "../lib/supabase/client";
import { Icon } from "./icons";
import { StatusBadge } from "./app-shell";

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
});

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
    <section className="access-requests-panel">
      {feedback && (
        <div
          className={`inline-feedback ${
            feedback.tone === "success"
              ? "success-feedback"
              : feedback.tone === "warning"
                ? "warning-feedback"
                : "error-feedback"
          }`}
          role="status"
        >
          <Icon
            name={feedback.tone === "success" ? "check" : "warning"}
            size={18}
          />
          {feedback.message}
        </div>
      )}

      <div className="request-summary-grid">
        <article>
          <span className="request-summary-icon pending">
            <Icon name="clock" size={19} />
          </span>
          <div><small>بانتظار القرار</small><strong>{counts.pending}</strong></div>
        </article>
        <article>
          <span className="request-summary-icon invited">
            <Icon name="mail" size={19} />
          </span>
          <div><small>دعوات مفتوحة</small><strong>{counts.invitations}</strong></div>
        </article>
        <article>
          <span className="request-summary-icon completed">
            <Icon name="check" size={19} />
          </span>
          <div><small>عضويات مفعّلة</small><strong>{counts.completed}</strong></div>
        </article>
        <article>
          <span className="request-summary-icon closed">
            <Icon name="lock" size={19} />
          </span>
          <div><small>طلبات مغلقة</small><strong>{counts.closed}</strong></div>
        </article>
      </div>

      <div className="request-review-toolbar">
        <div className="request-filter-tabs" aria-label="تصفية الطلبات">
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
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {label}<span>{count}</span>
              </button>
            ),
          )}
        </div>
        <label className="request-search">
          <Icon name="search" size={17} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="بحث بالاسم أو البريد أو الرقم"
          />
        </label>
      </div>

      {loadError && (
        <div className="inline-feedback error-feedback">
          <Icon name="warning" size={18} />
          {loadError}
        </div>
      )}

      {isLoading ? (
        <div className="request-review-skeleton">
          <i />
          <i />
          <i />
        </div>
      ) : visibleRequests.length ? (
        <div className="request-review-list">
          {visibleRequests.map((requestRecord) => {
            const status = requestStatus(requestRecord.status);
            const organization = organizationMap.get(requestRecord.org_id);
            const busy = busyRequestId === requestRecord.id;

            return (
              <article className="request-review-card" key={requestRecord.id}>
                <div
                  className="request-applicant-avatar"
                  style={{
                    borderColor: organization?.brand_color,
                    color: organization?.brand_color,
                  }}
                >
                  {requestRecord.full_name.slice(0, 1)}
                </div>

                <div className="request-review-main">
                  <div className="request-review-heading">
                    <div>
                      <h3>{requestRecord.full_name}</h3>
                      <a href={`mailto:${requestRecord.email}`} dir="ltr">
                        {requestRecord.email}
                      </a>
                    </div>
                    <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                  </div>

                  <dl className="request-review-meta">
                    <div>
                      <dt>الجهة</dt>
                      <dd>{organization?.name_ar ?? "جهة غير متاحة"}</dd>
                    </div>
                    <div>
                      <dt>الدور المطلوب</dt>
                      <dd>{roleLabel(requestRecord.requested_role)}</dd>
                    </div>
                    <div>
                      <dt>تاريخ الطلب</dt>
                      <dd>{dateFormatter.format(new Date(requestRecord.submitted_at))}</dd>
                    </div>
                    <div>
                      <dt>المرجع</dt>
                      <dd className="mono" dir="ltr">{requestRecord.reference_code}</dd>
                    </div>
                  </dl>

                  {requestRecord.review_note && (
                    <div className="request-review-note">
                      <strong>ملاحظة المراجعة</strong>
                      <p>{requestRecord.review_note}</p>
                    </div>
                  )}

                  <div className="request-review-actions">
                    {requestRecord.status === "pending" && (
                      <>
                        <button
                          className="button button-primary"
                          type="button"
                          disabled={busy}
                          onClick={() => void approveRequest(requestRecord)}
                        >
                          <Icon name="check" size={16} />
                          {busy ? "جارٍ التنفيذ..." : "موافقة وإرسال دعوة"}
                        </button>
                        <button
                          className="button button-secondary"
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
                          className="button button-primary"
                          type="button"
                          disabled={busy}
                          onClick={() => void resendInvitation(requestRecord)}
                        >
                          <Icon name="mail" size={16} />
                          {busy ? "جارٍ الإرسال..." : "إرسال الدعوة"}
                        </button>
                        <button
                          className="button button-secondary"
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
                          className="button button-secondary"
                          type="button"
                          disabled={busy}
                          onClick={() => void resendInvitation(requestRecord)}
                        >
                          <Icon name="mail" size={16} />
                          {busy ? "جارٍ الإرسال..." : "إعادة إرسال الدعوة"}
                        </button>
                        <button
                          className="button button-quiet-danger"
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
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-state request-empty-state">
          <Icon name="mail" size={27} />
          <h3>لا توجد طلبات في هذه القائمة</h3>
          <p>ستظهر الطلبات الجديدة فور إرسالها من صفحة طلب الوصول.</p>
        </div>
      )}

      {dialog && (
        <div
          className="modal-layer"
          role="presentation"
          onMouseDown={() => {
            if (!busyRequestId) {
              setDialog(null);
            }
          }}
        >
          <section
            className="modal request-decision-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="request-decision-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
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
                className="icon-button"
                type="button"
                aria-label="إغلاق"
                disabled={Boolean(busyRequestId)}
                onClick={() => setDialog(null)}
              >
                <Icon name="close" />
              </button>
            </div>
            <div className="request-decision-body">
              <div className="request-decision-applicant">
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
              <p>
                {dialog.mode === "reject"
                  ? "لن يُنشأ حساب أو عضوية لهذا الطلب."
                  : "سيُلغى رابط الدعوة ولن يستطيع مقدم الطلب تفعيل العضوية من خلاله."}
              </p>
            </div>
            <div className="modal-actions request-decision-actions">
              <button
                className="button button-secondary"
                type="button"
                disabled={Boolean(busyRequestId)}
                onClick={() => setDialog(null)}
              >
                تراجع
              </button>
              <button
                className="button button-quiet-danger"
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
          </section>
        </div>
      )}
    </section>
  );
}
