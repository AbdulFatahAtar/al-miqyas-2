"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Icon } from "./icons";
import { ThemeToggle } from "./theme-toggle";
import styles from "./public-evidence.module.css";

const verificationCodePattern = /^[A-Z0-9][A-Z0-9-]{5,95}$/;

export function VerificationLookupPage() {
  const router = useRouter();
  const [verificationCode, setVerificationCode] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedCode = verificationCode.trim().toUpperCase();

    if (!verificationCodePattern.test(normalizedCode)) {
      setErrorMessage(
        "أدخل رمز التحقق كاملًا كما يظهر في الشهادة، من دون مسافات.",
      );
      return;
    }

    setErrorMessage("");
    router.push(`/verify/${encodeURIComponent(normalizedCode)}`);
  }

  return (
    <main className={styles.page}>
      <PublicEvidenceMasthead />

      <article className={styles.document} aria-labelledby="lookup-title">
        <header className={styles.documentHead}>
          <div>
            <span className={styles.documentClass}>
              سجل إثبات عام · تحقق مستقل
            </span>
            <h1 id="lookup-title">افحص سجل الشهادة، لا صورتها.</h1>
            <p>
              النتيجة هنا تصدر من سجل الشهادات مباشرة وتعرض الحد الأدنى
              اللازم لإثبات الحالة والجهة المصدرة، من دون كشف بيانات
              تشغيلية داخلية.
            </p>
          </div>
          <div className={styles.recordId} aria-label="تصنيف الوثيقة">
            <small>نوع السجل</small>
            <strong dir="ltr">PUBLIC / VERIFY</strong>
          </div>
        </header>

        <div className={styles.lookupBody}>
          <section className={styles.lookupProtocol} aria-labelledby="protocol-title">
            <h2 id="protocol-title">بروتوكول المطابقة</h2>
            <ol className={styles.lookupSteps}>
              <li>
                <span>
                  <strong>أدخل رمز التحقق</strong>
                  <small>انسخه من الشهادة أو استخدم الرابط داخل رمز الاستجابة.</small>
                </span>
              </li>
              <li>
                <span>
                  <strong>طابق سجل الإصدار</strong>
                  <small>راجع الجهة والبرنامج ورقم الشهادة وتاريخها.</small>
                </span>
              </li>
              <li>
                <span>
                  <strong>اعتمد الحكم الظاهر</strong>
                  <small>صالحة أو ملغاة أو مستبدلة أو غير موجودة.</small>
                </span>
              </li>
            </ol>
          </section>

          <section className={styles.lookupForm} aria-labelledby="lookup-form-title">
            <div className={styles.lookupFormIntro}>
              <span aria-hidden="true">
                <Icon name="shield" size={24} />
              </span>
              <div>
                <h2 id="lookup-form-title">استعلام برمز الشهادة</h2>
                <p>
                  اكتب الرمز حرفيًا كما يظهر في الشهادة. لا يمكن البحث
                  بالاسم أو البريد أو رقم الهوية.
                </p>
              </div>
            </div>

            <form onSubmit={submit} noValidate>
              <label htmlFor="verification-code">رمز التحقق</label>
              <div className={styles.lookupField}>
                <Icon name="search" size={19} />
                <input
                  className={styles.lookupInput}
                  id="verification-code"
                  value={verificationCode}
                  onChange={(event) => {
                    setVerificationCode(event.target.value);
                    if (errorMessage) setErrorMessage("");
                  }}
                  inputMode="text"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  dir="ltr"
                  placeholder="VER-..."
                  maxLength={96}
                  required
                  autoFocus
                  aria-describedby={errorMessage ? "verification-error" : "verification-privacy"}
                  aria-invalid={Boolean(errorMessage)}
                />
              </div>
              {errorMessage && (
                <p className={styles.error} id="verification-error" role="alert">
                  {errorMessage}
                </p>
              )}
              <button className={`${styles.button} ${styles.fullButton}`} type="submit">
                التحقق من السجل
                <span className={styles.rtlArrow}>
                  <Icon name="arrow" size={17} />
                </span>
              </button>
            </form>
            <p className={styles.privacyNote} id="verification-privacy">
              لا يتطلب الاستعلام حسابًا، ولا يعرض نتائج الاختبارات أو بيانات
              الاتصال الخاصة بالمتدرّب.
            </p>
          </section>
        </div>
      </article>
    </main>
  );
}

function PublicEvidenceMasthead() {
  return (
    <header className={styles.masthead}>
      <div className={styles.mastheadInner}>
        <Link href="/verify" className={styles.brand}>
          <Image
            src="/brand/al-amad-mark-transparent.png"
            alt="شعار شركة الأمد"
            width={44}
            height={44}
          />
          <span>
            <strong>منظومة المقياس</strong>
            <small>سجل الإثبات العام</small>
          </span>
        </Link>
        <div className={styles.mastheadActions}>
          <ThemeToggle compact />
          <Link href="/login">دخول المشرفين</Link>
        </div>
      </div>
    </header>
  );
}
