"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { createSupabaseBrowserClient } from "../lib/supabase/client";
import { Icon } from "./icons";
import styles from "../app/platform/platform.module.css";

type OrganizationOption = {
  id: string;
  slug: string;
  name: string;
  nameEn: string | null;
  logoUrl: string | null;
  brandColor: string;
  status: "active" | "suspended" | "archived";
};

type AdminTab = "create" | "edit" | "status" | "membership";

const adminTabs = [
  ["create", "إنشاء جهة"],
  ["edit", "تعديل جهة"],
  ["status", "حالة جهة"],
  ["membership", "عضوية مستخدم"],
] as const satisfies ReadonlyArray<readonly [AdminTab, string]>;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeOptional(value: FormDataEntryValue | null) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function adminOperationError(error: { message?: string; code?: string }) {
  if (error.code === "42501") return "رفضت قاعدة البيانات العملية لعدم كفاية الصلاحية.";
  if (error.code === "23505") return "توجد قيمة مسجلة مسبقًا تتعارض مع هذا التغيير.";
  if (error.message?.includes("final active organization owner")) {
    return "لا يمكن تغيير آخر مالك نشط للجهة.";
  }
  if (error.message?.includes("did not change")) return "لم تتغير أي قيمة عن الحالة الحالية.";
  return "رفضت قاعدة البيانات العملية. راجع القيم والصلاحيات ثم أعد المحاولة.";
}

export function PlatformOrganizationAdmin({
  organizations,
  users,
}: {
  organizations: OrganizationOption[];
  users: Array<{ id: string; label: string }>;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [tab, setTab] = useState<AdminTab>("create");
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const [statusOrganizationId, setStatusOrganizationId] = useState(
    organizations[0]?.id ?? "",
  );
  const [editOrganizationId, setEditOrganizationId] = useState(
    organizations[0]?.id ?? "",
  );
  const [editNameAr, setEditNameAr] = useState(organizations[0]?.name ?? "");
  const [editNameEn, setEditNameEn] = useState(organizations[0]?.nameEn ?? "");
  const [editLogoUrl, setEditLogoUrl] = useState(organizations[0]?.logoUrl ?? "");
  const [editBrandColor, setEditBrandColor] = useState(
    organizations[0]?.brandColor ?? "#C9A24B",
  );
  const [targetStatus, setTargetStatus] = useState<
    "active" | "suspended" | "archived"
  >("suspended");
  const [statusReason, setStatusReason] = useState("");
  const [statusConfirmation, setStatusConfirmation] = useState("");
  const [membershipOrganizationId, setMembershipOrganizationId] = useState(
    organizations[0]?.id ?? "",
  );
  const [membershipUserId, setMembershipUserId] = useState("");
  const [membershipRole, setMembershipRole] = useState<
    "owner" | "trainer" | "viewer"
  >("viewer");
  const [membershipStatus, setMembershipStatus] = useState<
    "active" | "suspended" | "revoked"
  >("active");
  const [membershipReason, setMembershipReason] = useState("");
  const [membershipConfirmation, setMembershipConfirmation] = useState("");
  const selectedStatusOrganization = organizations.find(
    (organization) => organization.id === statusOrganizationId,
  );

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, current: AdminTab) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();

    const currentIndex = adminTabs.findIndex(([key]) => key === current);
    const isRtl = document.documentElement.dir === "rtl";
    const forwardKey = isRtl ? "ArrowLeft" : "ArrowRight";
    let nextIndex = currentIndex;

    if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = adminTabs.length - 1;
    else if (event.key === forwardKey) nextIndex = (currentIndex + 1) % adminTabs.length;
    else nextIndex = (currentIndex - 1 + adminTabs.length) % adminTabs.length;

    const nextTab = adminTabs[nextIndex][0];
    setTab(nextTab);
    setFeedback(null);
    event.currentTarget.parentElement
      ?.querySelector<HTMLButtonElement>(`#platform-admin-tab-${nextTab}`)
      ?.focus();
  }

  function selectOrganizationForEdit(organizationId: string) {
    const organization = organizations.find((item) => item.id === organizationId);
    setEditOrganizationId(organizationId);
    setEditNameAr(organization?.name ?? "");
    setEditNameEn(organization?.nameEn ?? "");
    setEditLogoUrl(organization?.logoUrl ?? "");
    setEditBrandColor(organization?.brandColor ?? "#C9A24B");
  }

  async function runMutation(
    operation: () => Promise<{ error: { message?: string; code?: string } | null }>,
    successMessage: string,
  ) {
    setIsSaving(true);
    setFeedback(null);

    const { error } = await operation();
    if (error) {
      setFeedback({
        tone: "error",
        message: adminOperationError(error),
      });
      setIsSaving(false);
      return false;
    }

    setFeedback({ tone: "success", message: successMessage });
    setIsSaving(false);
    router.refresh();
    return true;
  }

  async function createOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const slug = String(form.get("slug") ?? "").trim().toLowerCase();
    const nameAr = String(form.get("nameAr") ?? "").trim();
    const nameEn = normalizeOptional(form.get("nameEn"));
    const logoUrl = normalizeOptional(form.get("logoUrl"));
    const brandColor = String(form.get("brandColor") ?? "").trim();

    const succeeded = await runMutation(
      async () => {
        const { error } = await supabase.rpc("create_platform_organization", {
          target_slug: slug,
          target_name_ar: nameAr,
          target_name_en: nameEn,
          target_logo_url: logoUrl,
          target_brand_color: brandColor,
        });
        return { error };
      },
      "أُنشئت الجهة وسُجلت العملية في سجل التدقيق.",
    );

    if (succeeded) {
      formElement.reset();
    }
  }

  async function changeOrganizationStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedStatusOrganization) {
      setFeedback({ tone: "error", message: "اختر جهة صالحة." });
      return;
    }

    if (
      targetStatus !== "active" &&
      statusConfirmation.trim() !== selectedStatusOrganization.slug
    ) {
      setFeedback({
        tone: "error",
        message: "اكتب المعرّف المختصر للجهة حرفيًا لتأكيد العملية.",
      });
      return;
    }

    const succeeded = await runMutation(
      async () => {
        const { error } = await supabase.rpc(
          "change_platform_organization_status",
          {
            target_org_id: selectedStatusOrganization.id,
            target_status: targetStatus,
            target_reason: statusReason.trim(),
          },
        );
        return { error };
      },
      "تغيرت حالة الجهة وسُجل السبب. لا تُستعاد المفاتيح الملغاة تلقائيًا.",
    );

    if (succeeded) {
      setStatusReason("");
      setStatusConfirmation("");
    }
  }

  async function updateOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editOrganizationId) {
      setFeedback({ tone: "error", message: "اختر جهة صالحة." });
      return;
    }

    await runMutation(
      async () => {
        const { error } = await supabase.rpc("update_organization_profile", {
          target_org_id: editOrganizationId,
          target_name_ar: editNameAr.trim(),
          target_name_en: editNameEn.trim() || null,
          target_logo_url: editLogoUrl.trim() || null,
          target_brand_color: editBrandColor,
        });
        return { error };
      },
      "حُدّثت هوية الجهة وسُجلت القيم السابقة والجديدة في سجل التدقيق.",
    );
  }

  async function setMembership(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const targetUserId = membershipUserId.trim();
    if (!uuidPattern.test(targetUserId)) {
      setFeedback({
        tone: "error",
        message: "معرّف المستخدم يجب أن يكون UUID صالحًا.",
      });
      return;
    }

    if (
      (membershipRole === "owner" || membershipStatus !== "active") &&
      membershipConfirmation.trim() !== targetUserId
    ) {
      setFeedback({
        tone: "error",
        message: "اكتب معرّف المستخدم كاملًا لتأكيد هذا التغيير الحساس.",
      });
      return;
    }

    const succeeded = await runMutation(
      async () => {
        const { error } = await supabase.rpc("set_organization_membership", {
          target_org_id: membershipOrganizationId,
          target_user_id: targetUserId,
          target_role: membershipRole,
          target_status: membershipStatus,
          target_reason: membershipReason.trim(),
        });
        return { error };
      },
      "حُدّثت العضوية وسُجل الدور والحالة والسبب.",
    );

    if (succeeded) {
      setMembershipReason("");
      setMembershipConfirmation("");
    }
  }

  return (
    <section className={`${styles.panel} ${styles.adminPanel}`} aria-labelledby="platform-admin-title">
      <div className={styles.panelHeader}>
        <div>
          <span className="eyebrow">عمليات محمية ومُدققة</span>
          <h2 id="platform-admin-title">إدارة الجهات والعضويات</h2>
        </div>
      </div>

      <div className="segmented-control" role="tablist" aria-label="عمليات إدارة المنصة">
        {adminTabs.map(([key, label]) => (
          <button
            key={key}
            id={`platform-admin-tab-${key}`}
            type="button"
            role="tab"
            aria-selected={tab === key}
            aria-controls="platform-admin-panel"
            tabIndex={tab === key ? 0 : -1}
            onClick={() => {
              setTab(key);
              setFeedback(null);
            }}
            onKeyDown={(event) => moveTab(event, key)}
          >
            {label}
          </button>
        ))}
      </div>

      {feedback && (
        <div
          className={`inline-feedback ${feedback.tone === "success" ? "success-feedback" : "error-feedback"}`}
          role={feedback.tone === "error" ? "alert" : "status"}
        >
          <Icon name={feedback.tone === "success" ? "check" : "warning"} size={17} />
          {feedback.message}
        </div>
      )}

      {tab === "create" && (
        <form
          id="platform-admin-panel"
          role="tabpanel"
          aria-labelledby="platform-admin-tab-create"
          className={styles.adminForm}
          onSubmit={createOrganization}
        >
          <div className="form-grid">
            <label>
              الاسم العربي
              <input name="nameAr" minLength={2} maxLength={160} required />
            </label>
            <label>
              الاسم الإنجليزي
              <input name="nameEn" minLength={2} maxLength={160} dir="auto" />
            </label>
          </div>
          <div className="form-grid">
            <label>
              المعرّف المختصر
              <input name="slug" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" dir="ltr" required />
            </label>
            <label>
              اللون
              <input name="brandColor" type="color" defaultValue="#C9A24B" required />
            </label>
          </div>
          <label>
            رابط الشعار الاختياري
            <input name="logoUrl" type="url" inputMode="url" dir="ltr" placeholder="https://" />
          </label>
          <button className="button button-primary" type="submit" disabled={isSaving}>
            <Icon name="plus" size={17} />
            {isSaving ? "جارٍ الإنشاء..." : "إنشاء الجهة"}
          </button>
        </form>
      )}

      {tab === "edit" && (
        <form
          id="platform-admin-panel"
          role="tabpanel"
          aria-labelledby="platform-admin-tab-edit"
          className={styles.adminForm}
          onSubmit={updateOrganization}
        >
          <label>
            الجهة
            <select
              value={editOrganizationId}
              onChange={(event) => selectOrganizationForEdit(event.target.value)}
              required
            >
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
          </label>
          <div className="form-grid">
            <label>
              الاسم العربي
              <input value={editNameAr} onChange={(event) => setEditNameAr(event.target.value)} minLength={2} maxLength={160} required />
            </label>
            <label>
              الاسم الإنجليزي
              <input value={editNameEn} onChange={(event) => setEditNameEn(event.target.value)} minLength={2} maxLength={160} dir="auto" />
            </label>
          </div>
          <div className="form-grid">
            <label>
              رابط الشعار الاختياري
              <input value={editLogoUrl} onChange={(event) => setEditLogoUrl(event.target.value)} type="url" inputMode="url" dir="ltr" placeholder="https://" />
            </label>
            <label>
              اللون
              <input value={editBrandColor} onChange={(event) => setEditBrandColor(event.target.value)} type="color" required />
            </label>
          </div>
          <p className={styles.note}>
            لا يمكن تغيير المعرّف المختصر من الواجهة لأنه جزء من الروابط والعقود الخارجية.
          </p>
          <button className="button button-primary" type="submit" disabled={isSaving || !organizations.length}>
            {isSaving ? "جارٍ الحفظ..." : "حفظ بيانات الجهة"}
          </button>
        </form>
      )}

      {tab === "status" && (
        <form
          id="platform-admin-panel"
          role="tabpanel"
          aria-labelledby="platform-admin-tab-status"
          className={styles.adminForm}
          onSubmit={changeOrganizationStatus}
        >
          <div className="form-grid">
            <label>
              الجهة
              <select value={statusOrganizationId} onChange={(event) => setStatusOrganizationId(event.target.value)} required>
                {organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name} · {organization.status}
                  </option>
                ))}
              </select>
            </label>
            <label>
              الحالة الجديدة
              <select value={targetStatus} onChange={(event) => setTargetStatus(event.target.value as typeof targetStatus)}>
                <option value="active">نشطة</option>
                <option value="suspended">معلّقة</option>
                <option value="archived">مؤرشفة</option>
              </select>
            </label>
          </div>
          <label>
            سبب التغيير
            <textarea value={statusReason} onChange={(event) => setStatusReason(event.target.value)} minLength={5} maxLength={500} required />
          </label>
          {targetStatus !== "active" && (
            <label>
              اكتب <bdi dir="ltr">{selectedStatusOrganization?.slug ?? "slug"}</bdi> للتأكيد
              <input value={statusConfirmation} onChange={(event) => setStatusConfirmation(event.target.value)} dir="ltr" autoComplete="off" required />
            </label>
          )}
          <button className={`button ${targetStatus === "active" ? "button-primary" : "button-danger"}`} type="submit" disabled={isSaving || !organizations.length}>
            {isSaving ? "جارٍ الحفظ..." : "تطبيق الحالة"}
          </button>
        </form>
      )}

      {tab === "membership" && (
        <form
          id="platform-admin-panel"
          role="tabpanel"
          aria-labelledby="platform-admin-tab-membership"
          className={styles.adminForm}
          onSubmit={setMembership}
        >
          <div className="form-grid">
            <label>
              الجهة
              <select value={membershipOrganizationId} onChange={(event) => setMembershipOrganizationId(event.target.value)} required>
                {organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>{organization.name}</option>
                ))}
              </select>
            </label>
            <label>
              معرّف المستخدم
              <input
                value={membershipUserId}
                onChange={(event) => setMembershipUserId(event.target.value)}
                list="platform-existing-users"
                dir="ltr"
                placeholder="00000000-0000-0000-0000-000000000000"
                required
              />
              <datalist id="platform-existing-users">
                {users.map((user) => (
                  <option key={user.id} value={user.id}>{user.label}</option>
                ))}
              </datalist>
            </label>
          </div>
          <div className="form-grid">
            <label>
              الدور
              <select value={membershipRole} onChange={(event) => setMembershipRole(event.target.value as typeof membershipRole)}>
                <option value="owner">مالك الجهة</option>
                <option value="trainer">مدرّب</option>
                <option value="viewer">قارئ</option>
              </select>
            </label>
            <label>
              حالة العضوية
              <select value={membershipStatus} onChange={(event) => setMembershipStatus(event.target.value as typeof membershipStatus)}>
                <option value="active">نشطة</option>
                <option value="suspended">معلّقة</option>
                <option value="revoked">ملغاة</option>
              </select>
            </label>
          </div>
          <label>
            سبب الإسناد أو التغيير
            <textarea value={membershipReason} onChange={(event) => setMembershipReason(event.target.value)} minLength={5} maxLength={500} required />
          </label>
          {(membershipRole === "owner" || membershipStatus !== "active") && (
            <label>
              اكتب معرّف المستخدم كاملًا لتأكيد منح دور المالك أو خفض الوصول
              <input
                value={membershipConfirmation}
                onChange={(event) => setMembershipConfirmation(event.target.value)}
                dir="ltr"
                autoComplete="off"
                required
              />
            </label>
          )}
          <p className={styles.note}>
            هذا العقد يدير حسابًا موجودًا بمعرّفه. إنشاء حساب جديد يتم بدعوة
            موثقة، وليس بإضافة بريد أو كلمة مرور داخل الواجهة.
          </p>
          <button className="button button-primary" type="submit" disabled={isSaving || !organizations.length}>
            {isSaving ? "جارٍ الحفظ..." : "حفظ العضوية"}
          </button>
        </form>
      )}
    </section>
  );
}
