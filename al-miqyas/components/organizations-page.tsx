"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell, PageHeader, StatusBadge } from "./app-shell";
import { Icon } from "./icons";
import { createSupabaseBrowserClient } from "../lib/supabase/client";
import { AccessRequestsPanel } from "./access-requests-panel";

type OrganizationRecord = {
  id: string;
  slug: string;
  name_ar: string;
  name_en: string | null;
  logo_url: string | null;
  brand_color: string;
  status: "active" | "suspended" | "archived";
};

type MembershipRecord = {
  user_id: string;
  org_id: string;
  role: "owner" | "trainer" | "viewer";
  status: "invited" | "active" | "suspended" | "revoked";
};

type OrganizationCounts = {
  programs: number;
  trainees: number;
  members: number;
};

function roleLabel(role: MembershipRecord["role"]) {
  const labels: Record<MembershipRecord["role"], string> = {
    owner: "مالك",
    trainer: "مدرّب",
    viewer: "قارئ",
  };

  return labels[role];
}

function organizationStatus(
  status: OrganizationRecord["status"],
): { label: string; tone: "success" | "warning" | "muted" } {
  if (status === "active") {
    return { label: "نشطة", tone: "success" };
  }

  if (status === "suspended") {
    return { label: "موقوفة", tone: "warning" };
  }

  return { label: "مؤرشفة", tone: "muted" };
}

export function OrganizationsPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [tab, setTab] = useState<
    "organizations" | "members" | "requests"
  >("organizations");
  const [organizations, setOrganizations] = useState<OrganizationRecord[]>([]);
  const [memberships, setMemberships] = useState<MembershipRecord[]>([]);
  const [counts, setCounts] = useState<Record<string, OrganizationCounts>>({});
  const [currentUserId, setCurrentUserId] = useState("");
  const [currentUserEmail, setCurrentUserEmail] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [pendingRequestCount, setPendingRequestCount] = useState(0);
  const [canReviewAccessRequests, setCanReviewAccessRequests] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setErrorMessage("تعذر التحقق من جلسة المستخدم.");
      setIsLoading(false);
      return;
    }

    setCurrentUserId(user.id);
    setCurrentUserEmail(user.email ?? "الحساب الحالي");

    const [
      { data: ownMemberships, error: ownMembershipsError },
      { data: platformAdmin, error: platformAdminError },
    ] = await Promise.all([
      supabase
        .from("memberships")
        .select("user_id, org_id, role, status")
        .eq("user_id", user.id)
        .eq("status", "active")
        .order("created_at", { ascending: true }),
      supabase
        .from("platform_admins")
        .select("is_active")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

    if (
      ownMembershipsError ||
      platformAdminError ||
      !ownMemberships?.length
    ) {
      setErrorMessage("لا توجد جهة نشطة مرتبطة بهذا الحساب.");
      setIsLoading(false);
      return;
    }

    setCanReviewAccessRequests(
      Boolean(platformAdmin?.is_active) ||
        ownMemberships.some((membership) => membership.role === "owner"),
    );

    const ownOrgIds = ownMemberships.map((membership) => membership.org_id);
    const organizationRequest = platformAdmin?.is_active
      ? supabase
          .from("organizations")
          .select("id, slug, name_ar, name_en, logo_url, brand_color, status")
          .order("created_at", { ascending: true })
      : supabase
          .from("organizations")
          .select("id, slug, name_ar, name_en, logo_url, brand_color, status")
          .in("id", ownOrgIds)
          .order("created_at", { ascending: true });

    const { data: organizationData, error: organizationsError } =
      await organizationRequest;

    if (organizationsError || !organizationData?.length) {
      setErrorMessage("تعذر تحميل بيانات الجهات من قاعدة البيانات.");
      setIsLoading(false);
      return;
    }

    const orgIds = organizationData.map((organization) => organization.id);
    const [
      { data: membershipData, error: membershipsError },
      { data: programData, error: programsError },
      { data: traineeData, error: traineesError },
    ] = await Promise.all([
      supabase
        .from("memberships")
        .select("user_id, org_id, role, status")
        .in("org_id", orgIds)
        .order("created_at", { ascending: true }),
      supabase.from("programs").select("id, org_id").in("org_id", orgIds),
      supabase.from("trainees").select("id, org_id").in("org_id", orgIds),
    ]);

    if (
      membershipsError ||
      programsError ||
      traineesError
    ) {
      setErrorMessage("تعذر تحميل بيانات الجهات من قاعدة البيانات.");
      setIsLoading(false);
      return;
    }

    const loadedMemberships = (membershipData ?? []) as MembershipRecord[];
    const nextCounts = Object.fromEntries(
      orgIds.map((orgId) => [
        orgId,
        {
          programs: (programData ?? []).filter((item) => item.org_id === orgId)
            .length,
          trainees: (traineeData ?? []).filter((item) => item.org_id === orgId)
            .length,
          members: loadedMemberships.filter(
            (item) => item.org_id === orgId && item.status === "active",
          ).length,
        },
      ]),
    );

    setOrganizations((organizationData ?? []) as OrganizationRecord[]);
    setMemberships(loadedMemberships);
    setCounts(nextCounts);
    setIsLoading(false);
  }, [supabase]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  return (
    <AppShell title="الجهات والأعضاء">
      <PageHeader
        eyebrow="الإدارة والصلاحيات"
        title="الجهات والأعضاء"
        description="إدارة الجهات والعضويات وطلبات الوصول مع عزل الصلاحيات بين الجهات."
      />

      {errorMessage && (
        <div className="inline-feedback error-feedback">
          <Icon name="warning" size={18} />
          {errorMessage}
        </div>
      )}

      <div className="segmented-control">
        <button
          aria-pressed={tab === "organizations"}
          onClick={() => setTab("organizations")}
        >
          الجهات
        </button>
        <button
          aria-pressed={tab === "members"}
          onClick={() => setTab("members")}
        >
          الأعضاء
        </button>
        {canReviewAccessRequests && (
          <button
            aria-pressed={tab === "requests"}
            onClick={() => setTab("requests")}
          >
            طلبات الانضمام
            {pendingRequestCount > 0 && (
              <span className="segment-count">{pendingRequestCount}</span>
            )}
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="loading-state">جارٍ تحميل الجهات...</div>
      ) : tab === "requests" ? (
        <AccessRequestsPanel
          organizations={organizations.map((organization) => ({
            id: organization.id,
            name_ar: organization.name_ar,
            brand_color: organization.brand_color,
          }))}
          onPendingCountChange={setPendingRequestCount}
        />
      ) : tab === "organizations" ? (
        organizations.length ? (
          <section className="organization-grid">
            {organizations.map((organization) => {
              const status = organizationStatus(organization.status);
              const organizationCounts = counts[organization.id] ?? {
                programs: 0,
                trainees: 0,
                members: 0,
              };

              return (
                <article className="organization-card" key={organization.id}>
                  {organization.logo_url ? (
                    <img
                      className="organization-logo"
                      src={organization.logo_url}
                      alt={`شعار ${organization.name_ar}`}
                    />
                  ) : (
                    <div
                      className="logo-pending"
                      style={{ borderColor: organization.brand_color }}
                    >
                      {organization.name_ar.slice(0, 1)}
                    </div>
                  )}
                  <div>
                    <h2>{organization.name_ar}</h2>
                    {organization.name_en && (
                      <p dir="ltr">{organization.name_en}</p>
                    )}
                    <p>
                      {organizationCounts.trainees} متدرّب ·{" "}
                      {organizationCounts.programs} برنامج ·{" "}
                      {organizationCounts.members} عضو
                    </p>
                    <small className="mono" dir="ltr">
                      {organization.slug}
                    </small>
                  </div>
                  <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                </article>
              );
            })}
          </section>
        ) : (
          <div className="empty-state">
            <Icon name="organizations" size={26} />
            <h3>لا توجد جهة متاحة</h3>
            <p>يجب ربط الحساب بعضوية نشطة قبل عرض بيانات الجهة.</p>
          </div>
        )
      ) : (
        <section className="content-section table-section">
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>الحساب</th>
                  <th>الجهة</th>
                  <th>الدور</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {memberships.map((membership) => {
                  const organization = organizations.find(
                    (item) => item.id === membership.org_id,
                  );
                  const isCurrentUser = membership.user_id === currentUserId;

                  return (
                    <tr
                      key={`${membership.user_id}-${membership.org_id}`}
                    >
                      <td>
                        <strong>
                          {isCurrentUser ? currentUserEmail : "عضو مسجل"}
                        </strong>
                      </td>
                      <td>{organization?.name_ar ?? "جهة غير متاحة"}</td>
                      <td>{roleLabel(membership.role)}</td>
                      <td>
                        <StatusBadge
                          tone={
                            membership.status === "active"
                              ? "success"
                              : "warning"
                          }
                        >
                          {membership.status === "active" ? "نشط" : "غير نشط"}
                        </StatusBadge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </AppShell>
  );
}
