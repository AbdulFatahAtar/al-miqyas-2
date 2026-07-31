import type { ReactNode } from "react";

export type IconName =
  | "overview"
  | "programs"
  | "trainees"
  | "sessions"
  | "reports"
  | "certificates"
  | "organizations"
  | "settings"
  | "account"
  | "bell"
  | "search"
  | "plus"
  | "chevron"
  | "arrow"
  | "shield"
  | "source"
  | "clock"
  | "close"
  | "menu"
  | "filter"
  | "download"
  | "external"
  | "check"
  | "warning"
  | "mail"
  | "lock"
  | "qr"
  | "edit"
  | "logout";

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  const paths: Record<IconName, ReactNode> = {
    overview: <><path d="M4 4h6v6H4zM14 4h6v3h-6zM14 11h6v9h-6zM4 14h6v6H4z" /></>,
    programs: <><path d="m4 7 8-4 8 4-8 4-8-4Z" /><path d="M6.5 10v6c3 2.3 8 2.3 11 0v-6" /></>,
    trainees: <><circle cx="12" cy="8" r="3.2" /><path d="M5 20c.9-4.2 3.2-6.2 7-6.2s6.1 2 7 6.2" /></>,
    sessions: <><path d="M5 5v14M19 5v14" /><path d="M8.5 7h6M8.5 12H17M8.5 17h4" /></>,
    reports: <><path d="M4 20V10m5 10V5m6 15v-8m5 8H2" /></>,
    certificates: <><path d="M6 3h12v11H6z" /><path d="m9 21 3-3 3 3v-7H9v7Z" /><path d="M9 7h6M9 10h4" /></>,
    organizations: <><path d="M4 20V8l8-4 8 4v12" /><path d="M8 20v-7h8v7M8 9h.01M12 9h.01M16 9h.01" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3A1.7 1.7 0 0 0 14 21v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9A1.7 1.7 0 0 0 21 10h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
    account: <><circle cx="12" cy="8" r="3" /><path d="M6 20v-2c0-2.5 2.2-4 6-4s6 1.5 6 4v2" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 8h18c0-1-3-1-3-8" /><path d="M10 20h4" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    chevron: <path d="m9 18 6-6-6-6" />,
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    shield: <><path d="M12 3 4.5 6v5.2c0 4.4 3 7.7 7.5 9.8 4.5-2.1 7.5-5.4 7.5-9.8V6L12 3Z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></>,
    source: <><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="m8.2 10.8 7.6-3.6M8.2 13.2l7.6 3.6" /></>,
    clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    filter: <path d="M4 6h16M7 12h10M10 18h4" />,
    download: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5M5 21h14" /></>,
    external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 13v6H5V6h6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    warning: <><path d="M12 3 2.8 20h18.4L12 3Z" /><path d="M12 9v5M12 17h.01" /></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    qr: <><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z" /><path d="M14 14h2v2h-2zM18 14h2v6h-2zM14 18h2v2h-2z" /></>,
    edit: <><path d="M4 20h4l11-11-4-4L4 16v4Z" /><path d="m13 7 4 4M4 20l4-1" /></>,
    logout: <><path d="M10 5H5v14h5" /><path d="M13 8l4 4-4 4M8 12h9" /></>,
  };

  return <svg {...common}>{paths[name]}</svg>;
}
