type IconName =
  | "overview"
  | "programs"
  | "trainees"
  | "sessions"
  | "reports"
  | "certificates"
  | "settings"
  | "chevron"
  | "shield"
  | "source"
  | "clock";

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  const paths: Record<IconName, React.ReactNode> = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    programs: <><path d="M4 6.5 12 3l8 3.5-8 3.5-8-3.5Z" /><path d="M6.5 9v6.5c2.8 2.1 8.2 2.1 11 0V9" /></>,
    trainees: <><circle cx="12" cy="8" r="3.2" /><path d="M5.5 20c.8-4 3-6 6.5-6s5.7 2 6.5 6" /></>,
    sessions: <><path d="M5 4v16M19 4v16" /><path d="M8 7h7M8 12h9M8 17h5" /></>,
    reports: <><path d="M4 20V9m6 11V4m6 16v-7m4 7H2" /></>,
    certificates: <><path d="M6 3h12v11H6z" /><path d="m9 21 3-3 3 3v-7H9v7Z" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
    shield: <><path d="M12 3 4.5 6v5.2c0 4.4 3 7.7 7.5 9.8 4.5-2.1 7.5-5.4 7.5-9.8V6L12 3Z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></>,
    source: <><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="m8.2 10.8 7.6-3.6M8.2 13.2l7.6 3.6" /></>,
    clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></>,
  };

  return <svg {...common}>{paths[name]}</svg>;
}
