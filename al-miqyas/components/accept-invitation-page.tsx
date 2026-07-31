"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createSupabaseBrowserClient } from "../lib/supabase/client";
import { Icon } from "./icons";
import { ThemeToggle } from "./theme-toggle";

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
    <main className="invitation-page">
      <section className="invitation-aside">
        <div className="auth-brand">
          <img
            className="brand-mark"
            src="/brand/al-amad-mark.png"
            alt="شعار شركة الأمد"
          />
          <span>
            <strong>منظومة المقياس</strong>
            <small>دعوة وصول موثقة</small>
          </span>
        </div>
        <div className="invitation-aside-copy">
          <span>وصول مؤسسي آمن</span>
          <h1>عضويتك تبدأ بعد إثبات ملكية البريد.</h1>
          <p>
            لا تُفعّل الصلاحيات إلا بعد مطابقة البريد المدعو وحفظ كلمة المرور
            وقبول الدعوة.
          </p>
        </div>
        <div className="invitation-assurance">
          <Icon name="shield" size={20} />
          <span>الرابط صالح لمرة واحدة وينتهي بعد 72 ساعة.</span>
        </div>
      </section>

      <section className="invitation-main">
        <div className="auth-theme-control"><ThemeToggle compact /></div>
        <div className="invitation-card">
          {state === "checking" && (
            <div className="invitation-state">
              <span className="invitation-state-icon loading">
                <Icon name="clock" size={27} />
              </span>
              <h2>جارٍ التحقق من الدعوة</h2>
              <p>نتأكد من جلسة البريد والرابط قبل إظهار التفعيل.</p>
            </div>
          )}

          {state === "invalid" && (
            <div className="invitation-state">
              <span className="invitation-state-icon error">
                <Icon name="warning" size={27} />
              </span>
              <h2>تعذر التحقق من الرابط</h2>
              <p>
                افتح رابط الدعوة الكامل من البريد. إذا انتهت صلاحيته فاطلب من
                مسؤول الجهة إعادة إرساله.
              </p>
              <Link className="button button-secondary button-wide" href="/login">
                الذهاب إلى تسجيل الدخول
              </Link>
            </div>
          )}

          {state === "ready" && (
            <>
              <header className="invitation-card-head">
                <span className="eyebrow">الخطوة الأخيرة</span>
                <h2>أنشئ كلمة المرور وفعّل عضويتك</h2>
                <p>
                  الدعوة مرتبطة بالبريد التالي ولا يمكن نقلها إلى حساب آخر.
                </p>
              </header>

              <div className="invitation-email">
                <Icon name="mail" size={18} />
                <span>
                  <small>البريد المدعو</small>
                  <strong dir="ltr">{email}</strong>
                </span>
                <Icon name="check" size={17} />
              </div>

              <form className="auth-form invitation-form" onSubmit={submit}>
                <label>
                  كلمة المرور الجديدة
                  <input
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
                <label>
                  تأكيد كلمة المرور
                  <input
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
                  <p className="form-error" role="alert">{errorMessage}</p>
                )}

                <button
                  className="button button-primary button-wide"
                  type="submit"
                  disabled={isSubmitting}
                >
                  {isSubmitting
                    ? "جارٍ تفعيل العضوية..."
                    : <>تفعيل العضوية <Icon name="arrow" size={17} /></>}
                </button>
              </form>
            </>
          )}

          {state === "completed" && (
            <div className="invitation-state">
              <span className="invitation-state-icon success">
                <Icon name="check" size={30} />
              </span>
              <h2>تم تفعيل العضوية</h2>
              <p>
                أصبحت صلاحيتك نشطة داخل الجهة ويمكنك الدخول إلى لوحة التشغيل.
              </p>
              <Link
                className="button button-primary button-wide"
                href="/dashboard"
              >
                الدخول إلى لوحة التشغيل
                <Icon name="arrow" size={17} />
              </Link>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
