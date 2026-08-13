import type { Metadata } from "next";
import { AppShell, StatusBadge } from "../../components/app-shell";
import { AccessRequestsPanel } from "../../components/access-requests-panel";
import {
  PlatformAuditLog,
  type PlatformAuditEventRecord,
} from "../../components/platform-audit-log";
import { PlatformOrganizationAdmin } from "../../components/platform-organization-admin";
import {
  PlatformUserAdmin,
  type PlatformUserRecord,
} from "../../components/platform-user-admin";
import {
  permissionDefinitions,
  roleLabels,
  roleHasPermission,
  rolePermissionMatrix,
  type RoleKey,
} from "../../lib/auth/permissions";
import { requirePagePermission } from "../../lib/auth/server";
import { normalizeIntlWhitespace } from "../../lib/date-time";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import styles from "./platform.module.css";

export const metadata: Metadata = {
  title: "إدارة المنصة | منظومة المقياس",
  description: "لوحة تشغيل منصة الأمد والجهات والصلاحيات وسجل التدقيق",
};

type OrganizationRow = {
  id: string;
  slug: string;
  name_ar: string;
  name_en: string | null;
  logo_url: string | null;
  brand_color: string;
  status: "active" | "suspended" | "archived";
  created_at: string;
};

type MembershipRow = {
  user_id: string;
  org_id: string;
  role: "owner" | "trainer" | "viewer";
  status: "invited" | "active" | "suspended" | "revoked";
};

type PlatformOwnerRow = {
  user_id: string;
  is_active: boolean;
  granted_at: string;
};

const organizationStatuses: Record<
  OrganizationRow["status"],
  { label: string; tone: "success" | "warning" | "muted" }
> = {
  active: { label: "نشطة", tone: "success" },
  suspended: { label: "معلّقة", tone: "warning" },
  archived: { label: "مؤرشفة", tone: "muted" },
};

const roleOrder: RoleKey[] = [
  "platform_owner",
  "owner",
  "trainer",
  "viewer",
];

const dateFormatter = new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Riyadh",
});

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "غير متاح"
    : normalizeIntlWhitespace(dateFormatter.format(date));
}

function shortId(value: string | null) {
  if (!value) return "النظام";
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

export default async function PlatformPage() {
  const access = await requirePagePermission("platform.dashboard.read", {
    nextPath: "/platform",
  });
  const supabase = await createSupabaseServerClient();

  const [
    organizationsResult,
    membershipsResult,
    ownersResult,
    auditResult,
    usersResult,
  ] =
    await Promise.all([
      supabase
        .from("organizations")
        .select("id, slug, name_ar, name_en, logo_url, brand_color, status, created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("memberships")
        .select("user_id, org_id, role, status")
        .order("created_at", { ascending: false }),
      supabase
        .from("platform_admins")
        .select("user_id, is_active, granted_at")
        .order("granted_at", { ascending: true }),
      supabase.rpc("list_platform_audit_events", {
        search_filter: null,
        actor_user_filter: null,
        organization_filter: null,
        action_filter: null,
        entity_type_filter: null,
        outcome_filter: null,
        severity_filter: null,
        created_from: null,
        created_until: null,
        page_size: 20,
        page_offset: 0,
      }),
      supabase.rpc("list_platform_users"),
    ]);

  const organizations =
    (organizationsResult.data as OrganizationRow[] | null) ?? [];
  const memberships =
    (membershipsResult.data as MembershipRow[] | null) ?? [];
  const platformOwners =
    (ownersResult.data as PlatformOwnerRow[] | null) ?? [];
  const auditRows = (
    (auditResult.data as Array<
      Omit<PlatformAuditEventRecord, "created_at_label">
    > | null) ?? []
  ).map((row) => ({
    ...row,
    created_at_label: formatDate(row.created_at),
  }));
  const platformUsers =
    (usersResult.data as PlatformUserRecord[] | null) ?? [];
  const loadFailures = [
    organizationsResult.error && "الجهات",
    membershipsResult.error && "العضويات",
    ownersResult.error && "ملاك المنصة",
    auditResult.error && "سجل التدقيق",
    usersResult.error && "مستخدمي المنصة",
  ].filter(Boolean) as string[];
  const activeMemberships = memberships.filter(
    (membership) => membership.status === "active",
  );
  const uniqueUsers = new Set([
    ...memberships.map((membership) => membership.user_id),
    ...platformOwners.map((owner) => owner.user_id),
  ]);
  return (
    <AppShell title="إدارة المنصة">
      <header className={styles.platformHeader}>
        <div className={styles.platformIndex} aria-hidden="true">
          <span>نطاق</span>
          <strong>أ</strong>
        </div>
        <div className={styles.platformTitle}>
          <p>شركة الأمد · إدارة عابرة للجهات</p>
          <h1>مركز التحكم في منظومة المقياس</h1>
          <span>
            سجل تشغيلي موحد للجهات والمستخدمين والصلاحيات والأحداث الحساسة،
            خارج نطاق أي جهة منفردة.
          </span>
        </div>
        <div className={styles.guardStamp}>
          <small>حد الوصول</small>
          <strong>مالك المنصة فقط</strong>
          <bdi dir="ltr">platform.dashboard.read</bdi>
        </div>
      </header>

      {loadFailures.length > 0 && (
        <div className={styles.error} role="alert">
          تعذر تحميل: {loadFailures.join("، ")}. لم تُستبدل البيانات الفاشلة
          بقيم تجريبية.
        </div>
      )}

      <dl className={styles.metrics} aria-label="ملخص المنصة">
        <div>
          <dt>الجهات النشطة</dt>
          <dd>{organizations.filter((item) => item.status === "active").length}</dd>
          <small>من أصل {organizations.length} جهة</small>
        </div>
        <div>
          <dt>مستخدمون مرتبطون</dt>
          <dd>{uniqueUsers.size}</dd>
          <small>{activeMemberships.length} عضوية نشطة</small>
        </div>
        <div>
          <dt>ملاك المنصة النشطون</dt>
          <dd>{platformOwners.filter((owner) => owner.is_active).length}</dd>
          <small>لا يوجد تسجيل عام لهذا الدور</small>
        </div>
        <div>
          <dt>أحداث التدقيق</dt>
          <dd>{auditRows[0]?.total_count ?? auditRows.length}</dd>
          <small>سجل محمي قابل للبحث والتصفية</small>
        </div>
      </dl>

      <div className={styles.columns}>
        <section className={styles.panel} aria-labelledby="platform-orgs-title">
          <div className={styles.panelHeader}>
            <div>
              <span className="eyebrow">عزل الجهات</span>
              <h2 id="platform-orgs-title">حالة الجهات</h2>
            </div>
            <span className={styles.count}>{organizations.length}</span>
          </div>
          {organizations.length > 0 ? (
            <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="جدول الجهات">
              <table className={styles.table}>
                <caption className="sr-only">الجهات وحالتها وعدد عضوياتها</caption>
                <thead>
                  <tr>
                    <th scope="col">الجهة</th>
                    <th scope="col">الحالة</th>
                    <th scope="col">الأعضاء</th>
                    <th scope="col">أُنشئت</th>
                  </tr>
                </thead>
                <tbody>
                  {organizations.map((organization) => {
                    const status = organizationStatuses[organization.status];
                    const memberCount = activeMemberships.filter(
                      (membership) => membership.org_id === organization.id,
                    ).length;
                    return (
                      <tr key={organization.id}>
                        <td>
                          <strong>{organization.name_ar}</strong>
                          <small dir="ltr">{organization.slug}</small>
                        </td>
                        <td>
                          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                        </td>
                        <td className="numeric">{memberCount}</td>
                        <td>{formatDate(organization.created_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={styles.empty}>لا توجد جهات متاحة لهذا الحساب.</p>
          )}
        </section>

        <section className={styles.panel} aria-labelledby="platform-roles-title">
          <div className={styles.panelHeader}>
            <div>
              <span className="eyebrow">RBAC</span>
              <h2 id="platform-roles-title">مصفوفة الأدوار</h2>
            </div>
          </div>
          <div className={styles.roles}>
            {roleOrder.map((role) => (
              <article key={role}>
                <div>
                  <strong>{roleLabels[role]}</strong>
                  <bdi dir="ltr">{role}</bdi>
                </div>
                <span>{rolePermissionMatrix[role].length} صلاحية</span>
              </article>
            ))}
          </div>
          <p className={styles.note}>
            إسناد مالك المنصة يتم من قناة إدارية موثوقة فقط. لا تعرض الواجهة
            زرًا لترقية أي مستخدم إلى هذا الدور.
          </p>
        </section>
      </div>

      <section className={`${styles.panel} ${styles.sectionGap}`} aria-labelledby="platform-permissions-title">
        <div className={styles.panelHeader}>
          <div>
            <span className="eyebrow">صلاحيات صريحة بلا تجاوزات فردية</span>
            <h2 id="platform-permissions-title">مصفوفة الصلاحيات الكاملة</h2>
          </div>
          <span className={styles.count}>{permissionDefinitions.length}</span>
        </div>
        <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="مصفوفة الأدوار والصلاحيات">
          <table className={`${styles.table} ${styles.permissionTable}`}>
            <caption className="sr-only">الصلاحيات الممنوحة لكل دور في المنصة والجهات</caption>
            <thead>
              <tr>
                <th scope="col">الصلاحية</th>
                <th scope="col">النطاق</th>
                {roleOrder.map((role) => <th scope="col" key={role}>{roleLabels[role]}</th>)}
              </tr>
            </thead>
            <tbody>
              {permissionDefinitions.map((permission) => (
                <tr key={permission.key}>
                  <td>
                    <strong>{permission.label}</strong>
                    <small dir="ltr">{permission.key}</small>
                  </td>
                  <td>{permission.scope === "platform" ? "المنصة" : "الجهة"}</td>
                  {roleOrder.map((role) => {
                    const allowed = roleHasPermission(role, permission.key);
                    return (
                      <td key={role} className={styles.permissionCell}>
                        <span className={allowed ? styles.permissionAllowed : styles.permissionDenied} aria-label={allowed ? "مسموح" : "ممنوع"}>
                          {allowed ? "✓" : "—"}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.note}>
          الأدوار النظامية ثابتة عمدًا لمنع تصاعد الصلاحيات. الإدارة هنا تعني إسناد الدور أو سحبه من العضوية؛ لا توجد استثناءات صلاحيات فردية خفية.
        </p>
      </section>

      <PlatformAuditLog
        initialEvents={auditRows}
        organizations={organizations.map((organization) => ({
          id: organization.id,
          name: organization.name_ar,
        }))}
        users={platformUsers.map((user) => ({
          id: user.user_id,
          label: user.display_name ?? user.email ?? shortId(user.user_id),
        }))}
        currentAccountLabel={
          access.user?.email ?? shortId(access.user?.id ?? null)
        }
      />

      <PlatformOrganizationAdmin
        organizations={organizations.map((organization) => ({
          id: organization.id,
          slug: organization.slug,
          name: organization.name_ar,
          nameEn: organization.name_en,
          logoUrl: organization.logo_url,
          brandColor: organization.brand_color,
          status: organization.status,
        }))}
        users={platformUsers.map((user) => ({
          id: user.user_id,
          label: user.display_name ?? user.email ?? user.user_id,
        }))}
      />

      <PlatformUserAdmin
        users={platformUsers}
        currentUserId={access.user!.id}
        organizations={organizations.map((organization) => ({
          id: organization.id,
          name: organization.name_ar,
          status: organization.status,
        }))}
      />

      <div className={styles.sectionGap}>
        <AccessRequestsPanel
          initialFilter="invitations"
          organizations={organizations.map((organization) => ({
            id: organization.id,
            name_ar: organization.name_ar,
            brand_color: organization.brand_color,
          }))}
        />
      </div>
    </AppShell>
  );
}
