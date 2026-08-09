"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Icon } from "./icons";
import { createSupabaseBrowserClient } from "../lib/supabase/client";
import { pagePermissionForPath } from "../lib/auth/permissions";
import { AuthFrame } from "./auth-frame";
import styles from "./auth-pages.module.css";

function safeNextPath(value: string | undefined) {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    return null;
  }
  if (value === "/account" || value === "/forbidden") return value;
  return pagePermissionForPath(value) ? value : null;
}

export function LoginPage({ nextPath }: { nextPath?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const requestedPath = safeNextPath(nextPath);

  const submitLogin = async (event: FormEvent) => {
    event.preventDefault();
    setErrorMessage("");
    setIsSubmitting(true);

    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error || !data.user) {
        setErrorMessage("تعذر تسجيل الدخول. تحقق من البريد وكلمة المرور.");
        return;
      }

      const [membershipResult, platformResult] = await Promise.all([
        supabase
          .from("memberships")
          .select("org_id")
          .eq("user_id", data.user.id)
          .eq("status", "active"),
        supabase.rpc("is_platform_admin"),
      ]);
      const memberships = membershipResult.data ?? [];
      const isPlatformOwner = platformResult.data === true;

      if (
        membershipResult.error ||
        platformResult.error ||
        (!memberships.length && !isPlatformOwner)
      ) {
        await supabase.auth.signOut();
        setErrorMessage("هذا الحساب لا يملك نطاق وصول نشطًا.");
        return;
      }

      if (isPlatformOwner) {
        router.replace(requestedPath ?? "/platform");
        router.refresh();
        return;
      }

      const { data: organizations, error: organizationsError } = await supabase
        .from("organizations")
        .select("id, slug, name_ar, status")
        .in(
          "id",
          memberships.map((membership) => membership.org_id),
        )
        .eq("status", "active");

      if (organizationsError || !organizations?.length) {
        await supabase.auth.signOut();
        setErrorMessage("تعذر التحقق من صلاحية الجهة لهذا الحساب.");
        return;
      }

      const activeOrganization = organizations[0];

      const organizationResponse = await fetch(
        "/api/session/organization",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ organizationId: activeOrganization.id }),
        },
      );

      if (!organizationResponse.ok) {
        await supabase.auth.signOut();
        setErrorMessage("تعذر تثبيت نطاق الجهة لهذا الحساب.");
        return;
      }

      router.replace(requestedPath ?? "/dashboard");
      router.refresh();
    } catch {
      setErrorMessage("تعذر الاتصال بخدمة الدخول. حاول مرة أخرى.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthFrame
      title="تسجيل الدخول"
      description="استخدم بريد الحساب وكلمة المرور التي أنشأتها في المنصة."
    >
      <form className={styles.form} onSubmit={submitLogin}>
        <label className={styles.field} htmlFor="login-email">
          البريد الإلكتروني
          <span className={styles.inputWithIcon}>
            <Icon name="mail" size={18} />
            <input
              id="login-email"
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              dir="ltr"
            />
          </span>
        </label>
        <label className={styles.field} htmlFor="login-password">
          كلمة المرور
          <input
            id="login-password"
            required
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            dir="ltr"
          />
        </label>
        {errorMessage && <p className={styles.error} role="alert">{errorMessage}</p>}
        <button
          className={`${styles.button} ${styles.buttonWide}`}
          type="submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? "جارٍ تسجيل الدخول..." : "تسجيل الدخول"}
          {!isSubmitting && (
            <span className={styles.arrowIcon}>
              <Icon name="arrow" size={17} />
            </span>
          )}
        </button>
        <p className={styles.alternative}>
          ليس لديك حساب؟ <Link href="/register">طلب الانضمام</Link>
        </p>
      </form>
    </AuthFrame>
  );
}
