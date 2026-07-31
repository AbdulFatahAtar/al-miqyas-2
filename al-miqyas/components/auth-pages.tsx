"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Icon } from "./icons";
import { createSupabaseBrowserClient } from "../lib/supabase/client";

function AuthFrame({
  children,
  title,
  description,
  wide = false,
}: {
  children: React.ReactNode;
  title: string;
  description: string;
  wide?: boolean;
}) {
  return (
    <main className="auth-page">
      <section className="auth-story">
        <div className="auth-brand"><img className="brand-mark" src="/brand/al-amad-mark.png" alt="شعار شركة الأمد" /><span><strong>منظومة المقياس</strong><small>شركة الأمد</small></span></div>
        <div className="auth-statement"><span>قياس · وضوح · ثقة</span><h1>كل نتيجة لها مصدر، وكل شهادة لها دليل.</h1><p>منصة تشغيلية تجمع القياس القبلي والأداء اللحظي والقياس البعدي تحت معرّف واحد.</p></div>
        <div className="auth-pipeline" aria-hidden="true"><i className="done" /><i className="done" /><i className="active" /><i /><i /></div>
      </section>
      <section className="auth-panel">
        <div className={wide ? "auth-panel-inner auth-panel-inner-wide" : "auth-panel-inner"}><div className="auth-mobile-brand"><img className="brand-mark" src="/brand/al-amad-mark.png" alt="شعار شركة الأمد" /><strong>منظومة المقياس</strong></div><header><span className="eyebrow">دخول آمن عبر البريد</span><h2>{title}</h2><p>{description}</p></header>{children}<footer><Link href="/verify/VER-AMD-7K9FQ">التحقق من شهادة</Link><span>·</span><Link href="/t/AMD-7K9FQ">صفحة المتدرّب</Link></footer></div>
      </section>
    </main>
  );
}

export function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

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

      const { data: memberships, error: membershipsError } = await supabase
        .from("memberships")
        .select("org_id")
        .eq("user_id", data.user.id)
        .eq("status", "active");

      if (membershipsError || !memberships?.length) {
        await supabase.auth.signOut();
        setErrorMessage("هذا الحساب غير مرتبط بعضوية نشطة في أي جهة.");
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

      window.localStorage.setItem(
        "miqyas-active-org",
        activeOrganization.slug,
      );
      router.replace("/dashboard");
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
      <form className="auth-form" onSubmit={submitLogin}>
        <label>البريد الإلكتروني<div className="input-with-icon"><Icon name="mail" size={18} /><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" dir="ltr" /></div></label>
        <label>كلمة المرور<input required type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" dir="ltr" /></label>
        {errorMessage && <p className="form-error" role="alert">{errorMessage}</p>}
        <button className="button button-primary button-wide" type="submit" disabled={isSubmitting}>{isSubmitting ? "جارٍ تسجيل الدخول..." : <>تسجيل الدخول <Icon name="arrow" size={17} /></>}</button>
        <p className="auth-alternative">ليس لديك حساب؟ <Link href="/register">طلب الانضمام</Link></p>
      </form>
    </AuthFrame>
  );
}

type JoinableOrganization = {
  slug: string;
  name_ar: string;
  logo_url: string | null;
  brand_color: string;
};

type RequestResult = {
  status: "created" | "duplicate";
  referenceCode?: string | null;
  message: string;
};

export function RegisterPage() {
  const [organizations, setOrganizations] = useState<JoinableOrganization[]>([]);
  const [selectedOrganization, setSelectedOrganization] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"trainer" | "viewer">("trainer");
  const [consent, setConsent] = useState(false);
  const [isLoadingOrganizations, setIsLoadingOrganizations] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [result, setResult] = useState<RequestResult | null>(null);

  useEffect(() => {
    const loadOrganizations = async () => {
      try {
        const response = await fetch("/api/public/organizations", {
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          organizations?: JoinableOrganization[];
          message?: string;
        };

        if (!response.ok || !payload.organizations?.length) {
          setErrorMessage(
            payload.message ?? "لا توجد جهة تستقبل طلبات انضمام حاليًا.",
          );
          return;
        }

        setOrganizations(payload.organizations);
        setSelectedOrganization(payload.organizations[0].slug);
      } catch {
        setErrorMessage("تعذر تحميل الجهات المتاحة. حاول تحديث الصفحة.");
      } finally {
        setIsLoadingOrganizations(false);
      }
    };

    void loadOrganizations();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setErrorMessage("");

    if (!selectedOrganization || !consent) {
      setErrorMessage("اختر الجهة ووافق على استخدام البيانات قبل الإرسال.");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/public/access-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationSlug: selectedOrganization,
          fullName,
          email,
          role,
          consent,
        }),
      });
      const payload = (await response.json()) as {
        status?: "created" | "duplicate";
        referenceCode?: string | null;
        message?: string;
      };

      if (!response.ok && response.status !== 202) {
        setErrorMessage(payload.message ?? "تعذر إرسال الطلب.");
        return;
      }

      setResult({
        status: payload.status ?? "created",
        referenceCode: payload.referenceCode,
        message:
          payload.message ??
          "تم استلام الطلب وإحالته إلى مسؤول الجهة للمراجعة.",
      });
    } catch {
      setErrorMessage("تعذر الاتصال بخدمة الطلبات. حاول مرة أخرى.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedOrganizationName = organizations.find(
    (organization) => organization.slug === selectedOrganization,
  )?.name_ar;

  return (
    <AuthFrame
      title={result ? "تم استلام الطلب" : "طلب وصول مؤسسي"}
      description={
        result
          ? "لن يُنشأ الحساب قبل مراجعة مسؤول الجهة."
          : "أرسل بياناتك إلى الجهة المطلوبة. الموافقة لا تتم تلقائيًا."
      }
      wide
    >
      {!result ? (
        <form className="auth-form access-request-form" onSubmit={submit}>
          <div className="request-progress" aria-label="مراحل طلب الانضمام">
            <span className="active"><i>1</i>إرسال الطلب</span>
            <span><i>2</i>مراجعة الجهة</span>
            <span><i>3</i>استلام الدعوة</span>
          </div>

          <fieldset className="request-fieldset">
            <legend>الجهة المطلوبة</legend>
            {isLoadingOrganizations ? (
              <div className="request-org-skeleton" aria-label="جارٍ تحميل الجهات">
                <i />
                <i />
                <i />
              </div>
            ) : organizations.length ? (
              <div className="request-org-grid">
                {organizations.map((organization) => {
                  const selected =
                    selectedOrganization === organization.slug;

                  return (
                    <button
                      key={organization.slug}
                      type="button"
                      className={selected ? "selected" : ""}
                      aria-pressed={selected}
                      disabled={isSubmitting}
                      onClick={() => {
                        setSelectedOrganization(organization.slug);
                        setErrorMessage("");
                      }}
                    >
                      {organization.logo_url ? (
                        <img
                          src={organization.logo_url}
                          alt=""
                        />
                      ) : (
                        <span
                          style={{
                            borderColor: organization.brand_color,
                            color: organization.brand_color,
                          }}
                        >
                          {organization.name_ar.slice(0, 1)}
                        </span>
                      )}
                      <strong>{organization.name_ar}</strong>
                      <small>
                        {selected ? "الجهة المختارة" : "متاحة للطلبات"}
                      </small>
                      {selected && <Icon name="check" size={16} />}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="request-load-error">
                <Icon name="warning" size={18} />
                لا توجد جهة متاحة للطلبات.
              </div>
            )}
          </fieldset>

          <div className="request-form-grid">
            <label>
              الاسم الكامل
              <input
                required
                minLength={2}
                maxLength={160}
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                autoComplete="name"
                placeholder="كما يظهر في بياناتك الرسمية"
              />
            </label>
            <label>
              البريد المؤسسي
              <div className="input-with-icon">
                <Icon name="mail" size={18} />
                <input
                  required
                  type="email"
                  maxLength={254}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  dir="ltr"
                  placeholder="name@organization.sa"
                />
              </div>
            </label>
          </div>

          <fieldset className="request-fieldset">
            <legend>الصلاحية المطلوبة</legend>
            <div className="request-role-grid">
              <button
                type="button"
                className={role === "trainer" ? "selected" : ""}
                aria-pressed={role === "trainer"}
                onClick={() => setRole("trainer")}
              >
                <span><Icon name="programs" size={19} /></span>
                <strong>مدرّب</strong>
                <small>إدارة البرامج والمتدرّبين والجلسات.</small>
              </button>
              <button
                type="button"
                className={role === "viewer" ? "selected" : ""}
                aria-pressed={role === "viewer"}
                onClick={() => setRole("viewer")}
              >
                <span><Icon name="reports" size={19} /></span>
                <strong>مراجع نتائج</strong>
                <small>قراءة التقارير والنتائج دون تعديلها.</small>
              </button>
            </div>
          </fieldset>

          <label className="request-consent">
            <input
              required
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>
              أوافق على استخدام اسمي وبريدي لغرض مراجعة طلب الوصول والتواصل
              بشأنه فقط.
            </span>
          </label>

          <div className="request-security-note">
            <Icon name="shield" size={18} />
            <span>
              إرسال الطلب لا ينشئ حسابًا ولا يمنح عضوية. مسؤول الجهة وحده
              يقرر القبول أو الرفض.
            </span>
          </div>

          {errorMessage && (
            <p className="form-error" role="alert">{errorMessage}</p>
          )}

          <button
            className="button button-primary button-wide"
            type="submit"
            disabled={
              isSubmitting ||
              isLoadingOrganizations ||
              !organizations.length
            }
          >
            {isSubmitting ? (
              "جارٍ إرسال الطلب..."
            ) : (
              <>إرسال طلب الوصول <Icon name="arrow" size={17} /></>
            )}
          </button>
          <p className="auth-alternative">
            لديك حساب؟ <Link href="/login">تسجيل الدخول</Link>
          </p>
        </form>
      ) : (
        <div className="request-success">
          <span className="request-success-icon">
            <Icon name={result.status === "created" ? "check" : "clock"} size={28} />
          </span>
          <h3>
            {result.status === "created"
              ? "وصل الطلب إلى الجهة"
              : "الطلب موجود وقيد المعالجة"}
          </h3>
          <p>{result.message}</p>

          {result.referenceCode && (
            <div className="request-reference">
              <span>الرقم المرجعي</span>
              <strong dir="ltr">{result.referenceCode}</strong>
              <small>احتفظ به عند التواصل مع مسؤول الجهة.</small>
            </div>
          )}

          <div className="request-next-steps">
            <article>
              <i>1</i>
              <span>
                <strong>مراجعة الطلب</strong>
                <small>{selectedOrganizationName ?? "الجهة المختارة"}</small>
              </span>
            </article>
            <article>
              <i>2</i>
              <span>
                <strong>وصول الدعوة</strong>
                <small>إلى البريد المؤسسي بعد الموافقة.</small>
              </span>
            </article>
            <article>
              <i>3</i>
              <span>
                <strong>تفعيل العضوية</strong>
                <small>بعد فتح الرابط والتحقق من البريد.</small>
              </span>
            </article>
          </div>

          <Link className="button button-secondary button-wide" href="/login">
            العودة إلى تسجيل الدخول
          </Link>
        </div>
      )}
    </AuthFrame>
  );
}
