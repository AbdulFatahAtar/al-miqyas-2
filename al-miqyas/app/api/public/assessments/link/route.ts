import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { firstRpcRow } from "../../../../../lib/access-requests";

type AssessmentKind = "pre" | "post";

type AssessmentLinkResult = {
  form_id: string;
  trainee_field_name: string;
  submission_token_field_name: string;
  trainee_code: string;
  submission_token: string;
};

function isAssessmentKind(value: unknown): value is AssessmentKind {
  return value === "pre" || value === "post";
}

function errorStatus(message: string) {
  if (message.includes("rate limit")) {
    return 429;
  }

  if (message.includes("not available")) {
    return 409;
  }

  return 400;
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;

  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { message: "بيانات فتح القياس غير صالحة." },
      { status: 400 },
    );
  }

  const traineeCode =
    typeof body.traineeCode === "string"
      ? body.traineeCode.trim().toUpperCase()
      : "";
  const assessmentKind = body.assessmentKind;

  if (
    !/^AMD-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/.test(
      traineeCode,
    ) ||
    !isAssessmentKind(assessmentKind)
  ) {
    return NextResponse.json(
      { message: "رابط المتدرّب أو نوع القياس غير صالح." },
      { status: 400 },
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !publishableKey) {
    return NextResponse.json(
      { message: "خدمة القياس غير مهيأة بعد." },
      { status: 503 },
    );
  }

  const supabase = createClient(supabaseUrl, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const { data, error } = await supabase.rpc(
    "create_public_assessment_link",
    {
      target_trainee_code: traineeCode,
      target_assessment_kind: assessmentKind,
    },
  );

  if (error) {
    return NextResponse.json(
      {
        message:
          errorStatus(error.message) === 429
            ? "تم تجاوز عدد مرات إنشاء الرابط. حاول بعد عشر دقائق."
            : "هذا القياس غير متاح الآن أو أُنجز مسبقًا.",
      },
      {
        status: errorStatus(error.message),
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  const linkData = firstRpcRow<AssessmentLinkResult>(
    data as AssessmentLinkResult[],
  );

  if (
    !linkData ||
    !/^[0-9]{5,30}$/.test(linkData.form_id) ||
    !linkData.trainee_field_name ||
    !linkData.submission_token_field_name ||
    !linkData.submission_token
  ) {
    return NextResponse.json(
      { message: "تعذر إنشاء رابط القياس الآمن." },
      { status: 503 },
    );
  }

  const formUrl = new URL(
    `https://form.jotform.com/${linkData.form_id}`,
  );
  formUrl.searchParams.set(
    linkData.trainee_field_name,
    linkData.trainee_code,
  );
  formUrl.searchParams.set(
    linkData.submission_token_field_name,
    linkData.submission_token,
  );

  return NextResponse.json(
    {
      url: formUrl.toString(),
      expiresInSeconds: 7200,
    },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
