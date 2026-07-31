"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import { createSupabaseBrowserClient } from "../lib/supabase/client";

const navigation: Array<{ href: string; label: string; icon: IconName }> = [
  { href: "/dashboard", label: "الملخص", icon: "overview" },
  { href: "/programs", label: "البرامج والدفعات", icon: "programs" },
  { href: "/trainees", label: "المتدرّبون", icon: "trainees" },
  { href: "/sessions", label: "الجلسات الحية", icon: "sessions" },
  { href: "/reports", label: "التقارير", icon: "reports" },
  { href: "/certificates", label: "الشهادات", icon: "certificates" },
  { href: "/organizations", label: "الجهات والأعضاء", icon: "organizations" },
  { href: "/settings", label: "الإعدادات", icon: "settings" },
];

const tenants = [
  {
    slug: "diwan",
    name: "ديوان المظالم",
    short: "د",
    color: "#C9A24B",
  },
  {
    slug: "uqu-medical-college",
    name: "كلية الطب · جامعة أم القرى",
    short: "ط",
    color: "#C9A24B",
  },
  {
    slug: "al-itqan-training-academy",
    name: "أكاديمية الإتقان للتدريب",
    short: "إ",
    color: "#35C6E6",
  },
] as const;

type Tenant = (typeof tenants)[number];

export function AppShell({ children, title }: { children: ReactNode; title?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [tenantIndex, setTenantIndex] = useState(0);
  const [tenantOpen, setTenantOpen] = useState(false);
  const [pendingTenant, setPendingTenant] =
    useState<Tenant | null>(null);
  const [isSwitchingTenant, setIsSwitchingTenant] = useState(false);
  const [tenantSwitchError, setTenantSwitchError] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const tenant = tenants[tenantIndex];

  useEffect(() => {
    const activeSlug = window.localStorage.getItem("miqyas-active-org");
    const activeIndex = tenants.findIndex(
      (organization) => organization.slug === activeSlug,
    );

    if (activeIndex >= 0) {
      setTenantIndex(activeIndex);
    }
  }, []);

  const signOut = async () => {
    window.localStorage.removeItem("miqyas-active-org");
    await createSupabaseBrowserClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  };

  const requestTenantSwitch = (
    organization: Tenant,
    index: number,
  ) => {
    setTenantOpen(false);

    if (index === tenantIndex) {
      return;
    }

    setTenantSwitchError("");
    setPendingTenant(organization);
  };

  const confirmTenantSwitch = async () => {
    if (!pendingTenant) {
      return;
    }

    setIsSwitchingTenant(true);
    setTenantSwitchError("");

    const { error } = await createSupabaseBrowserClient().auth.signOut();

    if (error) {
      setTenantSwitchError(
        "تعذر إنهاء الجلسة الحالية. لم يتم تبديل الجهة.",
      );
      setIsSwitchingTenant(false);
      return;
    }

    window.localStorage.removeItem("miqyas-active-org");
    router.replace("/login");
    router.refresh();
  };

  const active = (href: string) => pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`));

  return (
    <div className="app-shell" style={{ "--tenant-accent": tenant.color } as React.CSSProperties}>
      {pendingTenant && (
        <div
          className="modal-layer"
          role="presentation"
          onMouseDown={() => {
            if (!isSwitchingTenant) {
              setPendingTenant(null);
            }
          }}
        >
          <section
            className="modal tenant-auth-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tenant-auth-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <h2 id="tenant-auth-title">تبديل الحساب</h2>
              <button
                className="icon-button"
                type="button"
                aria-label="إغلاق"
                disabled={isSwitchingTenant}
                onClick={() => setPendingTenant(null)}
              >
                <Icon name="close" />
              </button>
            </div>
            <div className="tenant-auth-content">
              <span
                className="tenant-avatar"
                style={{ background: pendingTenant.color }}
              >
                {pendingTenant.short}
              </span>
              <div>
                <h3>{pendingTenant.name}</h3>
                <p>
                  سيُنهي النظام جلسة الحساب الحالي ثم يفتح صفحة تسجيل الدخول
                  العادية. يمكنك بعدها الدخول بأي حساب صالح.
                </p>
              </div>
            </div>
            {tenantSwitchError && (
              <p className="form-error" role="alert">
                {tenantSwitchError}
              </p>
            )}
            <div className="modal-actions tenant-auth-actions">
              <button
                className="button button-secondary"
                type="button"
                disabled={isSwitchingTenant}
                onClick={() => setPendingTenant(null)}
              >
                إلغاء
              </button>
              <button
                className="button button-primary"
                type="button"
                disabled={isSwitchingTenant}
                onClick={() => void confirmTenantSwitch()}
              >
                {isSwitchingTenant
                  ? "جارٍ إنهاء الجلسة..."
                  : "متابعة إلى تسجيل الدخول"}
              </button>
            </div>
          </section>
        </div>
      )}
      {mobileOpen && <button className="sidebar-backdrop" aria-label="إغلاق القائمة" onClick={() => setMobileOpen(false)} />}
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand">
          <img className="brand-mark" src="/brand/al-amad-mark.png" alt="شعار شركة الأمد" />
          <div>
            <strong>منظومة المقياس</strong>
            <span>سجل الإتقان</span>
          </div>
          <button className="icon-button mobile-close" aria-label="إغلاق القائمة" onClick={() => setMobileOpen(false)}><Icon name="close" /></button>
        </div>

        <div className="tenant-switcher">
          <button type="button" className="tenant-trigger" aria-expanded={tenantOpen} onClick={() => setTenantOpen((value) => !value)}>
            <span className="tenant-avatar">{tenant.short}</span>
            <span><small>الجهة الحالية</small><strong>{tenant.name}</strong></span>
            <Icon name="chevron" size={15} />
          </button>
          {tenantOpen && (
            <div className="tenant-menu">
              {tenants.map((item, index) => (
                <button key={item.slug} type="button" className={index === tenantIndex ? "selected" : ""} onClick={() => requestTenantSwitch(item, index)}>
                  <span className="tenant-avatar" style={{ background: item.color }}>{item.short}</span>
                  <span>{item.name}</span>
                  {index === tenantIndex && <Icon name="check" size={16} />}
                </button>
              ))}
            </div>
          )}
        </div>

        <nav className="main-nav" aria-label="التنقل الرئيسي">
          {navigation.map((item) => (
            <Link key={item.href} href={item.href} className={active(item.href) ? "nav-item nav-active" : "nav-item"} onClick={() => setMobileOpen(false)}>
              <Icon name={item.icon} size={18} />
              <span>{item.label}</span>
              {item.href === "/sessions" && <i className="nav-count">1</i>}
            </Link>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="environment-note"><span className="signal-dot" />تشغيل مختلط · بعض الصفحات تجريبية</div>
          <Link href="/account" className={active("/account") ? "operator-card operator-active" : "operator-card"}>
            <span className="operator-avatar">م</span>
            <span><strong>مشرف الجهة</strong><small>Owner</small></span>
            <Icon name="chevron" size={15} />
          </Link>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-start">
            <button className="icon-button mobile-menu" aria-label="فتح القائمة" onClick={() => setMobileOpen(true)}><Icon name="menu" /></button>
            <div><small>منظومة المقياس</small><strong>{title ?? "لوحة التشغيل"}</strong></div>
          </div>
          <div className="topbar-actions">
            <div className="topbar-popover-wrap">
              <button className="icon-button" aria-label="الإشعارات" aria-expanded={notificationsOpen} onClick={() => { setNotificationsOpen((value) => !value); setAccountOpen(false); }}>
                <Icon name="bell" /><span className="notification-dot" />
              </button>
              {notificationsOpen && (
                <div className="topbar-popover notifications-popover">
                  <div className="popover-title"><strong>الإشعارات</strong><span>2 جديد</span></div>
                  <Link href="/reports" onClick={() => setNotificationsOpen(false)}><span className="status-pin success" /><span><strong>اكتمل تقرير دفعة يوليو</strong><small>منذ 8 دقائق</small></span></Link>
                  <Link href="/sessions" onClick={() => setNotificationsOpen(false)}><span className="status-pin warning" /><span><strong>جلسة تحتاج مطابقة معرّف</strong><small>منذ 24 دقيقة</small></span></Link>
                </div>
              )}
            </div>
            <div className="topbar-popover-wrap">
              <button className="account-trigger" aria-expanded={accountOpen} onClick={() => { setAccountOpen((value) => !value); setNotificationsOpen(false); }}>
                <span>م</span><div><strong>مشرف الجهة</strong><small>farhad@example.com</small></div><Icon name="chevron" size={14} />
              </button>
              {accountOpen && (
                <div className="topbar-popover account-popover">
                  <Link href="/account"><Icon name="account" size={17} />الملف الشخصي</Link>
                  <Link href="/settings"><Icon name="settings" size={17} />إعدادات الجهة</Link>
                  <button type="button" className="danger-link" onClick={signOut}><Icon name="logout" size={17} />تسجيل الخروج</button>
                </div>
              )}
            </div>
          </div>
        </header>
        <div className="page-content">{children}</div>
      </main>
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function StatusBadge({ tone, children }: { tone: "success" | "warning" | "danger" | "system" | "muted"; children: ReactNode }) {
  return <span className={`status-badge badge-${tone}`}><i />{children}</span>;
}

export function DemoNotice() {
  return <div className="demo-notice"><Icon name="warning" size={17} /><span><strong>نسخة تجريبية قابلة للنقر.</strong> البيانات المعروضة ليست متصلة بقاعدة البيانات حتى الآن.</span></div>;
}
