"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { Icon } from "./icons";
import { ThemeToggle } from "./theme-toggle";
import styles from "./public-evidence.module.css";

export type PublicCertificate = {
  certificate_status: "valid" | "revoked" | "superseded";
  certificate_number: string;
  verify_code: string;
  trainee_name: string;
  trainee_code: string;
  program_title: string;
  organization_name: string;
  cohort_title: string;
  issued_at: string;
  issued_at_label: string;
  revoked_at: string | null;
  revoked_at_label: string | null;
};

export function CertificateVerificationPage({
  verifyCode,
  initialCertificate,
  initialLookupFailed = false,
}: {
  verifyCode: string;
  initialCertificate: PublicCertificate | null;
  initialLookupFailed?: boolean;
}) {
  const certificate = initialCertificate;
  const lookupFailed = initialLookupFailed;
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");

  const status = certificate?.certificate_status ?? "notfound";
  const isValid = status === "valid";
  const isRevoked = status === "revoked";
  const isSuperseded = status === "superseded";

  const outcome = isValid
    ? {
        label: "شهادة صالحة",
        title: "السجل مطابق والشهادة صالحة",
        description:
          "هذه البيانات محفوظة وقت الإصدار في سجل الشهادات، وليست مستخرجة من ملف قابل للتعديل.",
        tone: styles.valid,
        icon: "shield" as const,
      }
    : isRevoked
      ? {
          label: "شهادة ملغاة",
          title: "السجل موجود لكنه غير صالح للاعتماد",
          description:
            "ألغت الجهة المصدرة هذه الشهادة. لا تعتمد أي نسخة ورقية أو رقم محفوظ منها.",
          tone: styles.revoked,
          icon: "warning" as const,
        }
      : isSuperseded
        ? {
            label: "شهادة مستبدلة",
            title: "هذا السجل استُبدل بإصدار أحدث",
            description:
              "لا تعتمد هذه النسخة بعد إعادة الإصدار. اطلب رابط الشهادة الجديدة من الجهة المصدرة.",
            tone: styles.superseded,
            icon: "warning" as const,
          }
        : lookupFailed
          ? {
              label: "تعذر التحقق",
              title: "خدمة التحقق غير متاحة الآن",
              description:
                "أعد المحاولة لاحقًا. لا تعتبر الشهادة صالحة حتى تظهر نتيجة مؤكدة من السجل.",
              tone: styles.failed,
              icon: "warning" as const,
            }
          : {
              label: "السجل غير موجود",
              title: "لم نعثر على شهادة بهذا الرمز",
              description:
                "تحقق من الرابط أو أعد مسح رمز الاستجابة من النسخة الأصلية للشهادة.",
              tone: styles.warning,
              icon: "warning" as const,
            };

  async function downloadCertificate() {
    if (!certificate || certificate.certificate_status !== "valid") {
      return;
    }

    setIsDownloading(true);
    setDownloadError("");

    try {
      const { downloadCertificatePdf } = await import(
        "../lib/certificate-pdf"
      );

      await downloadCertificatePdf({
        certificateNumber: certificate.certificate_number,
        verifyCode: certificate.verify_code,
        traineeName: certificate.trainee_name,
        traineeCode: certificate.trainee_code,
        programTitle: certificate.program_title,
        organizationName: certificate.organization_name,
        cohortTitle: certificate.cohort_title,
        issuedAt: certificate.issued_at,
      });
    } catch (error) {
      setDownloadError(
        error instanceof Error
          ? error.message
          : "تعذر إنشاء ملف الشهادة.",
      );
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <main className={styles.page}>
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

      <article className={styles.document} aria-labelledby="verification-title">
        <header className={styles.documentHead}>
          <div>
            <span className={styles.documentClass}>نتيجة استعلام موثقة</span>
            <h1 id="verification-title">سجل التحقق من الشهادة</h1>
            <p>
              الحكم الظاهر مرتبط برمز التحقق المدخل وحالة السجل وقت فتح
              هذه الصفحة.
            </p>
          </div>
          <div className={styles.recordId}>
            <small>رمز الاستعلام</small>
            <strong dir="ltr">{verifyCode}</strong>
          </div>
        </header>

        <div className={styles.verificationGrid}>
          <section className={styles.verificationSheet}>
            <div className={`${styles.statusHeader} ${outcome.tone}`}>
              <span className={styles.statusGlyph} aria-hidden="true">
                <Icon name={outcome.icon} size={28} />
              </span>
              <div className={styles.statusCopy}>
                <strong>{outcome.title}</strong>
                <span>نتيجة سجل الشهادات العام</span>
              </div>
              <span className={styles.decision}>
                <Icon name={isValid ? "check" : "warning"} size={14} />
                {outcome.label}
              </span>
            </div>

            <div className={styles.verificationBody}>
              <h2>بيانات الحكم</h2>
              <p>{outcome.description}</p>

              {isValid && certificate ? (
                <dl className={styles.evidenceFields}>
                  <EvidenceField label="اسم المتدرّب" value={certificate.trainee_name} />
                  <EvidenceField label="معرّف المتدرّب" value={certificate.trainee_code} technical />
                  <EvidenceField label="البرنامج" value={certificate.program_title} />
                  <EvidenceField label="الجهة المصدرة" value={certificate.organization_name} />
                  <EvidenceField label="الدفعة" value={certificate.cohort_title} />
                  <EvidenceField label="رقم الشهادة" value={certificate.certificate_number} technical />
                  <EvidenceField label="تاريخ الإصدار" value={certificate.issued_at_label} />
                  <EvidenceField label="رمز التحقق" value={certificate.verify_code} technical />
                </dl>
              ) : certificate && isRevoked ? (
                <dl className={styles.evidenceFields}>
                  <EvidenceField label="رقم الشهادة" value={certificate.certificate_number} technical />
                  <EvidenceField label="الجهة المصدرة" value={certificate.organization_name} />
                  <EvidenceField label="تاريخ الإلغاء" value={certificate.revoked_at_label ?? "—"} />
                  <EvidenceField label="رمز التحقق" value={certificate.verify_code} technical />
                </dl>
              ) : certificate && isSuperseded ? (
                <div className={styles.codeBlock}>
                  <small>رقم الشهادة المستبدلة</small>
                  <strong dir="ltr">{certificate.certificate_number}</strong>
                </div>
              ) : (
                <div className={styles.codeBlock}>
                  <small>رمز التحقق المدخل</small>
                  <strong dir="ltr">{verifyCode}</strong>
                </div>
              )}

              <div className={styles.verificationActions}>
                {isValid && certificate ? (
                  <button
                    className={styles.button}
                    onClick={() => void downloadCertificate()}
                    disabled={isDownloading}
                  >
                    <Icon name="download" size={16} />
                    {isDownloading ? "جارٍ إنشاء الوثيقة..." : "تنزيل الشهادة PDF"}
                  </button>
                ) : null}
                <Link className={`${styles.button} ${styles.buttonSecondary}`} href="/verify">
                  فحص رمز آخر
                </Link>
              </div>
              {downloadError ? (
                <p className={styles.error} role="alert">
                  {downloadError}
                </p>
              ) : null}
            </div>
          </section>

          <aside className={styles.assurance} aria-labelledby="assurance-title">
            <span className={styles.assuranceIndex}>EVIDENCE / 01</span>
            <h2 id="assurance-title">حدود السجل العام</h2>
            <p>
              هذه الصفحة تثبت حالة الشهادة فقط ولا تكشف بيانات تشغيلية
              خارج نطاق التحقق.
            </p>
            <ul className={styles.assuranceList}>
              <li>
                <Icon name="source" size={18} />
                <span>المصدر هو سجل الإصدار المحفوظ وقت إنشاء الشهادة.</span>
              </li>
              <li>
                <Icon name="lock" size={18} />
                <span>لا تظهر بيانات الاتصال أو نتائج الاختبارات.</span>
              </li>
              <li>
                <Icon name="clock" size={18} />
                <span>إعادة فتح الصفحة تعيد قراءة الحالة الحالية للسجل.</span>
              </li>
            </ul>
            <div className={styles.issuerBlock}>
              <small>الجهة المصدرة</small>
              <strong>
                {certificate?.organization_name ?? "غير متاحة في نتيجة الاستعلام"}
              </strong>
              <span>تُشغّل بمنظومة المقياس · شركة الأمد</span>
            </div>
          </aside>
        </div>
      </article>
    </main>
  );
}

function EvidenceField({
  label,
  value,
  technical = false,
}: {
  label: string;
  value: string;
  technical?: boolean;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd
        className={technical ? styles.technicalValue : undefined}
        dir={technical ? "ltr" : undefined}
      >
        {value}
      </dd>
    </div>
  );
}
