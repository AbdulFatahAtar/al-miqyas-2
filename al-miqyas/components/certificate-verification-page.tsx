"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "./icons";
import { StatusBadge } from "./app-shell";
import { ThemeToggle } from "./theme-toggle";

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
  const isLoading = false;
  const lookupFailed = initialLookupFailed;
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");

  const status = certificate?.certificate_status ?? "notfound";
  const isValid = status === "valid";
  const isRevoked = status === "revoked";

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
    <main className="verify-page">
      <header className="public-header">
        <div className="public-brand">
          <img
            className="brand-mark"
            src="/brand/al-amad-mark.png"
            alt="شعار شركة الأمد"
          />
          <div>
            <strong>منظومة المقياس</strong>
            <small>التحقق من الشهادات</small>
          </div>
        </div>
        <div className="public-header-actions">
          <ThemeToggle compact />
          <Link href="/login">دخول المشرفين</Link>
        </div>
      </header>

      <div className="verify-wrap">
        <section
          className={`verification-card verify-${
            isLoading
              ? "loading"
              : isValid
                ? "valid"
                : isRevoked
                  ? "revoked"
                  : "notfound"
          }`}
        >
          {isLoading ? (
            <div className="verification-loading">
              <span className="verify-emblem">
                <Icon name="clock" size={38} />
              </span>
              <h1>جارٍ التحقق من الشهادة</h1>
              <p>تُراجع حالة الرمز مباشرة من قاعدة البيانات.</p>
            </div>
          ) : isValid && certificate ? (
            <>
              <div className="verify-emblem">
                <Icon name="shield" size={38} />
              </div>
              <StatusBadge tone="success">شهادة صالحة</StatusBadge>
              <h1>تم التحقق من الشهادة</h1>
              <p>
                البيانات التالية محفوظة وقت الإصدار ولم تُستخرج من ملف
                قابل للتعديل.
              </p>
              <dl>
                <div>
                  <dt>اسم المتدرّب</dt>
                  <dd>{certificate.trainee_name}</dd>
                </div>
                <div>
                  <dt>معرّف المتدرّب</dt>
                  <dd dir="ltr">{certificate.trainee_code}</dd>
                </div>
                <div>
                  <dt>البرنامج</dt>
                  <dd>{certificate.program_title}</dd>
                </div>
                <div>
                  <dt>الجهة المصدرة</dt>
                  <dd>{certificate.organization_name}</dd>
                </div>
                <div>
                  <dt>الدفعة</dt>
                  <dd>{certificate.cohort_title}</dd>
                </div>
                <div>
                  <dt>رقم الشهادة</dt>
                  <dd dir="ltr">{certificate.certificate_number}</dd>
                </div>
                <div>
                  <dt>تاريخ الإصدار</dt>
                  <dd>{certificate.issued_at_label}</dd>
                </div>
                <div>
                  <dt>رمز التحقق</dt>
                  <dd dir="ltr">{certificate.verify_code}</dd>
                </div>
              </dl>
              <button
                className="button button-primary"
                onClick={() => void downloadCertificate()}
                disabled={isDownloading}
              >
                <Icon name="download" size={16} />
                {isDownloading
                  ? "جارٍ إنشاء الشهادة..."
                  : "تنزيل الشهادة PDF"}
              </button>
              {downloadError ? (
                <p className="field-error" role="alert">
                  {downloadError}
                </p>
              ) : null}
            </>
          ) : certificate && isRevoked ? (
            <>
              <div className="verify-emblem">
                <Icon name="warning" size={38} />
              </div>
              <StatusBadge tone="danger">شهادة ملغاة</StatusBadge>
              <h1>هذه الشهادة غير صالحة</h1>
              <p>
                ألغت الجهة المصدرة هذه الشهادة. لا تعتمد نسخة ورقية أو
                رقمًا محفوظًا منها.
              </p>
              <dl>
                <div>
                  <dt>رقم الشهادة</dt>
                  <dd dir="ltr">{certificate.certificate_number}</dd>
                </div>
                <div>
                  <dt>الجهة المصدرة</dt>
                  <dd>{certificate.organization_name}</dd>
                </div>
                <div>
                  <dt>تاريخ الإلغاء</dt>
                  <dd>{certificate.revoked_at_label ?? "—"}</dd>
                </div>
                <div>
                  <dt>رمز التحقق</dt>
                  <dd dir="ltr">{certificate.verify_code}</dd>
                </div>
              </dl>
            </>
          ) : certificate?.certificate_status === "superseded" ? (
            <>
              <div className="verify-emblem">
                <Icon name="warning" size={38} />
              </div>
              <StatusBadge tone="warning">شهادة مستبدلة</StatusBadge>
              <h1>صدرت شهادة أحدث</h1>
              <p>
                هذه الشهادة غير صالحة للاعتماد بعد إعادة الإصدار. اطلب
                رابط الشهادة الجديدة من الجهة المصدرة.
              </p>
              <div className="public-code">
                <small>رقم الشهادة القديمة</small>
                <strong dir="ltr">
                  {certificate.certificate_number}
                </strong>
              </div>
            </>
          ) : (
            <>
              <div className="verify-emblem">
                <Icon name="warning" size={38} />
              </div>
              <StatusBadge tone="warning">
                {lookupFailed ? "تعذر التحقق" : "غير موجودة"}
              </StatusBadge>
              <h1>
                {lookupFailed
                  ? "خدمة التحقق غير متاحة"
                  : "تعذر العثور على الشهادة"}
              </h1>
              <p>
                {lookupFailed
                  ? "أعد المحاولة لاحقًا. لا تعتبر الشهادة صالحة حتى تظهر نتيجة مؤكدة."
                  : "تحقق من الرابط أو أعد مسح رمز التحقق من النسخة الأصلية."}
              </p>
              <div className="public-code">
                <small>رمز التحقق المدخل</small>
                <strong dir="ltr">{verifyCode}</strong>
              </div>
            </>
          )}
        </section>

        <aside className="verify-side">
          <div className="logo-pending large">شعار الجهة</div>
          <span>صادرة عن</span>
          <strong>
            {certificate?.organization_name ?? "جهة مسجلة في المنظومة"}
          </strong>
          <small>تُشغّل بمنظومة المقياس · شركة الأمد</small>
          <div className="verification-assurance">
            <Icon name="lock" size={17} />
            <span>
              لا تُعرض بيانات الاتصال أو نتائج الاختبارات في صفحة
              التحقق العامة.
            </span>
          </div>
        </aside>
      </div>
    </main>
  );
}
