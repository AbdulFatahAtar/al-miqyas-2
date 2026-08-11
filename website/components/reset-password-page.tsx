"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AuthFrame } from "./auth-frame";
import { Icon } from "./icons";
import { createSupabaseBrowserClient } from "../lib/supabase/client";
import styles from "./auth-pages.module.css";

type RecoveryState = "checking" | "ready" | "invalid" | "saved";

export function ResetPasswordPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [state, setState] = useState<RecoveryState>("checking");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let active = true;

    void supabase.auth
      .getUser()
      .then(({ data, error }) => {
        if (active) {
          setState(!error && data.user ? "ready" : "invalid");
        }
      })
      .catch(() => {
        if (active) setState("invalid");
      });

    return () => {
      active = false;
    };
  }, [supabase]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");

    if (password.length < 10) {
      setErrorMessage("كلمة المرور يجب أن تتكون من 10 أحرف على الأقل.");
      return;
    }

    if (password !== passwordConfirmation) {
      setErrorMessage("تأكيد كلمة المرور غير مطابق.");
      return;
    }

    setIsSubmitting(true);

    try {
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        setErrorMessage("تعذر حفظ كلمة المرور. اطلب رابط إعادة تعيين جديدًا.");
        return;
      }

      setState("saved");
      const { error: signOutError } = await supabase.auth.signOut();

      if (signOutError) {
        setErrorMessage(
          "تم تغيير كلمة المرور، لكن تعذر إنهاء الجلسة الحالية. أغلق المتصفح ثم سجّل الدخول بالكلمة الجديدة.",
        );
        return;
      }

      window.location.assign("/login?reset=success");
    } catch {
      setErrorMessage("تعذر الاتصال بخدمة المصادقة. حاول مرة أخرى.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthFrame
      title="تعيين كلمة مرور جديدة"
      description="احفظ كلمة جديدة للحساب الذي فتح رابط الاستعادة من بريده."
    >
      {state === "checking" && (
        <div className={styles.securityNote} aria-live="polite">
          <Icon name="shield" size={18} />
          <span>جارٍ التحقق من رابط الاستعادة...</span>
        </div>
      )}

      {state === "invalid" && (
        <section className={styles.success}>
          <p className={styles.error} role="alert">
            رابط الاستعادة غير صالح أو انتهت جلسته. اطلب رابطًا جديدًا.
          </p>
          <Link
            className={`${styles.button} ${styles.buttonSecondary} ${styles.buttonWide}`}
            href="/forgot-password"
          >
            طلب رابط جديد
          </Link>
        </section>
      )}

      {(state === "ready" || state === "saved") && (
        <form className={styles.form} onSubmit={submit}>
          <label className={styles.field} htmlFor="new-password">
            كلمة المرور الجديدة
            <input
              id="new-password"
              required
              minLength={10}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              dir="ltr"
            />
            <small className={styles.fieldHint}>10 أحرف على الأقل.</small>
          </label>
          <label className={styles.field} htmlFor="new-password-confirmation">
            تأكيد كلمة المرور
            <input
              id="new-password-confirmation"
              required
              minLength={10}
              type="password"
              value={passwordConfirmation}
              onChange={(event) => setPasswordConfirmation(event.target.value)}
              autoComplete="new-password"
              dir="ltr"
            />
          </label>
          {errorMessage && (
            <p
              className={state === "saved" ? styles.successMessage : styles.error}
              role={state === "saved" ? "status" : "alert"}
            >
              {errorMessage}
            </p>
          )}
          <button
            className={`${styles.button} ${styles.buttonWide}`}
            type="submit"
            disabled={isSubmitting || state === "saved"}
          >
            {isSubmitting ? "جارٍ حفظ كلمة المرور..." : "حفظ كلمة المرور الجديدة"}
          </button>
        </form>
      )}
    </AuthFrame>
  );
}
