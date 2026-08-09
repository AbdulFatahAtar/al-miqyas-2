"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { createSupabaseBrowserClient } from "../lib/supabase/client";
import { normalizeIntlWhitespace } from "../lib/date-time";
import { Icon } from "./icons";
import { StatusBadge } from "./app-shell";
import styles from "../app/platform/platform.module.css";

export type PlatformUserRecord = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  is_suspended: boolean;
  suspension_reason: string | null;
  membership_count: number;
  is_platform_owner: boolean;
};

type PlatformOrganizationOption = {
  id: string;
  name: string;
  status: "active" | "suspended" | "archived";
};

type UserFilter = "all" | "active" | "suspended" | "platform_owner";

const dateFormatter = new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Riyadh",
});

function formatDate(value: string | null) {
  if (!value) return "لم يدخل بعد";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "غير متاح"
    : normalizeIntlWhitespace(dateFormatter.format(date));
}

function suspensionError(error: { message?: string; code?: string }) {
  if (error.code === "42501") return "رفضت قاعدة البيانات العملية لعدم كفاية الصلاحية.";
  if (error.message?.includes("final active platform owner")) {
    return "لا يمكن تعليق آخر مالك منصة نشط.";
  }
  if (error.message?.includes("final active organization owner")) {
    return "لا يمكن تعليق مستخدم لأنه آخر مالك نشط لإحدى الجهات.";
  }
  if (error.message?.includes("own account")) return "لا يمكنك تعليق الحساب المستخدم حاليًا.";
  return "رفضت قاعدة البيانات تغيير وصول المستخدم. راجع الحالة ثم أعد المحاولة.";
}

export function PlatformUserAdmin({
  users,
  currentUserId,
  organizations,
}: {
  users: PlatformUserRecord[];
  currentUserId: string;
  organizations: PlatformOrganizationOption[];
}) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [selectedUser, setSelectedUser] = useState<PlatformUserRecord | null>(null);
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isInviting, setIsInviting] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<UserFilter>("all");
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);

  async function inviteUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setIsInviting(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/platform/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: String(form.get("fullName") ?? "").trim(),
          email: String(form.get("email") ?? "").trim(),
          organizationId: String(form.get("organizationId") ?? ""),
          role: String(form.get("role") ?? ""),
          reason: String(form.get("reason") ?? "").trim(),
        }),
      });
      const payload = (await response.json()) as { message?: string };

      if (!response.ok && response.status !== 202) {
        setFeedback({
          tone: "error",
          message: payload.message ?? "تعذر إرسال الدعوة.",
        });
        return;
      }

      setFeedback({
        tone: "success",
        message: payload.message ?? "أُنشئت الدعوة وسُجلت العملية.",
      });
      formElement.reset();
      router.refresh();
    } catch {
      setFeedback({ tone: "error", message: "تعذر الاتصال بالخادم لإرسال الدعوة." });
    } finally {
      setIsInviting(false);
    }
  }

  async function changeUserAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedUser) return;

    const expectedConfirmation = selectedUser.email ?? selectedUser.user_id;
    if (confirmation.trim() !== expectedConfirmation) {
      setFeedback({
        tone: "error",
        message: "نص التأكيد لا يطابق الحساب المحدد.",
      });
      return;
    }

    setIsSaving(true);
    setFeedback(null);
    const nextSuspended = !selectedUser.is_suspended;
    const { error } = await supabase.rpc("set_platform_user_suspension", {
      target_user_id: selectedUser.user_id,
      target_suspended: nextSuspended,
      target_reason: reason.trim(),
    });

    if (error) {
      setFeedback({
        tone: "error",
        message: suspensionError(error),
      });
      setIsSaving(false);
      return;
    }

    setFeedback({
      tone: "success",
      message: nextSuspended
        ? "عُلّق وصول المستخدم عبر جميع الجهات وسُجل السبب."
        : "أُعيد وصول المستخدم وسُجل السبب.",
    });
    setSelectedUser(null);
    setReason("");
    setConfirmation("");
    setIsSaving(false);
    router.refresh();
  }

  const normalizedSearch = search.trim().toLowerCase();
  const visibleUsers = users.filter((user) => {
    const matchesFilter =
      filter === "all" ||
      (filter === "active" && !user.is_suspended) ||
      (filter === "suspended" && user.is_suspended) ||
      (filter === "platform_owner" && user.is_platform_owner);
    if (!matchesFilter) return false;
    if (!normalizedSearch) return true;
    return [user.display_name, user.email, user.user_id]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(normalizedSearch));
  });

  return (
    <section className={`${styles.panel} ${styles.adminPanel}`} aria-labelledby="platform-users-title">
      <div className={styles.panelHeader}>
        <div>
          <span className="eyebrow">وصول عابر للجهات</span>
          <h2 id="platform-users-title">مستخدمو المنصة</h2>
        </div>
        <span className={styles.count}>{visibleUsers.length}/{users.length}</span>
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

      {selectedUser && (
        <form className={styles.userConfirmation} onSubmit={changeUserAccess}>
          <div>
            <strong>
              {selectedUser.is_suspended ? "إعادة وصول المستخدم" : "تعليق المستخدم"}
            </strong>
            <p>
              {selectedUser.is_suspended
                ? "سيعود الحساب إلى صلاحيات عضوياته الحالية."
                : "سيتوقف الحساب عن استخدام جميع صلاحيات المنصة والجهات فورًا."}
            </p>
          </div>
          <label>
            السبب
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={5} maxLength={500} required autoFocus />
          </label>
          <label>
            اكتب <bdi dir="ltr">{selectedUser.email ?? selectedUser.user_id}</bdi> للتأكيد
            <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} dir="ltr" autoComplete="off" required />
          </label>
          <div className="modal-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                setSelectedUser(null);
                setReason("");
                setConfirmation("");
              }}
            >
              تراجع
            </button>
            <button
              type="submit"
              className={selectedUser.is_suspended ? "button button-primary" : "button button-danger"}
              disabled={isSaving || reason.trim().length < 5}
            >
              {isSaving
                ? "جارٍ الحفظ..."
                : selectedUser.is_suspended
                  ? "إعادة الوصول"
                  : "تعليق الحساب"}
            </button>
          </div>
        </form>
      )}

      <form className={styles.invitationForm} onSubmit={inviteUser}>
        <div>
          <span className="eyebrow">دعوة موثقة بلا كلمة مرور</span>
          <h3>دعوة مستخدم جديد</h3>
          <p>يصل للمستخدم رابط دخول مؤقت، وتُنشأ العضوية بعد إثبات ملكية البريد.</p>
        </div>
        <div className="form-grid">
          <label>
            الاسم الكامل
            <input name="fullName" minLength={2} maxLength={160} required />
          </label>
          <label>
            البريد الإلكتروني
            <input name="email" type="email" dir="ltr" autoComplete="email" required />
          </label>
        </div>
        <div className="form-grid">
          <label>
            الجهة النشطة
            <select name="organizationId" required>
              {organizations.filter((organization) => organization.status === "active").map((organization) => (
                <option key={organization.id} value={organization.id}>{organization.name}</option>
              ))}
            </select>
          </label>
          <label>
            الدور
            <select name="role" defaultValue="viewer">
              <option value="owner">مالك الجهة</option>
              <option value="trainer">مدرّب</option>
              <option value="viewer">قارئ</option>
            </select>
          </label>
        </div>
        <label>
          سبب الدعوة
          <textarea name="reason" minLength={5} maxLength={500} required />
        </label>
        <button
          className="button button-primary"
          type="submit"
          disabled={isInviting || !organizations.some((organization) => organization.status === "active")}
        >
          <Icon name="mail" size={17} />
          {isInviting ? "جارٍ إنشاء الدعوة..." : "إنشاء الدعوة وإرسالها"}
        </button>
      </form>

      <div className={styles.userToolbar}>
        <label className={styles.userSearch}>
          <Icon name="search" size={16} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="بحث بالاسم أو البريد أو المعرّف"
          />
        </label>
        <label>
          <span className="sr-only">تصفية المستخدمين</span>
          <select value={filter} onChange={(event) => setFilter(event.target.value as UserFilter)}>
            <option value="all">كل المستخدمين</option>
            <option value="active">النشطون</option>
            <option value="suspended">المعلّقون</option>
            <option value="platform_owner">ملاك المنصة</option>
          </select>
        </label>
      </div>

      {visibleUsers.length > 0 ? (
        <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="جدول مستخدمي المنصة">
          <table className={styles.table}>
            <caption className="sr-only">مستخدمو المنصة وحالة وصولهم</caption>
            <thead>
              <tr>
                <th scope="col">المستخدم</th>
                <th scope="col">الوصول</th>
                <th scope="col">العضويات</th>
                <th scope="col">آخر دخول</th>
                <th scope="col">إجراء</th>
              </tr>
            </thead>
            <tbody>
              {visibleUsers.map((user) => (
                <tr key={user.user_id}>
                  <td>
                    <strong>{user.display_name ?? "اسم غير مضاف"}</strong>
                    <small dir="ltr">{user.email ?? user.user_id}</small>
                  </td>
                  <td>
                    <StatusBadge tone={user.is_suspended ? "danger" : "success"}>
                      {user.is_suspended ? "معلّق" : "نشط"}
                    </StatusBadge>
                    {user.is_platform_owner && <small>مالك منصة</small>}
                  </td>
                  <td className="numeric">{user.membership_count}</td>
                  <td>{formatDate(user.last_sign_in_at)}</td>
                  <td>
                    <button
                      type="button"
                      className={user.is_suspended ? "button button-secondary" : "button button-tertiary"}
                      disabled={user.user_id === currentUserId || isSaving}
                      onClick={() => {
                        setSelectedUser(user);
                        setReason("");
                        setConfirmation("");
                        setFeedback(null);
                      }}
                    >
                      {user.user_id === currentUserId
                        ? "الحساب الحالي"
                        : user.is_suspended
                          ? "إعادة الوصول"
                          : "تعليق"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={styles.empty}>
          {users.length
            ? "لا يوجد مستخدم يطابق البحث والتصفية الحالية."
            : "لا توجد بيانات مستخدمين متاحة. إذا لم تُطبّق Migration 029 فهذه النتيجة ليست دليلًا على خلو المنصة من الحسابات."}
        </p>
      )}
    </section>
  );
}
