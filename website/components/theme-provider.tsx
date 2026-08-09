"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { THEME_DARK_QUERY, THEME_STORAGE_KEY } from "../lib/theme";

export type ThemePreference = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

type ThemeContextValue = {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isThemePreference(value: string | null): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== "system") {
    return preference;
  }

  return window.matchMedia(THEME_DARK_QUERY).matches ? "dark" : "light";
}

function applyTheme(preference: ThemePreference) {
  const resolvedTheme = resolveTheme(preference);
  const root = document.documentElement;

  root.classList.add("theme-switching");
  root.dataset.theme = resolvedTheme;
  root.dataset.themePreference = preference;
  root.style.colorScheme = resolvedTheme;

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => root.classList.remove("theme-switching"));
  });

  return resolvedTheme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] =
    useState<ThemePreference>("system");
  const [resolvedTheme, setResolvedTheme] =
    useState<ResolvedTheme>("light");
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let storedPreference = document.documentElement.dataset.themePreference ?? null;

    if (!isThemePreference(storedPreference)) {
      try {
        storedPreference = window.localStorage.getItem(THEME_STORAGE_KEY);
      } catch {
        // The system preference remains the safe fallback when storage is blocked.
      }
    }

    const initialPreference = isThemePreference(storedPreference)
      ? storedPreference
      : "system";

    setPreferenceState(initialPreference);
    setResolvedTheme(applyTheme(initialPreference));
    setIsReady(true);
  }, []);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    if (preference !== "system") {
      setResolvedTheme(applyTheme(preference));
      return;
    }

    const mediaQuery = window.matchMedia(THEME_DARK_QUERY);
    const syncSystemTheme = () => setResolvedTheme(applyTheme("system"));

    syncSystemTheme();
    mediaQuery.addEventListener("change", syncSystemTheme);

    return () => mediaQuery.removeEventListener("change", syncSystemTheme);
  }, [isReady, preference]);

  const setPreference = useCallback((nextPreference: ThemePreference) => {
    setPreferenceState(nextPreference);

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextPreference);
    } catch {
      // Theme switching still works for the current session without storage.
    }

    setResolvedTheme(applyTheme(nextPreference));
  }, []);

  const value = useMemo(
    () => ({ preference, resolvedTheme, setPreference }),
    [preference, resolvedTheme, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used inside ThemeProvider");
  }

  return context;
}
