"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createSupabaseBrowserClient } from "../lib/supabase/client";
import { Icon } from "./icons";
import { ThemeToggle } from "./theme-toggle";
import styles from "./accept-invitation-page.module.css";

type InvitationState = "checking" | "ready" | "invalid" | "completed";

export function AcceptInvitationPage({
  requestId,
  token,
}: {
  requestId: string;
  token: string;
}) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [state, setState] = useState<InvitationState>("checking");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!requestId || !token) {
      setState("invalid");
      return;
    }

    let active = true;

    const applySession = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!active) {
        return;
      }

      if (user) {
        setEmail(user.email ?? "");
        setState("ready");
      }
    };

    void applySession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) {
        return;
      }

      if (session?.user) {
        setEmail(session.user.email ?? "");
        setState("ready");
      }
    });

    const timer = window.setTimeout(() => {
      if (active) {
        setState((current) => current === "checking" ? "invalid" : current);
      }
    }, 5000);

    return () => {
      active = false;
      window.clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, [requestId, supabase, token]);

  const submit = async (event: FormEvent) => {
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
      const { error: passwordError } = await supabase.auth.updateUser({
        password,
      });

      if (passwordError) {
        setErrorMessage(
          "تعذر حفظ كلمة المرور. افتح رابط الدعوة الأصلي مرة أخرى.",
        );
        return;
      }

      const response = await fetch("/api/access-requests/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, token }),
      });
      const payload = (await response.json()) as {
        message?: string;
        organizationSlug?: string | null;
      };

      if (!response.ok) {
        setErrorMessage(payload.message ?? "تعذر تفعيل العضوية.");
        return;
      }

      if (payload.organizationSlug) {
        window.localStorage.setItem(
          "miqyas-active-org",
          payload.organizationSlug,
        );
      }

      setState("completed");
    } catch {
      setErrorMessage("تعذر الاتصال بالخادم. حاول مرة أخرى.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className={styles.page}>
      <aside className={styles.aside} aria-label="تعريف دعوة الوصول">
        <div className={styles.brand}>
          <Image
            src="/brand/al-amad-mark-transparent.png"
            alt="شعار شركة الأمد"
            width={48}
            height={48}
          />
          <span>
            <strong>منظومة المقياس</strong>
            <small>دعوة وصول موثقة</small>
          </span>
        </div>

        <div className={styles.asideCopy}>
          <span className={styles.recordCode} dir="ltr">INVITATION / ACCESS</span>
          <h1>عضويتك تبدأ بعد إثبات ملكية البريد.</h1>
          <p>
            لا تُفعّل الصلاحيات إلا بعد مطابقة البريد المدعو وحفظ كلمة المرور
            وقبول الدعوة.
          </p>
          <ol className={styles.protocol} aria-label="خطوات تفعيل الدعوة">
            <li><i>01</i><strong>التحقق من جلسة البريد</strong></li>
            <li><i>02</i><strong>حفظ كلمة المرور</strong></li>
            <li><i>03</i><strong>تفعيل عضوية الجهة</strong></li>
          </ol>
        </div>

        <div className={styles.assurance}>
          <Icon name="shield" size={20} />
          <span>الرابط صالح لمرة واحدة وينتهي بعد 72 ساعة.</span>
        </div>
      </aside>

      <section className={styles.main}>
        <header className={styles.bar}><ThemeToggle compact /></header>
        <div className={styles.sheet} aria-live="polite">
          {state === "checking" && (
            <div className={styles.state} aria-busy="true">
              <span className={`${styles.stateIcon} ${styles.checking}`}>
                <Icon name="clock" size={27} />
              </span>
              <h2>جارٍ التحقق من الدعوة</h2>
              <p>نتأكد من جلسة البريد والرابط قبل إظهار التفعيل.</p>
            </div>
          )}

          {state === "invalid" && (
            <div className={styles.state}>
              <span className={`${styles.stateIcon} ${styles.invalid}`}>
                <Icon name="warning" size={27} />
              </span>
              <h2>تعذر التحقق من الرابط</h2>
              <p>
                افتح رابط الدعوة الكامل من البريد. إذا انتهت صلاحيته فاطلب من
                مسؤول الجهة إعادة إرساله.
              </p>
              <Link className={`${styles.button} ${styles.buttonSecondary} ${styles.wide}`} href="/login">
                الذهاب إلى تسجيل الدخول
              </Link>
            </div>
          )}

          {state === "ready" && (
            <>
              <header className={styles.head}>
                <span className={styles.kicker}>الخطوة الأخيرة</span>
                <h2>أنشئ كلمة المرور وفعّل عضويتك</h2>
                <p>
                  الدعوة مرتبطة بالبريد التالي ولا يمكن نقلها إلى حساب آخر.
                </p>
              </header>

              <div className={styles.email}>
                <Icon name="mail" size={18} />
                <span>
                  <small>البريد المدعو</small>
                  <strong dir="ltr">{email}</strong>
                </span>
                <Icon name="check" size={17} />
              </div>

              <form className={styles.form} onSubmit={submit}>
                <label className={styles.field} htmlFor="invitation-password">
                  كلمة المرور الجديدة
                  <input
                    id="invitation-password"
                    required
                    minLength={10}
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="new-password"
                    dir="ltr"
                  />
                  <small>10 أحرف على الأقل.</small>
                </label>
                <label className={styles.field} htmlFor="invitation-password-confirmation">
                  تأكيد كلمة المرور
                  <input
                    id="invitation-password-confirmation"
                    required
                    minLength={10}
                    type="password"
                    value={passwordConfirmation}
                    onChange={(event) =>
                      setPasswordConfirmation(event.target.value)
                    }
                    autoComplete="new-password"
                    dir="ltr"
                  />
                </label>

                {errorMessage && (
                  <p className={styles.error} role="alert">{errorMessage}</p>
                )}

                <button
                  className={`${styles.button} ${styles.wide}`}
                  type="submit"
                  disabled={isSubmitting}
                >
                  {isSubmitting
                    ? "جارٍ تفعيل العضوية..."
                    : <>
                        تفعيل العضوية
                        <span className={styles.arrow}><Icon name="arrow" size={17} /></span>
                      </>}
                </button>
              </form>
            </>
          )}

          {state === "completed" && (
            <div className={styles.state}>
              <span className={`${styles.stateIcon} ${styles.completed}`}>
                <Icon name="check" size={30} />
              </span>
              <h2>تم تفعيل العضوية</h2>
              <p>
                أصبحت صلاحيتك نشطة داخل الجهة ويمكنك الدخول إلى لوحة التشغيل.
              </p>
              <Link
                className={`${styles.button} ${styles.wide}`}
                href="/dashboard"
              >
                الدخول إلى لوحة التشغيل
                <span className={styles.arrow}><Icon name="arrow" size={17} /></span>
              </Link>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
