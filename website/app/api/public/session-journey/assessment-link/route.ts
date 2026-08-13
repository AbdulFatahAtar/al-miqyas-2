import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { firstRpcRow } from "../../../../../lib/access-requests";
import { isTrustedSameOriginRequest } from "../../../../../lib/http/request-security";
import { hashOperationalSessionToken, operationalJourneyCookie } from "../../../../../lib/operational-sessions";
import {
  createSupabaseServiceRoleClient,
  SupabaseServiceConfigurationError,
} from "../../../../../lib/supabase/service";

type LinkResult = {
  form_id: string;
  trainee_field_name: string;
  submission_token_field_name: string;
  trainee_code: string;
  submission_token: string;
};

export async function POST(request: Request) {
  if (!isTrustedSameOriginRequest(request)) {
    return NextResponse.json({ message: "مصدر الطلب غير موثوق." }, { status: 403 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ message: "نوع القياس غير صالح." }, { status: 400 });
  }
  const assessmentKind = body.assessmentKind;
  if (assessmentKind !== "pre" && assessmentKind !== "post") {
    return NextResponse.json({ message: "نوع القياس غير صالح." }, { status: 400 });
  }

  const cookieStore = await cookies();
  const rawToken = cookieStore.get(operationalJourneyCookie)?.value ?? "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(rawToken)) {
    return NextResponse.json({ message: "انتهى تصريح رحلة الجلسة." }, { status: 401 });
  }

  let supabase: ReturnType<typeof createSupabaseServiceRoleClient>;
  try {
    supabase = createSupabaseServiceRoleClient();
  } catch (error) {
    if (!(error instanceof SupabaseServiceConfigurationError)) {
      console.error("Journey assessment service setup failed.", error);
    }
    return NextResponse.json({ message: "خدمة القياس غير متاحة الآن." }, { status: 503 });
  }

  const { data, error } = await supabase.rpc("create_operational_session_assessment_link", {
    target_access_token_hash: hashOperationalSessionToken(rawToken),
    target_assessment_kind: assessmentKind,
  });
  const link = error ? null : firstRpcRow<LinkResult>(data as LinkResult[]);
  if (!link) {
    if (error) {
      console.error("Journey assessment link creation failed.", {
        code: error.code,
        message: error.message,
      });
    }
    return NextResponse.json({ message: "هذا القياس غير متاح الآن أو أُنجز مسبقًا." }, { status: 409 });
  }

  const formUrl = new URL(`https://form.jotform.com/${link.form_id}`);
  formUrl.searchParams.set(link.trainee_field_name, link.trainee_code);
  formUrl.searchParams.set(link.submission_token_field_name, link.submission_token);
  return NextResponse.json({ url: formUrl.toString() }, { headers: { "Cache-Control": "no-store" } });
}
