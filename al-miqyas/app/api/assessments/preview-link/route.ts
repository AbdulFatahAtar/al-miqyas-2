import { NextResponse } from "next/server";
import { firstRpcRow } from "../../../../lib/access-requests";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";

type PreviewLinkResult = {
  form_id: string;
  trainee_field_name: string;
  submission_token_field_name: string;
  trainee_code: string;
  submission_token: string;
};

export async function POST(request: Request) {
  let body: Record<string, unknown>;

  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { message: "بيانات المعاينة غير صالحة." },
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
    (assessmentKind !== "pre" && assessmentKind !== "post")
  ) {
    return NextResponse.json(
      { message: "المتدرّب أو نوع القياس غير صالح." },
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

  const { data, error } = await supabase.rpc(
    "create_staff_assessment_preview_link",
    {
      target_trainee_code: traineeCode,
      target_assessment_kind: assessmentKind,
    },
  );

  if (error) {
    return NextResponse.json(
      {
        message: error.message.includes("rate limit")
          ? "تم تجاوز عدد روابط المعاينة. حاول بعد عشر دقائق."
          : "المعاينة غير متاحة لهذا المتدرّب أو أُنجز القياس مسبقًا.",
      },
      {
        status: error.message.includes("rate limit") ? 429 : 409,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  const linkData = firstRpcRow<PreviewLinkResult>(
    data as PreviewLinkResult[],
  );

  if (!linkData || !/^[0-9]{5,30}$/.test(linkData.form_id)) {
    return NextResponse.json(
      { message: "تعذر إنشاء رابط المعاينة." },
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
      expiresInSeconds: 1800,
    },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
