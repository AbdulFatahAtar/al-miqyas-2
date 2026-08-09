"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState, type FormEvent } from "react";
import { Icon } from "./icons";
import { AuthFrame } from "./auth-frame";
import styles from "./auth-pages.module.css";

type JoinableOrganization = {
  slug: string;
  name_ar: string;
  logo_url: string | null;
  brand_color: string;
};

type RequestResult = {
  status: "accepted";
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
        status?: "accepted";
        message?: string;
      };

      if (!response.ok && response.status !== 202) {
        setErrorMessage(payload.message ?? "تعذر إرسال الطلب.");
        return;
      }

      setResult({
        status: payload.status ?? "accepted",
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
        <form className={styles.form} onSubmit={submit}>
          <ol className={styles.progress} aria-label="مراحل طلب الانضمام">
            <li className={styles.progressActive}><i>01</i><span>إرسال الطلب</span></li>
            <li><i>02</i><span>مراجعة الجهة</span></li>
            <li><i>03</i><span>استلام الدعوة</span></li>
          </ol>

          <fieldset className={styles.fieldset}>
            <legend>الجهة المطلوبة</legend>
            {isLoadingOrganizations ? (
              <div className={styles.loadingRows} aria-label="جارٍ تحميل الجهات" aria-busy="true">
                <span />
                <span />
                <span />
              </div>
            ) : organizations.length ? (
              <div className={styles.optionList}>
                {organizations.map((organization) => {
                  const selected =
                    selectedOrganization === organization.slug;

                  return (
                    <button
                      key={organization.slug}
                      type="button"
                      className={`${styles.option} ${selected ? styles.optionSelected : ""}`}
                      aria-pressed={selected}
                      disabled={isSubmitting}
                      onClick={() => {
                        setSelectedOrganization(organization.slug);
                        setErrorMessage("");
                      }}
                    >
                      <span
                        className={styles.optionMark}
                        style={{
                          borderColor: organization.brand_color,
                          color: organization.brand_color,
                        }}
                      >
                        {organization.logo_url ? (
                          <Image
                            src={organization.logo_url}
                            alt=""
                            width={36}
                            height={36}
                            unoptimized
                          />
                        ) : organization.name_ar.slice(0, 1)}
                      </span>
                      <span className={styles.optionCopy}>
                        <strong>{organization.name_ar}</strong>
                        <small>{selected ? "الجهة المختارة" : "متاحة للطلبات"}</small>
                      </span>
                      {selected ? (
                        <span className={styles.optionCheck}>
                          <Icon name="check" size={17} />
                        </span>
                      ) : <span aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className={styles.emptyRow}>
                <Icon name="warning" size={18} />
                لا توجد جهة متاحة للطلبات.
              </div>
            )}
          </fieldset>

          <div className={styles.formGrid}>
            <label className={styles.field} htmlFor="request-full-name">
              الاسم الكامل
              <input
                id="request-full-name"
                required
                minLength={2}
                maxLength={160}
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                autoComplete="name"
                placeholder="كما يظهر في بياناتك الرسمية"
              />
            </label>
            <label className={styles.field} htmlFor="request-email">
              البريد المؤسسي
              <span className={styles.inputWithIcon}>
                <Icon name="mail" size={18} />
                <input
                  id="request-email"
                  required
                  type="email"
                  maxLength={254}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  dir="ltr"
                  placeholder="name@organization.sa"
                />
              </span>
            </label>
          </div>

          <fieldset className={styles.fieldset}>
            <legend>الصلاحية المطلوبة</legend>
            <div className={styles.roleList}>
              <button
                type="button"
                className={`${styles.option} ${role === "trainer" ? styles.optionSelected : ""}`}
                aria-pressed={role === "trainer"}
                onClick={() => setRole("trainer")}
              >
                <span className={styles.optionMark}><Icon name="programs" size={19} /></span>
                <span className={styles.optionCopy}>
                  <strong>مدرّب</strong>
                  <small>إدارة البرامج والمتدرّبين والجلسات.</small>
                </span>
                {role === "trainer" ? <span className={styles.optionCheck}><Icon name="check" size={16} /></span> : <span aria-hidden="true" />}
              </button>
              <button
                type="button"
                className={`${styles.option} ${role === "viewer" ? styles.optionSelected : ""}`}
                aria-pressed={role === "viewer"}
                onClick={() => setRole("viewer")}
              >
                <span className={styles.optionMark}><Icon name="reports" size={19} /></span>
                <span className={styles.optionCopy}>
                  <strong>مراجع نتائج</strong>
                  <small>قراءة التقارير والنتائج دون تعديلها.</small>
                </span>
                {role === "viewer" ? <span className={styles.optionCheck}><Icon name="check" size={16} /></span> : <span aria-hidden="true" />}
              </button>
            </div>
          </fieldset>

          <label className={styles.consent}>
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

          <div className={styles.securityNote}>
            <Icon name="shield" size={18} />
            <span>
              إرسال الطلب لا ينشئ حسابًا ولا يمنح عضوية. مسؤول الجهة وحده
              يقرر القبول أو الرفض.
            </span>
          </div>

          {errorMessage && (
            <p className={styles.error} role="alert">{errorMessage}</p>
          )}

          <button
            className={`${styles.button} ${styles.buttonWide}`}
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
              <>
                إرسال طلب الوصول
                <span className={styles.arrowIcon}><Icon name="arrow" size={17} /></span>
              </>
            )}
          </button>
          <p className={styles.alternative}>
            لديك حساب؟ <Link href="/login">تسجيل الدخول</Link>
          </p>
        </form>
      ) : (
        <div className={styles.success}>
          <div className={styles.successHead}>
            <span className={styles.successIcon}>
              <Icon name="check" size={25} />
            </span>
            <div>
              <h3>تم استلام البيانات</h3>
              <p className={styles.successIntro}>{result.message}</p>
            </div>
          </div>

          <div className={styles.nextSteps}>
            <div className={styles.stepRow}>
              <i>01</i>
              <span><strong>مراجعة الطلب</strong><small>{selectedOrganizationName ?? "الجهة المختارة"}</small></span>
            </div>
            <div className={styles.stepRow}>
              <i>02</i>
              <span><strong>وصول الدعوة</strong><small>إلى البريد المؤسسي بعد الموافقة.</small></span>
            </div>
            <div className={styles.stepRow}>
              <i>03</i>
              <span><strong>تفعيل العضوية</strong><small>بعد فتح الرابط والتحقق من البريد.</small></span>
            </div>
          </div>

          <Link className={`${styles.button} ${styles.buttonSecondary} ${styles.buttonWide}`} href="/login">
            العودة إلى تسجيل الدخول
          </Link>
        </div>
      )}
    </AuthFrame>
  );
}
