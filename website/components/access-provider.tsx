"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { RoleKey } from "../lib/auth/permissions";

export type ClientAccessOrganization = {
  id: string;
  slug: string;
  name_ar: string;
  name_en: string | null;
  logo_url: string | null;
  brand_color: string;
  status: "active" | "suspended" | "archived";
  role: RoleKey;
};

type ClientAccessContext = {
  user: {
    id: string;
    email: string | null;
    displayName: string;
  };
  isPlatformOwner: boolean;
  organizations: ClientAccessOrganization[];
  activeOrganizationId: string | null;
};

type AccessState = {
  status: "idle" | "loading" | "ready" | "error";
  context: ClientAccessContext | null;
  message: string;
};

type AccessContextValue = AccessState & {
  activeOrganization: ClientAccessOrganization | null;
  refresh: () => Promise<void>;
  selectOrganization: (organizationId: string) => Promise<boolean>;
};

const AccessContext = createContext<AccessContextValue | null>(null);

function isPublicPath(pathname: string) {
  return (
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/forgot-password" ||
    pathname === "/accept-invitation" ||
    pathname.startsWith("/t/") ||
    pathname === "/verify" ||
    pathname.startsWith("/verify/")
  );
}

export function AccessProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [state, setState] = useState<AccessState>({
    status: "idle",
    context: null,
    message: "",
  });

  const refresh = useCallback(async () => {
    if (isPublicPath(pathname)) {
      setState({ status: "idle", context: null, message: "" });
      return;
    }

    setState((current) => ({ ...current, status: "loading", message: "" }));

    try {
      const response = await fetch("/api/session/context", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const payload = (await response.json()) as
        | ClientAccessContext
        | { message?: string };

      if (!response.ok || !("user" in payload)) {
        setState({
          status: "error",
          context: null,
          message:
            "message" in payload && payload.message
              ? payload.message
              : "تعذر تحميل نطاق الوصول.",
        });
        return;
      }

      setState({ status: "ready", context: payload, message: "" });
    } catch {
      setState({
        status: "error",
        context: null,
        message: "تعذر الاتصال بخدمة نطاق الوصول.",
      });
    }
  }, [pathname]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectOrganization = useCallback(
    async (organizationId: string) => {
      try {
        const response = await fetch("/api/session/organization", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ organizationId }),
        });

        if (!response.ok) {
          const payload = (await response.json()) as { message?: string };
          setState((current) => ({
            ...current,
            message: payload.message ?? "تعذر تبديل الجهة.",
          }));
          return false;
        }

        setState((current) => ({
          ...current,
          context: current.context
            ? { ...current.context, activeOrganizationId: organizationId }
            : null,
          message: "",
        }));
        router.refresh();
        return true;
      } catch {
        setState((current) => ({
          ...current,
          message: "تعذر الاتصال أثناء تبديل الجهة.",
        }));
        return false;
      }
    },
    [router],
  );

  const activeOrganization = useMemo(
    () =>
      state.context?.organizations.find(
        (organization) =>
          organization.id === state.context?.activeOrganizationId,
      ) ?? null,
    [state.context],
  );
  const value = useMemo(
    () => ({
      ...state,
      activeOrganization,
      refresh,
      selectOrganization,
    }),
    [activeOrganization, refresh, selectOrganization, state],
  );

  return (
    <AccessContext.Provider value={value}>{children}</AccessContext.Provider>
  );
}

export function useAccess() {
  const context = useContext(AccessContext);

  if (!context) {
    throw new Error("useAccess must be used inside AccessProvider");
  }

  return context;
}
