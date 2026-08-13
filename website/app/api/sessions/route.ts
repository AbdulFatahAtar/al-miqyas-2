import { NextResponse } from "next/server";
import { firstRpcRow } from "../../../lib/access-requests";
import { isTrustedSameOriginRequest } from "../../../lib/http/request-security";
import {
  createOperationalSessionQr,
  createOperationalSessionToken,
} from "../../../lib/operational-sessions";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const stationKeys = new Set([
  "ALL",
  "S0",
  "S1",
  "S2",
  "S3",
  "S4",
  "S5",
  "S6",
  "S7",
]);

type OperationalSessionRow = {
  id: string;
  org_id: string;
  program_id: string;
  cohort_id: string;
  title: string;
  station_key: string;
  status: "scheduled" | "open" | "closed" | "cancelled";
  registration: string;
  scheduled_for: string;
  opened_at: string | null;
  token_expires_at: string | null;
  created_at: string;
};

async function authenticatedClient() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function GET(request: Request) {
  const organizationId = new URL(request.url).searchParams.get("organizationId") ?? "";
  if (!uuidPattern.test(organizationId)) {
    return NextResponse.json({ message: "معرّف الجهة غير صالح." }, { status: 400 });
  }

  const { supabase, user } = await authenticatedClient();
  if (!user) {
    return NextResponse.json({ message: "انتهت جلسة الدخول." }, { status: 401 });
  }

  const { data, error } = await supabase.rpc("list_operational_sessions", {
    target_org_id: organizationId,
  });
  if (error) {
    return NextResponse.json(
      { message: "غير مصرح لك بعرض جلسات هذه الجهة." },
      { status: error.code === "42883" ? 503 : 403 },
    );
  }

  return NextResponse.json(
    { sessions: data ?? [] },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginRequest(request)) {
    return NextResponse.json({ message: "مصدر الطلب غير موثوق." }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ message: "بيانات الجلسة غير صالحة." }, { status: 400 });
  }

  const organizationId = typeof body.organizationId === "string" ? body.organizationId : "";
  const programId = typeof body.programId === "string" ? body.programId : "";
  const cohortId = typeof body.cohortId === "string" ? body.cohortId : "";
  const title = typeof body.title === "string" ? body.title.trim().replace(/\s+/g, " ") : "";
  const stationKey = typeof body.stationKey === "string" ? body.stationKey.toUpperCase() : "";
  const scheduledFor = typeof body.scheduledFor === "string" ? body.scheduledFor : "";
  const openNow = body.openNow === true;
  const tokenMinutes = Number(body.tokenMinutes ?? 120);
  const scheduledDate = new Date(scheduledFor);

  if (
    !uuidPattern.test(organizationId) ||
    !uuidPattern.test(programId) ||
    !uuidPattern.test(cohortId) ||
    title.length < 2 ||
    title.length > 160 ||
    !stationKeys.has(stationKey) ||
    Number.isNaN(scheduledDate.valueOf()) ||
    !Number.isInteger(tokenMinutes) ||
    tokenMinutes < 10 ||
    tokenMinutes > 480
  ) {
    return NextResponse.json({ message: "بيانات الجلسة غير مكتملة أو غير صالحة." }, { status: 400 });
  }

  const { supabase, user } = await authenticatedClient();
  if (!user) {
    return NextResponse.json({ message: "انتهت جلسة الدخول." }, { status: 401 });
  }

  const generatedToken = openNow ? createOperationalSessionToken() : null;
  const expiresAt = openNow
    ? new Date(Date.now() + tokenMinutes * 60_000).toISOString()
    : null;
  const { data, error } = await supabase.rpc("create_operational_session", {
    target_cohort_id: cohortId,
    target_open_now: openNow,
    target_org_id: organizationId,
    target_program_id: programId,
    target_scheduled_for: scheduledDate.toISOString(),
    target_station_key: stationKey,
    target_title: title,
    target_token_expires_at: expiresAt,
    target_token_hash: generatedToken?.tokenHash ?? null,
  });

  if (error) {
    return NextResponse.json(
      {
        message:
          error.code === "42883"
            ? "ترحيل الجلسات التشغيلية غير مطبق بعد."
            : error.code === "42501"
              ? "غير مصرح لك بإنشاء جلسة لهذه الجهة."
              : "تعذر إنشاء الجلسة. تحقق من أن البرنامج والدفعة غير مؤرشفين.",
      },
      { status: error.code === "42883" ? 503 : error.code === "42501" ? 403 : 409 },
    );
  }

  const session = firstRpcRow<OperationalSessionRow>(data as OperationalSessionRow[]);
  if (!session) {
    return NextResponse.json({ message: "تعذر قراءة الجلسة بعد إنشائها." }, { status: 503 });
  }

  const join = generatedToken
    ? await createOperationalSessionQr(request, generatedToken.token)
    : null;

  return NextResponse.json(
    { session, join },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}
