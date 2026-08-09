"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { roleLabels } from "../lib/auth/permissions";
import { createSupabaseBrowserClient } from "../lib/supabase/client";
import { useAccess } from "./access-provider";
import { AppShell, StatusBadge } from "./app-shell";
import { Icon } from "./icons";
import styles from "./account-live-page.module.css";

function safeBrandColor(value: string) {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : "#C9A24B";
}

export function AccountLivePage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { context, status, message, activeOrganization, refresh } = useAccess();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      const { data, error } = await supabase.auth.getUser();
      if (!active) return;

      if (error || !data.user) {
        setFeedback({
          tone: "error",
          message: "تعذر تحميل بيانات الحساب من خدمة الدخول.",
        });
        setIsLoadingProfile(false);
        return;
      }

      const metadata = data.user.user_metadata as Record<string, unknown>;
      setFullName(
        typeof metadata.full_name === "string"
          ? metadata.full_name
          : context?.user.displayName ?? "",
      );
      setPhone(typeof metadata.phone === "string" ? metadata.phone : "");
      setIsLoadingProfile(false);
    }

    void loadProfile();
    return () => {
      active = false;
    };
  }, [context?.user.displayName, supabase]);

  const initials = (context?.user.displayName ?? "م")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);

    const normalizedName = fullName.trim();
    if (normalizedName.length < 2 || normalizedName.length > 120) {
      setFeedback({
        tone: "error",
        message: "الاسم الكامل يجب أن يكون بين حرفين و120 حرفًا.",
      });
      return;
    }

    setIsSaving(true);
    const { error } = await supabase.auth.updateUser({
      data: {
        full_name: normalizedName,
        phone: phone.trim() || null,
      },
    });

    if (error) {
      setFeedback({
        tone: "error",
        message: "تعذر حفظ معلومات الحساب. لم تُحفظ نسخة محلية بديلة.",
      });
      setIsSaving(false);
      return;
    }

    await refresh();
    setFeedback({ tone: "success", message: "حُفظت معلومات الحساب فعليًا." });
    setIsSaving(false);
  }

  return (
    <AppShell title="الملف الشخصي">
      <header className={styles.recordHeader}>
        <div className={styles.recordIndex} aria-hidden="true">
          <span>سجل</span>
          <strong>01</strong>
        </div>
        <div className={styles.recordTitle}>
          <p>هوية الحساب ونطاق الوصول</p>
          <h1>الملف الشخصي</h1>
          <span>
            هذه الصفحة تعرض الحقيقة القادمة من جلسة الدخول والعضويات، ولا تنشئ
            نسخة محلية بديلة عند تعذر المصدر.
          </span>
        </div>
        <div className={styles.sourceStamp}>
          <small>المصدر</small>
          <strong>جلسة موثقة</strong>
          <bdi dir="ltr">Supabase Auth</bdi>
        </div>
      </header>

      {(status === "loading" || isLoadingProfile) && (
        <div className={styles.statePanel} role="status" aria-live="polite">
          <span className={styles.stateMarker} aria-hidden="true" />
          <div>
            <strong>جارٍ مطابقة سجل الحساب</strong>
            <p>يتم تحميل الهوية والعضويات من المصدر الموثق.</p>
          </div>
        </div>
      )}

      {(status === "error" || message) && (
        <div className={`${styles.feedback} ${styles.feedbackError}`} role="alert">
          <Icon name="warning" size={18} />
          <div>
            <strong>تعذر إثبات نطاق الوصول</strong>
            <span>{message || "تعذر تحميل نطاق وصول الحساب."}</span>
          </div>
        </div>
      )}

      {feedback && (
        <div
          className={`${styles.feedback} ${feedback.tone === "success" ? styles.feedbackSuccess : styles.feedbackError}`}
          role={feedback.tone === "error" ? "alert" : "status"}
        >
          <Icon name={feedback.tone === "success" ? "check" : "warning"} size={17} />
          <span>{feedback.message}</span>
        </div>
      )}

      {context && (
        <div className={styles.accountLedger}>
          <aside className={styles.identityRail} aria-label="ملخص الحساب">
            <div className={styles.identitySeal}>
              <span aria-hidden="true">{initials || "م"}</span>
              <StatusBadge tone="success">جلسة موثقة</StatusBadge>
            </div>
            <div className={styles.identityCopy}>
              <small>صاحب السجل</small>
              <h2>{context.user.displayName}</h2>
              <p dir="ltr">{context.user.email ?? "لا يوجد بريد ظاهر"}</p>
            </div>

            <dl className={styles.scopeFacts}>
              <div>
                <dt>عدد الجهات</dt>
                <dd>{context.organizations.length}</dd>
              </div>
              <div>
                <dt>النطاق الحالي</dt>
                <dd>{activeOrganization?.name_ar ?? (context.isPlatformOwner ? "المنصة" : "غير محدد")}</dd>
              </div>
              <div>
                <dt>الدور</dt>
                <dd>
                  {activeOrganization
                    ? roleLabels[activeOrganization.role]
                    : context.isPlatformOwner
                      ? "مالك المنصة"
                      : "بلا دور جهة"}
                </dd>
              </div>
            </dl>

            {context.isPlatformOwner && (
              <div className={styles.platformAccess}>
                <div>
                  <small>صلاحية على مستوى المنصة</small>
                  <strong>شركة الأمد</strong>
                  <bdi dir="ltr">platform_owner</bdi>
                </div>
                <Link className="button button-secondary" href="/platform">
                  فتح مركز المنصة
                </Link>
              </div>
            )}
          </aside>

          <div className={styles.accountBody}>
            <section className={styles.profileSection} aria-labelledby="profile-details-title">
              <div className={styles.sectionHeading}>
                <div>
                  <span>سجل الهوية</span>
                  <h2 id="profile-details-title">معلومات الحساب</h2>
                </div>
                <p>يمكن تعديل الاسم والجوال فقط. البريد جزء من عقد تسجيل الدخول.</p>
              </div>

              <form className={styles.profileForm} onSubmit={saveProfile}>
                <div className={styles.formGrid}>
                  <label>
                    <span>الاسم الكامل</span>
                    <input
                      value={fullName}
                      onChange={(event) => setFullName(event.target.value)}
                      autoComplete="name"
                      minLength={2}
                      maxLength={120}
                      disabled={isLoadingProfile || isSaving}
                      required
                    />
                  </label>
                  <label>
                    <span>رقم الجوال</span>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                      autoComplete="tel"
                      dir="ltr"
                      maxLength={30}
                      disabled={isLoadingProfile || isSaving}
                    />
                  </label>
                </div>
                <label className={styles.emailField}>
                  <span>البريد الإلكتروني</span>
                  <input
                    type="email"
                    value={context.user.email ?? ""}
                    dir="ltr"
                    readOnly
                  />
                  <small>يُدار البريد من خدمة تسجيل الدخول ولا يُغيّر من هذه الصفحة.</small>
                </label>
                <div className={styles.formActions}>
                  <button
                    type="submit"
                    className="button button-primary"
                    disabled={isLoadingProfile || isSaving}
                  >
                    {isSaving ? "جارٍ الحفظ..." : "حفظ المعلومات"}
                  </button>
                </div>
              </form>
            </section>

            <section className={styles.membershipSection} aria-labelledby="memberships-title">
              <div className={styles.sectionHeading}>
                <div>
                  <span>دفتر العضويات</span>
                  <h2 id="memberships-title">الجهات المرتبطة</h2>
                </div>
                <p>كل سطر يمثل عضوية فعلية وحدودها الحالية.</p>
              </div>
              {context.organizations.length > 0 ? (
                <div className={styles.membershipRegister}>
                  <div className={styles.registerHead} aria-hidden="true">
                    <span>الجهة</span>
                    <span>الدور</span>
                    <span>الحالة</span>
                  </div>
                  {context.organizations.map((organization) => (
                    <article className={styles.membershipRow} key={organization.id}>
                      <span
                      className={styles.tenantMark}
                      style={
                        {
                          "--membership-accent": safeBrandColor(
                            organization.brand_color,
                          ),
                        } as CSSProperties
                      }
                        aria-hidden="true"
                      >
                        {organization.name_ar.trim()[0] ?? "ج"}
                      </span>
                      <div>
                        <h3>{organization.name_ar}</h3>
                        <small dir="ltr">{organization.id}</small>
                      </div>
                      <strong>{roleLabels[organization.role]}</strong>
                      <StatusBadge
                        tone={
                          organization.status === "active"
                            ? "success"
                            : organization.status === "suspended"
                              ? "warning"
                              : "muted"
                        }
                      >
                        {organization.status === "active"
                          ? "نشطة"
                          : organization.status === "suspended"
                            ? "معلّقة"
                            : "مؤرشفة"}
                      </StatusBadge>
                    </article>
                  ))}
                </div>
              ) : (
                <div className={styles.emptyState}>
                  <Icon name="organizations" size={26} />
                  <div>
                    <h3>لا توجد عضوية جهة</h3>
                    <p>يمكن أن يبقى حساب مالك المنصة صالحًا من دون عضوية داخل جهة.</p>
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </AppShell>
  );
}
