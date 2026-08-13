import { NextResponse } from "next/server";
import { createRequestFingerprint, firstRpcRow } from "../../../../../lib/access-requests";
import { isTrustedSameOriginRequest } from "../../../../../lib/http/request-security";
import {
  createOperationalJourneyToken,
  hashOperationalSessionToken,
  isOperationalSessionToken,
  operationalJourneyCookie,
} from "../../../../../lib/operational-sessions";
import {
  createSupabaseServiceRoleClient,
  SupabaseServiceConfigurationError,
} from "../../../../../lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PublicSession = {
  session_id: string;
  title: string;
  program_title: string;
  cohort_title: string;
  station_key: string;
  token_expires_at: string;
  allow_self_registration: boolean;
};

type JoinedSession = {
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
};

async function attachJourneyCookie(
  supabase: NonNullable<Awaited<ReturnType<typeof consumeLimit>>["supabase"]>,
  attendance: JoinedSession,
) {
  const journeyToken = createOperationalJourneyToken();
  const expiresAt = new Date(Date.now() + 12 * 60 * 60_000);
  const { data, error } = await supabase.rpc("issue_operational_session_access_token", {
    target_attendance_id: attendance.attendance_id,
    target_expires_at: expiresAt.toISOString(),
    target_token_hash: journeyToken.tokenHash,
  });
  if (error || data !== true) return null;

  const response = NextResponse.json(
    { attendance },
    { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } },
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

function serviceClient() {
  try {
    return createSupabaseServiceRoleClient();
  } catch (error) {
    if (!(error instanceof SupabaseServiceConfigurationError)) {
      console.error("Operational session service setup failed.", error);
    }
    return null;
  }
}

async function consumeLimit(request: Request, scope: "session_scan" | "session_join") {
  const fingerprint = createRequestFingerprint(request);
  const supabase = serviceClient();
  if (!fingerprint || !supabase) {
    return { supabase: null, status: 503 as const };
  }

  const { data, error } = await supabase.rpc("consume_public_api_rate_limit", {
    target_fingerprint: fingerprint,
    target_scope: scope,
  });
  if (error) {
    return { supabase: null, status: 503 as const };
  }
  if (data !== true) {
    return { supabase: null, status: 429 as const };
  }
  return { supabase, status: 200 as const };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!isOperationalSessionToken(token)) {
    return NextResponse.json({ message: "رابط الجلسة غير صالح أو انتهت صلاحيته." }, { status: 404 });
  }

  const limited = await consumeLimit(request, "session_scan");
  if (!limited.supabase) {
    return NextResponse.json(
      {
        message:
          limited.status === 429
            ? "تم تجاوز عدد محاولات فتح الجلسة. حاول لاحقًا."
            : "خدمة الجلسات غير متاحة الآن.",
      },
      { status: limited.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { data, error } = await limited.supabase.rpc("get_public_operational_session", {
    target_token_hash: hashOperationalSessionToken(token),
  });
  const session = error ? null : firstRpcRow<PublicSession>(data as PublicSession[]);
  if (!session) {
    return NextResponse.json(
      { message: "رابط الجلسة غير صالح أو انتهت صلاحيته." },
      { status: error?.code === "42883" ? 503 : 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    { session },
    { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } },
  );
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
    return NextResponse.json({ message: "تعذر التحقق من الجلسة أو الهوية." }, { status: 422 });
  }

  const limited = await consumeLimit(request, "session_join");
  if (!limited.supabase) {
    return NextResponse.json(
      {
        message:
          limited.status === 429
            ? "تم تجاوز عدد محاولات التحقق. حاول بعد عشر دقائق."
            : "خدمة الجلسات غير متاحة الآن.",
      },
      { status: limited.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ message: "بيانات إثبات الهوية غير صالحة." }, { status: 400 });
  }

  const traineeCode = typeof body.traineeCode === "string" ? body.traineeCode.trim().toUpperCase() : "";
  const identityValue = typeof body.identityValue === "string" ? body.identityValue.trim() : "";
  if (
    !/^AMD-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/.test(traineeCode) ||
    identityValue.length < 5 ||
    identityValue.length > 254
  ) {
    return NextResponse.json({ message: "بيانات إثبات الهوية غير صالحة." }, { status: 400 });
  }

  const { data, error } = await limited.supabase.rpc("join_public_operational_session", {
    target_identity_value: identityValue,
    target_token_hash: hashOperationalSessionToken(token),
    target_trainee_code: traineeCode,
  });
  const attendance = error ? null : firstRpcRow<JoinedSession>(data as JoinedSession[]);
  if (!attendance) {
    return NextResponse.json(
      { message: "تعذر التحقق من الجلسة أو الهوية أو التسجيل في الدفعة." },
      { status: error?.code === "42883" ? 503 : 422, headers: { "Cache-Control": "no-store" } },
    );
  }

  const response = await attachJourneyCookie(limited.supabase, attendance);
  return response ?? NextResponse.json(
    { message: "تم الالتحاق، لكن تعذر إصدار تصريح الرحلة. أعد المحاولة." },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
