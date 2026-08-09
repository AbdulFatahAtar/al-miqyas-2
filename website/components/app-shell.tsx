"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  roleHasPermission,
  roleLabels,
  type Permission,
} from "../lib/auth/permissions";
import { createSupabaseBrowserClient } from "../lib/supabase/client";
import { useAccess, type ClientAccessOrganization } from "./access-provider";
import { Icon, type IconName } from "./icons";
import { ThemeToggle } from "./theme-toggle";
import styles from "./app-shell.module.css";

const navigation: Array<{
  href: string;
  label: string;
  icon: IconName;
  permission: Permission;
}> = [
  {
    href: "/dashboard",
    label: "الملخص",
    icon: "overview",
    permission: "organization.read",
  },
  {
    href: "/programs",
    label: "البرامج والدفعات",
    icon: "programs",
    permission: "programs.read",
  },
  {
    href: "/trainees",
    label: "المتدرّبون",
    icon: "trainees",
    permission: "trainees.read",
  },
  {
    href: "/sessions",
    label: "الجلسات الحية",
    icon: "sessions",
    permission: "sessions.read",
  },
  {
    href: "/reports",
    label: "التقارير",
    icon: "reports",
    permission: "reports.read",
  },
  {
    href: "/certificates",
    label: "الشهادات",
    icon: "certificates",
    permission: "certificates.read",
  },
  {
    href: "/organizations",
    label: "الجهة والأعضاء",
    icon: "organizations",
    permission: "memberships.read",
  },
  {
    href: "/settings",
    label: "الإعدادات",
    icon: "settings",
    permission: "integrations.read",
  },
];

type OpenPopover = "tenant" | "account" | null;

const organizationStatusLabels: Record<
  ClientAccessOrganization["status"],
  string
> = {
  active: "نشطة",
  suspended: "معلّقة",
  archived: "مؤرشفة",
};



function initial(value: string | null | undefined, fallback: string) {
  return value?.trim().charAt(0) || fallback;
}

function safeAccent(value: string | null | undefined) {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : "#C9A24B";
}

function accentForeground(value: string | null | undefined) {
  const accent = safeAccent(value);
  const channels = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(accent.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance =
    channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  const darkLuminance = 0.015;
  const darkContrast = (luminance + 0.05) / (darkLuminance + 0.05);
  const lightContrast = 1.05 / (luminance + 0.05);

  return darkContrast >= lightContrast ? "#172033" : "#FFFFFF";
}

function joinClassNames(...classNames: Array<string | undefined | false>) {
  return classNames.filter(Boolean).join(" ");
}

export function AppShell({
  children,
  title,
}: {
  children: ReactNode;
  title?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const access = useAccess();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [openPopover, setOpenPopover] = useState<OpenPopover>(null);
  const [switchingOrganizationId, setSwitchingOrganizationId] = useState<
    string | null
  >(null);
  const [shellMessage, setShellMessage] = useState("");
  const mastheadRef = useRef<HTMLElement>(null);
  const indexPanelRef = useRef<HTMLElement>(null);
  const mainAreaRef = useRef<HTMLElement>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileCloseButtonRef = useRef<HTMLButtonElement>(null);
  const tenantPopoverRef = useRef<HTMLDivElement>(null);
  const tenantTriggerRef = useRef<HTMLButtonElement>(null);
  const accountPopoverRef = useRef<HTMLDivElement>(null);
  const accountTriggerRef = useRef<HTMLButtonElement>(null);

  const context = access.context;
  const activeOrganization = access.activeOrganization;
  const selectableOrganizations = useMemo(
    () =>
      (context?.organizations ?? []).filter(
        (organization) =>
          context?.isPlatformOwner || organization.status === "active",
      ),
    [context],
  );
  const visibleNavigation = useMemo(() => {
    if (!activeOrganization) {
      return [];
    }

    return navigation.filter((item) =>
      roleHasPermission(activeOrganization.role, item.permission),
    );
  }, [activeOrganization]);
  const userName = context?.user.displayName ?? "الحساب";
  const userEmail = context?.user.email;
  const activeRole =
    activeOrganization?.role ??
    (context?.isPlatformOwner ? "platform_owner" : null);
  const activeRoleLabel = activeRole ? roleLabels[activeRole] : "بلا نطاق نشط";
  const tenantAccent = safeAccent(activeOrganization?.brand_color);
  const pageTitle = title ?? "لوحة التشغيل";

  useEffect(() => {
    const query = window.matchMedia("(max-width: 899px)");
    const syncViewport = () => setIsMobileViewport(query.matches);

    syncViewport();
    query.addEventListener("change", syncViewport);
    return () => query.removeEventListener("change", syncViewport);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
    setOpenPopover(null);
  }, [pathname]);

  useEffect(() => {
    const indexPanel = indexPanelRef.current;

    if (indexPanel) {
      indexPanel.inert = isMobileViewport && !mobileOpen;
    }

    if (!isMobileViewport || !mobileOpen) {
      return;
    }

    if (mastheadRef.current) {
      mastheadRef.current.inert = true;
    }
    if (mainAreaRef.current) {
      mainAreaRef.current.inert = true;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => mobileCloseButtonRef.current?.focus());

    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !indexPanelRef.current) {
        return;
      }

      const focusable = Array.from(
        indexPanelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hidden);
      const first = focusable[0];
      const last = focusable.at(-1);

      if (!first || !last) {
        return;
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", trapFocus);
    return () => {
      document.body.style.overflow = previousOverflow;
      if (mastheadRef.current) {
        mastheadRef.current.inert = false;
      }
      if (mainAreaRef.current) {
        mainAreaRef.current.inert = false;
      }
      document.removeEventListener("keydown", trapFocus);
    };
  }, [isMobileViewport, mobileOpen]);

  useEffect(() => {
    if (!openPopover) {
      return;
    }

    const closeOnOutsideInteraction = (event: PointerEvent) => {
      const target = event.target as Node;
      const activeContainer =
        openPopover === "tenant"
          ? tenantPopoverRef.current
          : accountPopoverRef.current;

      if (!activeContainer?.contains(target)) {
        setOpenPopover(null);
      }
    };

    document.addEventListener("pointerdown", closeOnOutsideInteraction);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsideInteraction);
  }, [openPopover]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      if (openPopover) {
        const trigger =
          openPopover === "tenant"
            ? tenantTriggerRef.current
            : accountTriggerRef.current;
        setOpenPopover(null);
        window.requestAnimationFrame(() => trigger?.focus());
        return;
      }

      if (isMobileViewport && mobileOpen) {
        setMobileOpen(false);
        window.requestAnimationFrame(() => mobileMenuButtonRef.current?.focus());
      }
    };

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isMobileViewport, mobileOpen, openPopover]);

  const closeMobileNavigation = (restoreFocus = false) => {
    setMobileOpen(false);
    setOpenPopover(null);

    if (restoreFocus) {
      window.requestAnimationFrame(() => mobileMenuButtonRef.current?.focus());
    }
  };

  const signOut = async () => {
    setShellMessage("");
    const { error } = await createSupabaseBrowserClient().auth.signOut();

    if (error) {
      setShellMessage("تعذر تسجيل الخروج. حاول مرة أخرى.");
      setOpenPopover(null);
      return;
    }

    router.replace("/login");
    router.refresh();
  };

  const selectOrganization = async (organizationId: string) => {
    setOpenPopover(null);
    setShellMessage("");

    if (organizationId === activeOrganization?.id) {
      return;
    }

    setSwitchingOrganizationId(organizationId);
    const changed = await access.selectOrganization(organizationId);
    setSwitchingOrganizationId(null);

    if (!changed) {
      setShellMessage(access.message || "تعذر تبديل الجهة.");
    }
  };

  const active = (href: string) =>
    pathname === href ||
    (href !== "/dashboard" && pathname.startsWith(`${href}/`));

  return (
    <div
      className={styles.shell}
      style={
        {
          "--tenant-accent": tenantAccent,
          "--tenant-accent-foreground": accentForeground(tenantAccent),
        } as CSSProperties
      }
    >
      <a className={styles.skipLink} href="#main-content">
        الانتقال إلى المحتوى
      </a>

      <header ref={mastheadRef} className={styles.masthead}>
        <div className={styles.mastheadRail}>
          <Link className={styles.brand} href="/dashboard" aria-label="منظومة المقياس، فتح الملخص">
            <Image
              className={styles.brandMark}
              src="/brand/al-amad-mark-transparent.png"
              alt=""
              aria-hidden="true"
              width={44}
              height={44}
            />
            <span className={styles.brandCopy}>
              <strong>منظومة المقياس</strong>
              <small>سجل الإتقان</small>
            </span>
          </Link>

          <div className={styles.pageContext} aria-label={`القسم الحالي: ${pageTitle}`}>
            <small>القيد المفتوح</small>
            <strong>{pageTitle}</strong>
          </div>

          <div className={styles.organizationPopover} ref={tenantPopoverRef}>
            <button
              ref={tenantTriggerRef}
              type="button"
              className={styles.organizationTrigger}
              aria-expanded={openPopover === "tenant"}
              aria-controls="organization-switcher"
              aria-haspopup="dialog"
              aria-busy={
                access.status === "loading" || Boolean(switchingOrganizationId)
              }
              disabled={
                !selectableOrganizations.length || access.status === "loading"
              }
              onClick={() =>
                setOpenPopover((current) =>
                  current === "tenant" ? null : "tenant",
                )
              }
            >
              <span className={styles.organizationAvatar} aria-hidden="true">
                {initial(activeOrganization?.name_ar, "ج")}
              </span>
              <span className={styles.organizationCopy}>
                <small>
                  {access.status === "loading"
                    ? "جارٍ تحميل نطاق الوصول"
                    : activeOrganization
                      ? `الجهة الحالية · ${organizationStatusLabels[activeOrganization.status]}`
                      : "لا توجد جهة متاحة"}
                </small>
                <strong>{activeOrganization?.name_ar ?? "اختر جهة"}</strong>
                <span>{activeRoleLabel}</span>
              </span>
              <span
                className={joinClassNames(
                  styles.disclosureIcon,
                  openPopover === "tenant" && styles.disclosureIconOpen,
                )}
                aria-hidden="true"
              >
                <Icon name="chevron" size={15} />
              </span>
            </button>

            {openPopover === "tenant" && (
              <div
                id="organization-switcher"
                className={styles.organizationMenu}
                role="dialog"
                aria-modal="false"
                aria-label="اختيار الجهة النشطة"
              >
                <div className={styles.popoverHeading}>
                  <span>
                    <small>نطاق البيانات</small>
                    <strong>اختيار الجهة النشطة</strong>
                  </span>
                  <span>{selectableOrganizations.length}</span>
                </div>
                <div className={styles.organizationList}>
                  {selectableOrganizations.map((organization) => {
                    const isSelected = organization.id === activeOrganization?.id;
                    const isSwitching =
                      switchingOrganizationId === organization.id;

                    return (
                      <button
                        key={organization.id}
                        type="button"
                        className={joinClassNames(
                          styles.organizationOption,
                          isSelected && styles.organizationOptionSelected,
                        )}
                        aria-pressed={isSelected}
                        aria-busy={isSwitching}
                        disabled={isSwitching}
                        onClick={() => void selectOrganization(organization.id)}
                      >
                        <span
                          className={styles.organizationOptionAvatar}
                          aria-hidden="true"
                          style={{
                            background: safeAccent(organization.brand_color),
                            color: accentForeground(organization.brand_color),
                          }}
                        >
                          {initial(organization.name_ar, "ج")}
                        </span>
                        <span>
                          <strong>{organization.name_ar}</strong>
                          <small>
                            {organizationStatusLabels[organization.status]}
                          </small>
                        </span>
                        {isSelected && <Icon name="check" size={16} />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className={styles.utilities}>
            <div className={styles.desktopThemeControl}>
              <ThemeToggle compact />
            </div>

            <div className={styles.utilityPopover} ref={accountPopoverRef}>
              <button
                ref={accountTriggerRef}
                className={styles.accountTrigger}
                type="button"
                aria-expanded={openPopover === "account"}
                aria-controls="account-popover"
                aria-haspopup="dialog"
                onClick={() =>
                  setOpenPopover((current) =>
                    current === "account" ? null : "account",
                  )
                }
              >
                <span className={styles.accountAvatar} aria-hidden="true">
                  {initial(userName, "ح")}
                </span>
                <span className={styles.accountCopy}>
                  <strong>{userName}</strong>
                  {userEmail && <small>{userEmail}</small>}
                </span>
                <span
                  className={joinClassNames(
                    styles.disclosureIcon,
                    openPopover === "account" && styles.disclosureIconOpen,
                  )}
                  aria-hidden="true"
                >
                  <Icon name="chevron" size={14} />
                </span>
              </button>
              {openPopover === "account" && (
                <div
                  id="account-popover"
                  className={joinClassNames(styles.utilityMenu, styles.accountMenu)}
                  role="dialog"
                  aria-modal="false"
                  aria-label="خيارات الحساب"
                >
                  <Link
                    href="/account"
                    onClick={() => setOpenPopover(null)}
                  >
                    <Icon name="account" size={17} />
                    الملف الشخصي
                  </Link>
                  {activeOrganization &&
                    roleHasPermission(
                      activeOrganization.role,
                      "integrations.read",
                    ) && (
                      <Link
                        href="/settings"
                        onClick={() => setOpenPopover(null)}
                      >
                        <Icon name="settings" size={17} />
                        إعدادات الجهة
                      </Link>
                    )}
                  {context?.isPlatformOwner && (
                    <Link
                      href="/platform"
                      onClick={() => setOpenPopover(null)}
                    >
                      <Icon name="shield" size={17} />
                      منصة الأمد
                    </Link>
                  )}
                  <button
                    type="button"
                    className={styles.dangerLink}
                    onClick={() => void signOut()}
                  >
                    <Icon name="logout" size={17} />
                    تسجيل الخروج
                  </button>
                </div>
              )}
            </div>

            <button
              ref={mobileMenuButtonRef}
              className={joinClassNames(styles.iconButton, styles.mobileMenuButton)}
              type="button"
              aria-label="فتح فهرس الأقسام"
              aria-expanded={mobileOpen}
              aria-controls="section-index"
              onClick={() => {
                setOpenPopover(null);
                setMobileOpen(true);
              }}
            >
              <Icon name="menu" />
            </button>
          </div>
        </div>
        <div className={styles.mastheadRule} aria-hidden="true">
          <span />
        </div>
      </header>

      {mobileOpen && (
        <button
          className={styles.drawerBackdrop}
          type="button"
          aria-label="إغلاق فهرس الأقسام"
          aria-controls="section-index"
          onClick={() => closeMobileNavigation(true)}
        />
      )}

      <aside
        ref={indexPanelRef}
        id="section-index"
        className={joinClassNames(
          styles.sectionIndex,
          mobileOpen && styles.sectionIndexOpen,
        )}
        aria-label="فهرس سجل الإتقان"
        aria-hidden={isMobileViewport ? !mobileOpen : undefined}
        role={isMobileViewport ? "dialog" : undefined}
        aria-modal={isMobileViewport && mobileOpen ? true : undefined}
      >
        <div className={styles.drawerHeading}>
          <span>
            <small>منظومة المقياس</small>
            <strong>فهرس سجل الإتقان</strong>
          </span>
          <button
            ref={mobileCloseButtonRef}
            className={styles.iconButton}
            type="button"
            aria-label="إغلاق فهرس الأقسام"
            aria-controls="section-index"
            onClick={() => closeMobileNavigation(true)}
          >
            <Icon name="close" />
          </button>
        </div>

        <div className={styles.drawerContext}>
          <span className={styles.organizationAvatar} aria-hidden="true">
            {initial(activeOrganization?.name_ar, "ج")}
          </span>
          <span>
            <small>القيد المفتوح · {pageTitle}</small>
            <strong>{activeOrganization?.name_ar ?? "لا توجد جهة متاحة"}</strong>
            <span>{activeRoleLabel}</span>
          </span>
        </div>

        <div className={styles.indexLabel} aria-hidden="true">
          <span>فهرس الأقسام</span>
          <strong>{pageTitle}</strong>
        </div>

        <nav className={styles.indexNavigation} aria-label="التنقل الرئيسي">
          {context?.isPlatformOwner && (
            <Link
              href="/platform"
              className={joinClassNames(
                styles.indexLink,
                styles.platformIndexLink,
                active("/platform") && styles.indexLinkActive,
              )}
              aria-current={active("/platform") ? "page" : undefined}
              onClick={() => closeMobileNavigation()}
            >
              <span className={styles.indexNumber}>00</span>
              <Icon name="shield" size={18} />
              <span>منصة الأمد</span>
            </Link>
          )}
          {visibleNavigation.map((item, index) => {
            const isActive = active(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={joinClassNames(
                  styles.indexLink,
                  isActive && styles.indexLinkActive,
                )}
                aria-current={isActive ? "page" : undefined}
                onClick={() => closeMobileNavigation()}
              >
                <span className={styles.indexNumber}>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <Icon name={item.icon} size={18} />
                <span>{item.label}</span>
              </Link>
            );
          })}
          {access.status === "ready" &&
            !context?.isPlatformOwner &&
            !visibleNavigation.length && (
              <p className={styles.navigationEmpty}>
                لا يوجد نطاق وصول نشط لهذا الحساب.
              </p>
            )}
        </nav>

        <div className={styles.drawerFooter}>
          <div className={styles.drawerThemeControl}>
            <span>مظهر السجل</span>
            <ThemeToggle compact />
          </div>
          <div className={styles.permissionNote}>
            <Icon name="shield" size={15} />
            التنقل مضبوط حسب صلاحياتك
          </div>
          <Link
            href="/account"
            className={styles.drawerAccountLink}
            onClick={() => closeMobileNavigation()}
          >
            <span className={styles.accountAvatar} aria-hidden="true">
              {initial(userName, "ح")}
            </span>
            <span>
              <strong>{userName}</strong>
              <small>{activeRoleLabel}</small>
            </span>
            <Icon name="chevron" size={15} />
          </Link>
        </div>
      </aside>

      <main ref={mainAreaRef} className={styles.mainArea}>
        {(shellMessage || access.message) && (
          <p className={styles.shellStatus} role="alert">
            {shellMessage || access.message}
          </p>
        )}
        <span className={styles.visuallyHidden} role="status" aria-live="polite">
          {switchingOrganizationId ? "جارٍ تبديل الجهة الحالية" : ""}
        </span>
        <div id="main-content" className={styles.pageContent} tabIndex={-1}>
          {children}
        </div>
      </main>
    </div>
  );
}

export { PageHeader, StatusBadge, PrimaryButton } from "./shared-ui";
