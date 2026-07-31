import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { xapiContractVersion, xapiVersion } from "../../../../../lib/xapi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type XapiResponse = {
  accepted?: number;
  duplicates?: number;
  unmatched?: number;
  rejected?: number;
  message?: string;
  diagnostic?: string;
};

export async function POST(request: Request) {
  let body: Record<string, unknown>;

  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { message: "بيانات اختبار التكامل غير صالحة." },
      { status: 400 },
    );
  }

  const organizationId =
    typeof body.organizationId === "string"
      ? body.organizationId.trim()
      : "";
  const token =
    typeof body.token === "string" ? body.token.trim() : "";

  if (
    !uuidPattern.test(organizationId) ||
    token.length < 40 ||
    token.length > 200
  ) {
    return NextResponse.json(
      { message: "الجهة أو المفتاح غير صالح." },
      { status: 400 },
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { message: "انتهت جلسة الدخول." },
      { status: 401 },
    );
  }

  const { data: membership } = await supabase
    .from("memberships")
    .select("org_id")
    .eq("user_id", user.id)
    .eq("org_id", organizationId)
    .eq("role", "owner")
    .eq("status", "active")
    .maybeSingle();

  if (!membership) {
    return NextResponse.json(
      { message: "اختبار المفتاح متاح لمالك الجهة فقط." },
      { status: 403 },
    );
  }

  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("id, trainee_id, cohort_id")
    .eq("org_id", organizationId)
    .in("status", ["invited", "active", "completed"])
    .order("enrolled_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!enrollment) {
    return NextResponse.json(
      { message: "لا يوجد تسجيل صالح لاختبار الحدث." },
      { status: 409 },
    );
  }

  const [{ data: trainee }, { data: cohort }] = await Promise.all([
    supabase
      .from("trainees")
      .select("code")
      .eq("org_id", organizationId)
      .eq("id", enrollment.trainee_id)
      .single(),
    supabase
      .from("cohorts")
      .select("program_id")
      .eq("org_id", organizationId)
      .eq("id", enrollment.cohort_id)
      .single(),
  ]);

  if (!trainee || !cohort) {
    return NextResponse.json(
      { message: "تعذر تجهيز بيانات حدث الاختبار." },
      { status: 409 },
    );
  }

  const statementId = randomUUID();
  const sessionId = randomUUID();
  const extensionBase =
    "https://miqyas.al-amad.com.sa/xapi/extensions";
  const statement = {
    id: statementId,
    actor: {
      account: {
        homePage: "https://am-ad.com.sa",
        name: trainee.code,
      },
    },
    verb: {
      id: "https://miqyas.al-amad.com.sa/xapi/verbs/scene-started",
      display: { "ar-SA": "بدأ مشهدًا" },
    },
    object: {
      id: "https://miqyas.al-amad.com.sa/xapi/activities/diwan-onboarding/v1/scenes/S0",
      definition: {
        name: { "ar-SA": "الترحيب والتهيئة" },
      },
    },
    result: {
      completion: false,
    },
    context: {
      registration: sessionId,
      extensions: {
        [`${extensionBase}/contract-version`]: xapiContractVersion,
        [`${extensionBase}/program-id`]: cohort.program_id,
        [`${extensionBase}/enrollment-id`]: enrollment.id,
        [`${extensionBase}/scene-id`]: "S0",
        [`${extensionBase}/test-event`]: true,
      },
    },
    timestamp: new Date().toISOString(),
  };
  const endpoint = new URL(
    "/api/integrations/xapi/statements",
    request.url,
  );
  const sendStatement = () =>
    fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Experience-API-Version": xapiVersion,
      },
      body: JSON.stringify(statement),
      cache: "no-store",
    });

  const firstResponse = await sendStatement();
  const firstResult = (await firstResponse.json()) as XapiResponse;

  if (!firstResponse.ok || firstResult.accepted !== 1) {
    return NextResponse.json(
      {
        message:
          firstResult.diagnostic ||
          firstResult.message ||
          "فشل قبول الحدث الأول. تحقق من المفتاح والمطابقة.",
        firstResult,
      },
      { status: firstResponse.status },
    );
  }

  const duplicateResponse = await sendStatement();
  const duplicateResult =
    (await duplicateResponse.json()) as XapiResponse;

  if (!duplicateResponse.ok || duplicateResult.duplicates !== 1) {
    return NextResponse.json(
      {
        message: "قُبل الحدث لكن اختبار منع التكرار فشل.",
        firstResult,
        duplicateResult,
      },
      { status: 409 },
    );
  }

  return NextResponse.json(
    {
      status: "passed",
      statementId,
      traineeCode: trainee.code,
      accepted: firstResult.accepted,
      duplicates: duplicateResult.duplicates,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
