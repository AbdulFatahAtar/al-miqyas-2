import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./app-shell.module.css";

/* ─── helpers ─── */

function joinClassNames(...classNames: Array<string | undefined | false>) {
  return classNames.filter(Boolean).join(" ");
}

const badgeToneStyles = {
  success: styles.badgeSuccess,
  warning: styles.badgeWarning,
  danger: styles.badgeDanger,
  system: styles.badgeSystem,
  muted: styles.badgeMuted,
} as const;

/* ─── StatusBadge ─── */

export type BadgeTone = "success" | "warning" | "danger" | "system" | "muted";

export function StatusBadge({
  tone,
  children,
}: {
  tone: BadgeTone;
  children: ReactNode;
}) {
  return (
    <span className={joinClassNames(styles.statusBadge, badgeToneStyles[tone])}>
      <i aria-hidden="true" />
      {children}
    </span>
  );
}

/* ─── PageHeader ─── */

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className={styles.pageHeader}>
      <div className={styles.pageHeadingCopy}>
        {eyebrow && <span className={styles.eyebrow}>{eyebrow}</span>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className={styles.pageActions}>{actions}</div>}
    </header>
  );
}

/* ─── PrimaryButton ─── */

export function PrimaryButton({
  children,
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      type={type}
      className={joinClassNames(styles.primaryButton, className)}
    >
      {children}
    </button>
  );
}
