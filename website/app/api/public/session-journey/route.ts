import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { firstRpcRow } from "../../../../lib/access-requests";
import { hashOperationalSessionToken, operationalJourneyCookie } from "../../../../lib/operational-sessions";
import {
  createSupabaseServiceRoleClient,
  SupabaseServiceConfigurationError,
} from "../../../../lib/supabase/service";

export const dynamic = "force-dynamic";

type Journey = {
  session_id: string;
  title: string;
  program_title: string;
  cohort_title: string;
  station_key: string;
  registration: string;
  attendance_id: string;
  enrollment_id: string;
  trainee_code: string;
  trainee_name: string;
  pre_completed: boolean;
  live_event_count: number;
  post_completed: boolean;
  report_ready: boolean;
  certificate_ready: boolean;
  certificate_verify_code: string | null;
  access_expires_at: string;
};

export async function GET() {
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(operationalJourneyCookie)?.value ?? "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(rawToken)) {
    return NextResponse.json({ message: "تصريح رحلة الجلسة غير موجود." }, { status: 401 });
  }

  let supabase: ReturnType<typeof createSupabaseServiceRoleClient>;
  try {
    supabase = createSupabaseServiceRoleClient();
  } catch (error) {
    if (!(error instanceof SupabaseServiceConfigurationError)) {
      console.error("Session journey service setup failed.", error);
    }
    return NextResponse.json({ message: "خدمة الرحلة غير متاحة الآن." }, { status: 503 });
  }

  const { data, error } = await supabase.rpc("get_operational_session_journey", {
    target_access_token_hash: hashOperationalSessionToken(rawToken),
  });
  const journey = error ? null : firstRpcRow<Journey>(data as Journey[]);
  if (!journey) {
    return NextResponse.json({ message: "انتهى تصريح الرحلة أو أُلغيت الجلسة." }, { status: 401 });
  }

  return NextResponse.json({ journey }, { headers: { "Cache-Control": "no-store" } });
}
