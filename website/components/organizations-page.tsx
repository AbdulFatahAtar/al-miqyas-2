"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { AppShell, StatusBadge } from "./app-shell";
import { Icon } from "./icons";
import { createSupabaseBrowserClient } from "../lib/supabase/client";
import { AccessRequestsPanel } from "./access-requests-panel";
import styles from "./organizations-page.module.css";

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

type RegistryTab = "organizations" | "members" | "requests";

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

function membershipStatus(
  status: MembershipRecord["status"],
): { label: string; tone: "success" | "warning" | "muted" } {
  const states: Record<
    MembershipRecord["status"],
    { label: string; tone: "success" | "warning" | "muted" }
  > = {
    invited: { label: "دعوة معلقة", tone: "warning" },
    active: { label: "نشط", tone: "success" },
    suspended: { label: "موقوف", tone: "warning" },
    revoked: { label: "مسحوب", tone: "muted" },
  };

  return states[status];
}

export function OrganizationsPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [tab, setTab] = useState<RegistryTab>("organizations");
  const [organizations, setOrganizations] = useState<OrganizationRecord[]>([]);
  const [memberships, setMemberships] = useState<MembershipRecord[]>([]);
  const [counts, setCounts] = useState<Record<string, OrganizationCounts>>({});
  const [currentUserId, setCurrentUserId] = useState("");
  const [currentUserEmail, setCurrentUserEmail] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [pendingRequestCount, setPendingRequestCount] = useState(0);
  const [requestCountKnown, setRequestCountKnown] = useState(false);
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
      (!platformAdmin?.is_active && !ownMemberships?.length)
    ) {
      setErrorMessage("لا توجد جهة نشطة مرتبطة بهذا الحساب.");
      setIsLoading(false);
      return;
    }

    setCanReviewAccessRequests(
      Boolean(platformAdmin?.is_active) ||
        (ownMemberships ?? []).some((membership) => membership.role === "owner"),
    );

    const ownOrgIds = (ownMemberships ?? []).map(
      (membership) => membership.org_id,
    );
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

  const visibleTabs = useMemo<RegistryTab[]>(
    () =>
      canReviewAccessRequests
        ? ["organizations", "members", "requests"]
        : ["organizations", "members"],
    [canReviewAccessRequests],
  );

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentTab: RegistryTab,
  ) => {
    const currentIndex = visibleTabs.indexOf(currentTab);
    let nextIndex = currentIndex;

    if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex + 1) % visibleTabs.length;
    } else if (event.key === "ArrowRight") {
      nextIndex = (currentIndex - 1 + visibleTabs.length) % visibleTabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = visibleTabs.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    const nextTab = visibleTabs[nextIndex];
    setTab(nextTab);
    document.getElementById(`organization-tab-${nextTab}`)?.focus();
  };

  const activeOrganizationCount = organizations.filter(
    (organization) => organization.status === "active",
  ).length;
  const activeMembershipCount = memberships.filter(
    (membership) => membership.status === "active",
  ).length;

  return (
    <AppShell title="الجهات والأعضاء">
      <div className={styles.page}>
        <header className={styles.ledgerHead}>
          <div className={styles.headingCopy}>
            <span className={styles.folio}>٠٨ / سجل النطاق والصلاحية</span>
            <h1>الجهات والأعضاء</h1>
            <p>
              خريطة الجهات التي يصل إليها الحساب، والعضويات التي تحدد حدود
              القراءة والإدارة داخل كل نطاق مستقل.
            </p>
          </div>
          <div className={styles.sourceStamp}>
            <Icon name="shield" size={18} />
            <span>
              <small>مصدر الصلاحية</small>
              <strong>عضويات نشطة وسياسة عزل الجهات</strong>
            </span>
            <code dir="ltr">RBAC · RLS</code>
          </div>
        </header>

        {errorMessage && (
          <div className={styles.errorFeedback} role="alert">
            <Icon name="warning" size={18} />
            <span>{errorMessage}</span>
            <button type="button" onClick={() => void loadData()}>
              إعادة المحاولة
            </button>
          </div>
        )}

        <dl className={styles.summaryRail} aria-label="ملخص الجهات والعضويات">
          <div>
            <dt>الجهات المتاحة</dt>
            <dd>{isLoading ? "—" : organizations.length}</dd>
            <small>ضمن نطاق الحساب</small>
          </div>
          <div>
            <dt>الجهات النشطة</dt>
            <dd>{isLoading ? "—" : activeOrganizationCount}</dd>
            <small>قرار تشغيل فعّال</small>
          </div>
          <div>
            <dt>العضويات النشطة</dt>
            <dd>{isLoading ? "—" : activeMembershipCount}</dd>
            <small>عبر الجهات المتاحة</small>
          </div>
          <div>
            <dt>طلبات تنتظر قراراً</dt>
            <dd>
              {isLoading
                ? "—"
                : canReviewAccessRequests
                  ? requestCountKnown
                    ? pendingRequestCount
                    : "—"
                  : "محجوب"}
            </dd>
            <small>
              {canReviewAccessRequests
                ? requestCountKnown
                  ? "للمراجعة"
                  : "يُحسب عند فتح السجل"
                : "بحسب الدور"}
            </small>
          </div>
        </dl>

        <nav className={styles.registryTabs} aria-label="فهرس سجل الجهات">
          <div role="tablist" aria-label="أقسام الإدارة">
            <button
              id="organization-tab-organizations"
              role="tab"
              aria-selected={tab === "organizations"}
              aria-controls="organization-panel-organizations"
              tabIndex={tab === "organizations" ? 0 : -1}
              onClick={() => setTab("organizations")}
              onKeyDown={(event) => handleTabKeyDown(event, "organizations")}
            >
              <span>01</span>
              الجهات
              <strong>{organizations.length}</strong>
            </button>
            <button
              id="organization-tab-members"
              role="tab"
              aria-selected={tab === "members"}
              aria-controls="organization-panel-members"
              tabIndex={tab === "members" ? 0 : -1}
              onClick={() => setTab("members")}
              onKeyDown={(event) => handleTabKeyDown(event, "members")}
            >
              <span>02</span>
              الأعضاء
              <strong>{memberships.length}</strong>
            </button>
            {canReviewAccessRequests && (
              <button
                id="organization-tab-requests"
                role="tab"
                aria-selected={tab === "requests"}
                aria-controls="organization-panel-requests"
                tabIndex={tab === "requests" ? 0 : -1}
                onClick={() => setTab("requests")}
                onKeyDown={(event) => handleTabKeyDown(event, "requests")}
              >
                <span>03</span>
                طلبات الانضمام
                <strong>{requestCountKnown ? pendingRequestCount : "—"}</strong>
              </button>
            )}
          </div>
        </nav>

        {isLoading ? (
          <section className={styles.loadingState} aria-live="polite">
            <span className={styles.loadingLine} />
            <span>جارٍ مطابقة الجهات بالعضويات والصلاحيات…</span>
          </section>
        ) : tab === "requests" ? (
          <section
            id="organization-panel-requests"
            className={styles.tabPanel}
            role="tabpanel"
            aria-labelledby="organization-tab-requests"
          >
            <div className={styles.sectionHeading}>
              <div><span>السجل ج</span><h2>طلبات الانضمام</h2></div>
              <strong>
                {requestCountKnown
                  ? `${pendingRequestCount} بانتظار قرار`
                  : "جارٍ احتساب الطلبات"}
              </strong>
            </div>
            <div className={styles.embeddedPanel}>
              <AccessRequestsPanel
                organizations={organizations.map((organization) => ({
                  id: organization.id,
                  name_ar: organization.name_ar,
                  brand_color: organization.brand_color,
                }))}
                onPendingCountChange={(count) => {
                  setPendingRequestCount(count);
                  setRequestCountKnown(true);
                }}
              />
            </div>
          </section>
        ) : tab === "organizations" ? (
          <section
            id="organization-panel-organizations"
            className={styles.tabPanel}
            role="tabpanel"
            aria-labelledby="organization-tab-organizations"
          >
            <div className={styles.sectionHeading}>
              <div><span>السجل أ</span><h2>نطاقات الجهات</h2></div>
              <strong>{organizations.length} سجل</strong>
            </div>
            {organizations.length ? (
              <ol className={styles.organizationLedger}>
                {organizations.map((organization, index) => {
                  const status = organizationStatus(organization.status);
                  const organizationCounts = counts[organization.id] ?? {
                    programs: 0,
                    trainees: 0,
                    members: 0,
                  };

                  return (
                    <li className={styles.organizationRecord} key={organization.id}>
                      <span className={styles.recordNumber} aria-hidden="true">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div className={styles.organizationIdentity}>
                        {organization.logo_url ? (
                          <Image
                            src={organization.logo_url}
                            alt={`شعار ${organization.name_ar}`}
                            width={56}
                            height={56}
                            unoptimized
                          />
                        ) : (
                          <div
                            className={styles.logoPending}
                            style={{ borderColor: organization.brand_color }}
                          >
                            شعار<br />قيد الإضافة
                          </div>
                        )}
                        <span>
                          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                          <h3>{organization.name_ar}</h3>
                          {organization.name_en && <p dir="ltr">{organization.name_en}</p>}
                          <code dir="ltr">{organization.slug}</code>
                        </span>
                      </div>
                      <dl className={styles.organizationFacts}>
                        <div><dt>البرامج</dt><dd>{organizationCounts.programs}</dd></div>
                        <div><dt>المتدرّبون</dt><dd>{organizationCounts.trainees}</dd></div>
                        <div><dt>الأعضاء النشطون</dt><dd>{organizationCounts.members}</dd></div>
                      </dl>
                      <div className={styles.decisionState}>
                        <small>قرار النطاق</small>
                        <strong>{status.label}</strong>
                        <span>{organization.status === "active" ? "البيانات متاحة حسب العضوية" : "الوصول مقيد بحالة الجهة"}</span>
                      </div>
                      <details className={styles.mobileDisclosure}>
                        <summary>تفاصيل النطاق</summary>
                        <dl>
                          <div><dt>البرامج</dt><dd>{organizationCounts.programs}</dd></div>
                          <div><dt>المتدرّبون</dt><dd>{organizationCounts.trainees}</dd></div>
                          <div><dt>الأعضاء</dt><dd>{organizationCounts.members}</dd></div>
                          <div><dt>الحكم</dt><dd>{status.label}</dd></div>
                        </dl>
                      </details>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <div className={styles.emptyState}>
                <Icon name="organizations" size={28} />
                <div>
                  <h3>لا توجد جهة متاحة</h3>
                  <p>لا يثبت السجل وجود نطاق جهة مرتبط بهذا الحساب حالياً.</p>
                </div>
              </div>
            )}
          </section>
        ) : (
          <section
            id="organization-panel-members"
            className={styles.tabPanel}
            role="tabpanel"
            aria-labelledby="organization-tab-members"
          >
            <div className={styles.sectionHeading}>
              <div><span>السجل ب</span><h2>دليل العضويات</h2></div>
              <strong>{memberships.length} سجل</strong>
            </div>
            {memberships.length ? (
              <div className={styles.tableWrap}>
                <table className={styles.memberTable}>
                  <thead>
                    <tr><th>الحساب</th><th>الجهة</th><th>الدور</th><th>قرار العضوية</th></tr>
                  </thead>
                  <tbody>
                    {memberships.map((membership) => {
                      const organization = organizations.find(
                        (item) => item.id === membership.org_id,
                      );
                      const isCurrentUser = membership.user_id === currentUserId;
                      const status = membershipStatus(membership.status);

                      return (
                        <tr key={`${membership.user_id}-${membership.org_id}`}>
                          <td data-label="الحساب">
                            <strong>{isCurrentUser ? currentUserEmail : "عضو مسجل"}</strong>
                            <code dir="ltr">{membership.user_id.slice(0, 8)}</code>
                          </td>
                          <td data-label="الجهة"><strong>{organization?.name_ar ?? "جهة غير متاحة"}</strong></td>
                          <td data-label="الدور"><span>{roleLabel(membership.role)}</span></td>
                          <td data-label="الحالة"><StatusBadge tone={status.tone}>{status.label}</StatusBadge></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className={styles.emptyState}>
                <Icon name="account" size={28} />
                <div><h3>لا توجد عضويات</h3><p>لم يُرجع نطاق الصلاحية أي عضوية قابلة للعرض.</p></div>
              </div>
            )}
          </section>
        )}
      </div>
    </AppShell>
  );
}
