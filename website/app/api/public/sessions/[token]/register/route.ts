import { NextResponse } from "next/server";
import { createRequestFingerprint, firstRpcRow } from "../../../../../../lib/access-requests";
import { isTrustedSameOriginRequest } from "../../../../../../lib/http/request-security";
import {
  createOperationalJourneyToken,
  hashOperationalSessionToken,
  isOperationalSessionToken,
  operationalJourneyCookie,
} from "../../../../../../lib/operational-sessions";
import {
  createSupabaseServiceRoleClient,
  SupabaseServiceConfigurationError,
} from "../../../../../../lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RegisteredParticipant = {
  attendance_id: string;
  session_id: string;
  enrollment_id: string;
  trainee_code: string;
  trainee_name: string;
  program_id: string;
  registration: string;
  station_key: string;
  joined_at: string;
  already_joined: boolean;
  created_trainee: boolean;
  identity_assurance: "self_asserted";
};

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  if (!isTrustedSameOriginRequest(request)) {
    return NextResponse.json({ message: "مصدر الطلب غير موثوق." }, { status: 403 });
  }
  const { token } = await params;
  if (!isOperationalSessionToken(token)) {
    return NextResponse.json({ message: "رابط الجلسة غير صالح." }, { status: 422 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ message: "بيانات التسجيل غير صالحة." }, { status: 400 });
  }

  const fullName = textValue(body.fullName).replace(/\s+/g, " ");
  const email = textValue(body.email).toLowerCase();
  const phone = textValue(body.phone);
  const consent = body.consent === true;
  if (
    fullName.length < 2 || fullName.length > 200 ||
    (!email && !phone) || email.length > 254 || phone.length > 32 || !consent
  ) {
    return NextResponse.json({ message: "أكمل الاسم ووسيلة التواصل والموافقة." }, { status: 400 });
  }

  const fingerprint = createRequestFingerprint(request);
  if (!fingerprint) {
    return NextResponse.json({ message: "خدمة التسجيل غير مهيأة بأمان." }, { status: 503 });
  }

  let supabase: ReturnType<typeof createSupabaseServiceRoleClient>;
  try {
    supabase = createSupabaseServiceRoleClient();
  } catch (error) {
    if (!(error instanceof SupabaseServiceConfigurationError)) {
      console.error("Session registration service setup failed.", error);
    }
    return NextResponse.json({ message: "خدمة التسجيل غير متاحة الآن." }, { status: 503 });
  }

  const { data: allowed, error: rateError } = await supabase.rpc("consume_public_api_rate_limit", {
    target_fingerprint: fingerprint,
    target_scope: "session_register",
  });
  if (rateError || allowed !== true) {
    return NextResponse.json(
      { message: rateError ? "خدمة التسجيل غير متاحة الآن." : "تم تجاوز عدد محاولات التسجيل. حاول لاحقًا." },
      { status: rateError ? 503 : 429, headers: { "Cache-Control": "no-store" } },
    );
  }

  const journeyToken = createOperationalJourneyToken();
  const expiresAt = new Date(Date.now() + 12 * 60 * 60_000);
  const { data, error } = await supabase.rpc("register_public_operational_session", {
    target_access_expires_at: expiresAt.toISOString(),
    target_access_token_hash: journeyToken.tokenHash,
    target_consent: consent,
    target_email: email || null,
    target_full_name: fullName,
    target_phone: phone || null,
    target_token_hash: hashOperationalSessionToken(token),
  });
  const participant = error ? null : firstRpcRow<RegisteredParticipant>(data as RegisteredParticipant[]);
  if (!participant) {
    const isDuplicate = error?.code === "23505";
    return NextResponse.json(
      { message: isDuplicate ? "وسيلة التواصل مسجلة سابقًا. استخدم خيار «لدي معرّف AMD»." : "تعذر إنشاء التسجيل في هذه الجلسة." },
      { status: isDuplicate ? 409 : 422, headers: { "Cache-Control": "no-store" } },
    );
  }

  const response = NextResponse.json(
    { attendance: participant },
    { status: 201, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } },
  );
  response.cookies.set(operationalJourneyCookie, journeyToken.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
  return response;
}
