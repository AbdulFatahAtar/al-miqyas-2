import { NextResponse } from "next/server";
import {
  createRequestFingerprint,
  firstRpcRow,
  isAccessRequestRole,
  isValidApplicantEmail,
  normalizeApplicantEmail,
  normalizeApplicantName,
} from "../../../../lib/access-requests";
import {
  createSupabaseServiceRoleClient,
  SupabaseServiceConfigurationError,
} from "../../../../lib/supabase/service";

type SubmitResult = {
  result: string;
  reference_code: string | null;
};

export async function POST(request: Request) {
  let body: Record<string, unknown>;

  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { message: "بيانات الطلب غير صالحة." },
      { status: 400 },
    );
  }

  const fullName = normalizeApplicantName(body.fullName);
  const email = normalizeApplicantEmail(body.email);
  const role = body.role;
  const organizationSlug =
    typeof body.organizationSlug === "string"
      ? body.organizationSlug.trim()
      : "";

  if (
    fullName.length < 2 ||
    fullName.length > 160 ||
    !isValidApplicantEmail(email) ||
    !isAccessRequestRole(role) ||
    !organizationSlug ||
    body.consent !== true
  ) {
    return NextResponse.json(
      { message: "أكمل جميع الحقول المطلوبة وتأكد من صحتها." },
      { status: 400 },
    );
  }

  const fingerprint = createRequestFingerprint(request);
  if (!fingerprint) {
    return NextResponse.json(
      { message: "خدمة الطلبات غير مهيأة بأمان." },
      { status: 503 },
    );
  }

  let supabase: ReturnType<typeof createSupabaseServiceRoleClient>;
  try {
    supabase = createSupabaseServiceRoleClient();
  } catch (error) {
    if (!(error instanceof SupabaseServiceConfigurationError)) {
      console.error("Access-request service setup failed.", error);
    }
    return NextResponse.json(
      { message: "خدمة الطلبات غير مهيأة بأمان." },
      { status: 503 },
    );
  }

  const { data: allowed, error: rateError } = await supabase.rpc(
    "consume_public_api_rate_limit",
    {
      target_fingerprint: fingerprint,
      target_scope: "access_request",
    },
  );

  if (rateError) {
    return NextResponse.json(
      { message: "تعذر إرسال الطلب الآن." },
      { status: 503 },
    );
  }

  if (allowed !== true) {
    return NextResponse.json(
      { message: "تم تجاوز عدد المحاولات المسموح. حاول بعد 24 ساعة." },
      { status: 429 },
    );
  }

  const { data, error } = await supabase.rpc("submit_access_request", {
    target_org_slug: organizationSlug,
    applicant_full_name: fullName,
    applicant_email: email,
    applicant_role: role,
    applicant_fingerprint: fingerprint,
  });

  if (error) {
    return NextResponse.json(
      {
        message:
          "تعذر إرسال الطلب الآن. لم يتم إنشاء حساب أو عضوية. حاول لاحقًا.",
      },
      { status: 503 },
    );
  }

  const result = firstRpcRow<SubmitResult>(data as SubmitResult[]);

  if (!result || result.result === "invalid") {
    return NextResponse.json(
      { message: "بيانات الطلب غير صالحة." },
      { status: 400 },
    );
  }

  if (result.result === "organization_unavailable") {
    return NextResponse.json(
      { message: "الجهة المحددة لا تستقبل طلبات حاليًا." },
      { status: 409 },
    );
  }

  if (result.result === "rate_limited") {
    return NextResponse.json(
      { message: "تم تجاوز عدد المحاولات المسموح. حاول بعد 24 ساعة." },
      { status: 429 },
    );
  }

  if (
    result.result === "already_member" ||
    result.result === "duplicate" ||
    result.result === "created"
  ) {
    return NextResponse.json(
      {
        status: "accepted",
        message:
          "إذا كان الطلب مؤهلًا فستراجعه الجهة وتتواصل مع البريد المدخل. لا تكشف هذه الصفحة وجود حساب أو طلب سابق.",
      },
      { status: 202 },
    );
  }

  return NextResponse.json(
    { message: "تعذر إرسال الطلب الآن." },
    { status: 503 },
  );
}
