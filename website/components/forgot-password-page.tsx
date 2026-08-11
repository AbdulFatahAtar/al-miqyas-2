"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { AuthFrame } from "./auth-frame";
import { Icon } from "./icons";
import { createSupabaseBrowserClient } from "../lib/supabase/client";
import styles from "./auth-pages.module.css";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");
    setIsSubmitting(true);

    try {
      const callbackUrl = new URL("/auth/callback", window.location.origin);
      callbackUrl.searchParams.set("next", "/reset-password");
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.resetPasswordForEmail(
        email.trim().toLowerCase(),
        { redirectTo: callbackUrl.toString() },
      );

      if (error) {
        // Keep the public response account-agnostic. Supabase Auth applies its
        // own email rate limits and must not become an account lookup oracle.
        console.error(
          "Password reset request was not dispatched.",
          error.message,
        );
      }

      setIsSent(true);
    } catch {
      setErrorMessage("تعذر الاتصال بخدمة استعادة كلمة المرور. حاول مرة أخرى.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthFrame
      title="استعادة كلمة المرور"
      description="أدخل بريد حسابك وسنرسل رابطًا آمنًا لتعيين كلمة مرور جديدة."
    >
      {isSent ? (
        <section className={styles.success} aria-live="polite">
          <div className={styles.successHead}>
            <span className={styles.successIcon}>
              <Icon name="mail" size={23} />
            </span>
            <div>
              <h3>راجع بريدك الإلكتروني</h3>
              <p className={styles.successIntro}>
                إذا كان البريد مرتبطًا بحساب، فستصله رسالة إعادة التعيين. لا نكشف
                وجود الحساب من هذه الصفحة.
              </p>
            </div>
          </div>
          <Link
            className={`${styles.button} ${styles.buttonSecondary} ${styles.buttonWide}`}
            href="/login"
          >
            العودة إلى تسجيل الدخول
          </Link>
        </section>
      ) : (
        <form className={styles.form} onSubmit={submit}>
          <label className={styles.field} htmlFor="recovery-email">
            البريد الإلكتروني
            <span className={styles.inputWithIcon}>
              <Icon name="mail" size={18} />
              <input
                id="recovery-email"
                required
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                dir="ltr"
              />
            </span>
          </label>
          <div className={styles.securityNote}>
            <Icon name="shield" size={18} />
            <span>
              الرابط مخصص للبريد المطلوب، ويجب فتحه من الرسالة قبل تغيير كلمة
              المرور.
            </span>
          </div>
          {errorMessage && (
            <p className={styles.error} role="alert">
              {errorMessage}
            </p>
          )}
          <button
            className={`${styles.button} ${styles.buttonWide}`}
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? "جارٍ إرسال الرابط..." : "إرسال رابط إعادة التعيين"}
          </button>
          <p className={styles.alternative}>
            تذكرت كلمة المرور؟ <Link href="/login">العودة إلى الدخول</Link>
          </p>
        </form>
      )}
    </AuthFrame>
  );
}
