"use client";

import { Icon, type IconName } from "./icons";
import { useTheme, type ThemePreference } from "./theme-provider";

const options: Array<{
  value: ThemePreference;
  label: string;
  icon: IconName;
}> = [
  { value: "light", label: "فاتح", icon: "sun" },
  { value: "dark", label: "داكن", icon: "moon" },
  { value: "system", label: "النظام", icon: "monitor" },
];

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { preference, setPreference } = useTheme();

  return (
    <div
      className={compact ? "theme-toggle theme-toggle-compact" : "theme-toggle"}
      role="group"
      aria-label="مظهر الموقع"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={preference === option.value ? "selected" : ""}
          aria-pressed={preference === option.value}
          aria-label={`استخدام الوضع ${option.label}`}
          title={`الوضع ${option.label}`}
          onClick={() => setPreference(option.value)}
        >
          <Icon name={option.icon} size={16} />
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}
