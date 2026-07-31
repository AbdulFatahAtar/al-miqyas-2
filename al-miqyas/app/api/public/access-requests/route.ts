import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  createRequestFingerprint,
  firstRpcRow,
  isAccessRequestRole,
  isValidApplicantEmail,
  normalizeApplicantEmail,
  normalizeApplicantName,
} from "../../../../lib/access-requests";

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

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    return NextResponse.json(
      { message: "خدمة الطلبات غير مهيأة بعد." },
      { status: 503 },
    );
  }

  const supabase = createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const { data, error } = await supabase.rpc("submit_access_request", {
    target_org_slug: organizationSlug,
    applicant_full_name: fullName,
    applicant_email: email,
    applicant_role: role,
    applicant_fingerprint: createRequestFingerprint(request),
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

  if (result.result === "already_member") {
    return NextResponse.json(
      {
        message:
          "هذا البريد مرتبط بعضوية نشطة. استخدم صفحة تسجيل الدخول بدلًا من إرسال طلب جديد.",
      },
      { status: 409 },
    );
  }

  if (result.result === "duplicate") {
    return NextResponse.json(
      {
        status: "duplicate",
        message:
          "يوجد طلب مفتوح لهذا البريد لدى الجهة، ولا حاجة لإرساله مرة أخرى.",
      },
      { status: 202 },
    );
  }

  return NextResponse.json(
    {
      status: "created",
      referenceCode: result.reference_code,
      message: "تم استلام طلبك وإحالته إلى مسؤول الجهة للمراجعة.",
    },
    { status: 201 },
  );
}

