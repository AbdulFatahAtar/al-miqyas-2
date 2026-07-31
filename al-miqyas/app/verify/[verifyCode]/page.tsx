import {
  CertificateVerificationPage,
  type PublicCertificate,
} from "../../../components/certificate-verification-page";

export const dynamic = "force-dynamic";

function formatCertificateDate(value: string | null) {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat(
    "ar-SA-u-ca-islamic-umalqura",
    {
      calendar: "islamic-umalqura",
      timeZone: "Asia/Riyadh",
      dateStyle: "long",
    },
  ).format(new Date(value));
}

async function getPublicCertificate(verifyCode: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !publishableKey) {
    return {
      certificate: null,
      lookupFailed: true,
    };
  }

  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/rpc/get_public_certificate`,
      {
        method: "POST",
        headers: {
          apikey: publishableKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          target_verify_code: verifyCode,
        }),
        cache: "no-store",
      },
    );

    if (!response.ok) {
      return {
        certificate: null,
        lookupFailed: true,
      };
    }

    const data = (await response.json()) as Array<
      Omit<
        PublicCertificate,
        "issued_at_label" | "revoked_at_label"
      >
    >;
    const certificate = data[0];

    return {
      certificate: certificate
        ? {
            ...certificate,
            issued_at_label:
              formatCertificateDate(certificate.issued_at) ?? "—",
            revoked_at_label: formatCertificateDate(
              certificate.revoked_at,
            ),
          }
        : null,
      lookupFailed: false,
    };
  } catch {
    return {
      certificate: null,
      lookupFailed: true,
    };
  }
}

export default async function Page({
  params,
}: {
  params: Promise<{ verifyCode: string }>;
}) {
  const { verifyCode } = await params;
  const normalizedVerifyCode =
    decodeURIComponent(verifyCode).toUpperCase();
  const result = await getPublicCertificate(normalizedVerifyCode);

  return (
    <CertificateVerificationPage
      verifyCode={normalizedVerifyCode}
      initialCertificate={result.certificate}
      initialLookupFailed={result.lookupFailed}
    />
  );
}
