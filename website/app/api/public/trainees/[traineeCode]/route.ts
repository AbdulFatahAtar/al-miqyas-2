import { NextResponse } from "next/server";
import {
  createRequestFingerprint,
  firstRpcRow,
} from "../../../../../lib/access-requests";
import {
  createSupabaseServiceRoleClient,
  SupabaseServiceConfigurationError,
} from "../../../../../lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PublicTraineeRoute = {
  trainee_code: string;
  program_title: string;
  cohort_title: string;
  cohort_status: "draft" | "open" | "in_progress" | "closed";
  pre_form_id: string | null;
  pre_field_name: string | null;
  post_form_id: string | null;
  post_field_name: string | null;
  pre_completed: boolean;
  live_event_count: number;
  post_completed: boolean;
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ traineeCode: string }> },
) {
  const { traineeCode: rawTraineeCode } = await params;
  const traineeCode = rawTraineeCode.trim().toUpperCase();

  if (!/^AMD-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/.test(traineeCode)) {
    return NextResponse.json(
      { message: "معرّف المتدرّب غير صالح." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const fingerprint = createRequestFingerprint(request);
  if (!fingerprint) {
    return NextResponse.json(
      { message: "خدمة التحقق العامة غير مهيأة بأمان." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const supabase = createSupabaseServiceRoleClient();
    const { data: allowed, error: rateError } = await supabase.rpc(
      "consume_public_api_rate_limit",
      {
        target_fingerprint: fingerprint,
        target_scope: "trainee_route",
      },
    );

    if (rateError) {
      return NextResponse.json(
        { message: "خدمة التحقق غير متاحة الآن." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (allowed !== true) {
      return NextResponse.json(
        { message: "تجاوزت محاولات التحقق المسموحة." },
        { status: 429, headers: { "Cache-Control": "no-store" } },
      );
    }

    const { data, error } = await supabase.rpc(
      "get_public_trainee_route",
      { p_trainee_code: traineeCode },
    );

    if (error) {
      return NextResponse.json(
        { message: "تعذر التحقق من الرابط الآن." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      {
        route: firstRpcRow<PublicTraineeRoute>(
          data as PublicTraineeRoute[],
        ) ?? null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (!(error instanceof SupabaseServiceConfigurationError)) {
      console.error("Public trainee route failed.", error);
    }

    return NextResponse.json(
      { message: "خدمة التحقق غير متاحة الآن." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
