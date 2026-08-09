"use client";

import { useMemo, useState, type FormEvent } from "react";
import { createSupabaseBrowserClient } from "../lib/supabase/client";
import { Icon } from "./icons";
import { StatusBadge } from "./app-shell";
import styles from "../app/platform/platform.module.css";

export type PlatformAuditEventRecord = {
  id: number;
  org_id: string | null;
  actor_user_id: string | null;
  actor_role: string | null;
  actor_scope: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  request_id: string | null;
  outcome: "success" | "denied" | "failure" | "partial";
  severity: "info" | "notice" | "warning" | "critical";
  reason: string | null;
  created_at: string;
  created_at_label: string;
  total_count: number;
};

type FilterValues = {
  search: string;
  actorUserId: string;
  organizationId: string;
  action: string;
  entityType: string;
  outcome: string;
  severity: string;
  createdFrom: string;
  createdUntil: string;
};

const emptyFilters: FilterValues = {
  search: "",
  actorUserId: "",
  organizationId: "",
  action: "",
  entityType: "",
  outcome: "",
  severity: "",
  createdFrom: "",
  createdUntil: "",
};

const pageSize = 20;

const dateFormatter = new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Riyadh",
});

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "غير متاح" : dateFormatter.format(date);
}

function shortId(value: string | null) {
  if (!value) return "النظام";
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function toTimestamp(value: string, endOfDay = false) {
  if (!value) return null;
  return new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+03:00`).toISOString();
}

function eventTone(event: PlatformAuditEventRecord) {
  if (event.outcome === "failure" || event.outcome === "denied" || event.severity === "critical") return "danger" as const;
  if (event.outcome === "partial" || event.severity === "warning" || event.severity === "notice") return "warning" as const;
  return "success" as const;
}

export function PlatformAuditLog({
  initialEvents,
  organizations,
  users,
  currentAccountLabel,
}: {
  initialEvents: PlatformAuditEventRecord[];
  organizations: Array<{ id: string; name: string }>;
  users: Array<{ id: string; label: string }>;
  currentAccountLabel: string;
}) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [events, setEvents] = useState(initialEvents);
  const [filters, setFilters] = useState<FilterValues>(emptyFilters);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(initialEvents[0]?.total_count ?? initialEvents.length);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadPage(nextPage: number, values = filters) {
    setIsLoading(true);
    setError("");

    const { data, error: queryError } = await supabase.rpc(
      "list_platform_audit_events",
      {
        search_filter: values.search.trim() || null,
        actor_user_filter: values.actorUserId || null,
        organization_filter: values.organizationId || null,
        action_filter: values.action.trim() || null,
        entity_type_filter: values.entityType.trim() || null,
        outcome_filter: values.outcome || null,
        severity_filter: values.severity || null,
        created_from: toTimestamp(values.createdFrom),
        created_until: toTimestamp(values.createdUntil, true),
        page_size: pageSize,
        page_offset: nextPage * pageSize,
      },
    );

    if (queryError) {
      setError("تعذر تحميل سجل التدقيق المصفّى. تأكد من تطبيق Migration 031 وصلاحية الحساب.");
      setIsLoading(false);
      return;
    }

    const rows = ((data ?? []) as Array<
      Omit<PlatformAuditEventRecord, "created_at_label">
    >).map((row) => ({
      ...row,
      created_at_label: formatDate(row.created_at),
    }));
    setEvents(rows);
    setTotal(rows[0]?.total_count ?? (nextPage === 0 ? rows.length : total));
    setPage(nextPage);
    setIsLoading(false);
  }

  function submitFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadPage(0);
  }

  function resetFilters() {
    setFilters(emptyFilters);
    void loadPage(0, emptyFilters);
  }

  const organizationNames = new Map(
    organizations.map((organization) => [organization.id, organization.name]),
  );
  const userNames = new Map(users.map((user) => [user.id, user.label]));
  const fromRecord = total === 0 ? 0 : page * pageSize + 1;
  const toRecord = Math.min(total, page * pageSize + events.length);

  return (
    <section className={`${styles.panel} ${styles.sectionGap}`} aria-labelledby="platform-audit-title">
      <div className={styles.panelHeader}>
        <div>
          <span className="eyebrow">أثر إداري محمي</span>
          <h2 id="platform-audit-title">سجل التدقيق</h2>
        </div>
        <span className={styles.identity}>
          الحساب الحالي: <bdi dir="ltr">{currentAccountLabel}</bdi>
        </span>
      </div>

      <form className={styles.auditFilters} onSubmit={submitFilters}>
        <label className={styles.wideFilter}>
          بحث
          <input
            value={filters.search}
            onChange={(event) => setFilters({ ...filters, search: event.target.value })}
            placeholder="إجراء، مورد، سبب، معرّف طلب أو مستخدم"
          />
        </label>
        <label>
          المستخدم
          <select
            value={filters.actorUserId}
            onChange={(event) => setFilters({ ...filters, actorUserId: event.target.value })}
          >
            <option value="">كل المستخدمين</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>{user.label}</option>
            ))}
          </select>
        </label>
        <label>
          الجهة
          <select
            value={filters.organizationId}
            onChange={(event) => setFilters({ ...filters, organizationId: event.target.value })}
          >
            <option value="">كل الجهات والمنصة</option>
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>{organization.name}</option>
            ))}
          </select>
        </label>
        <label>
          الإجراء المطابق
          <input
            value={filters.action}
            onChange={(event) => setFilters({ ...filters, action: event.target.value })}
            dir="ltr"
            placeholder="organization.created"
          />
        </label>
        <label>
          نوع المورد
          <input
            value={filters.entityType}
            onChange={(event) => setFilters({ ...filters, entityType: event.target.value })}
            dir="ltr"
            placeholder="organization"
          />
        </label>
        <label>
          النتيجة
          <select
            value={filters.outcome}
            onChange={(event) => setFilters({ ...filters, outcome: event.target.value })}
          >
            <option value="">كل النتائج</option>
            <option value="success">ناجحة</option>
            <option value="denied">مرفوضة</option>
            <option value="partial">جزئية</option>
            <option value="failure">فاشلة</option>
          </select>
        </label>
        <label>
          الخطورة
          <select
            value={filters.severity}
            onChange={(event) => setFilters({ ...filters, severity: event.target.value })}
          >
            <option value="">كل المستويات</option>
            <option value="info">معلومات</option>
            <option value="notice">ملاحظة</option>
            <option value="warning">تحذير</option>
            <option value="critical">حرج</option>
          </select>
        </label>
        <label>
          من تاريخ
          <input
            type="date"
            value={filters.createdFrom}
            onChange={(event) => setFilters({ ...filters, createdFrom: event.target.value })}
          />
        </label>
        <label>
          إلى تاريخ
          <input
            type="date"
            min={filters.createdFrom || undefined}
            value={filters.createdUntil}
            onChange={(event) => setFilters({ ...filters, createdUntil: event.target.value })}
          />
        </label>
        <div className={styles.filterActions}>
          <button className="button button-primary" type="submit" disabled={isLoading}>
            <Icon name="search" size={16} />
            {isLoading ? "جارٍ البحث..." : "تطبيق التصفية"}
          </button>
          <button className="button button-secondary" type="button" onClick={resetFilters} disabled={isLoading}>
            مسح
          </button>
        </div>
      </form>

      {error && <div className={styles.error} role="alert">{error}</div>}

      {events.length > 0 ? (
        <ol className={styles.auditList} aria-busy={isLoading}>
          {events.map((event) => (
            <li key={event.id}>
              <div className={styles.auditMain}>
                <div className={styles.auditTitleLine}>
                  <strong><bdi dir="ltr">{event.action}</bdi></strong>
                  <StatusBadge tone={eventTone(event)}>
                    {event.outcome === "success" ? "ناجح" : event.outcome === "partial" ? "جزئي" : event.outcome === "denied" ? "مرفوض" : "فاشل"}
                  </StatusBadge>
                </div>
                <span>
                  <bdi dir="ltr">{event.entity_type}</bdi>
                  {event.entity_id ? ` · ${shortId(event.entity_id)}` : ""}
                  {event.reason ? ` · ${event.reason}` : ""}
                </span>
              </div>
              <div className={styles.auditMeta}>
                <span>{event.org_id ? organizationNames.get(event.org_id) ?? shortId(event.org_id) : "المنصة"}</span>
                <span>{event.created_at_label}</span>
                <span>
                  المنفذ: {event.actor_user_id ? userNames.get(event.actor_user_id) ?? shortId(event.actor_user_id) : "النظام"}
                </span>
                <span>{event.actor_role ?? "دور غير محدد"} · {event.severity}</span>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.empty}>لا توجد أحداث تطابق معايير البحث الحالية.</p>
      )}

      <div className={styles.pagination} aria-label="صفحات سجل التدقيق">
        <span>{fromRecord}–{toRecord} من {total}</span>
        <div>
          <button
            className="button button-secondary"
            type="button"
            disabled={isLoading || page === 0}
            onClick={() => void loadPage(page - 1)}
          >
            السابق
          </button>
          <button
            className="button button-secondary"
            type="button"
            disabled={isLoading || (page + 1) * pageSize >= total}
            onClick={() => void loadPage(page + 1)}
          >
            التالي
          </button>
        </div>
      </div>
    </section>
  );
}
