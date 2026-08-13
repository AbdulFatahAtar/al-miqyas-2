import { NextResponse } from "next/server";
import { firstRpcRow } from "../../../../../lib/access-requests";
import { isTrustedSameOriginRequest } from "../../../../../lib/http/request-security";
import {
  createOperationalSessionQr,
  createOperationalSessionToken,
} from "../../../../../lib/operational-sessions";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const tokenActions = new Set(["open", "rotate"]);
const actions = new Set(["open", "rotate", "close", "cancel"]);

type ManagedSession = {
  id: string;
  org_id: string;
  status: "scheduled" | "open" | "closed" | "cancelled";
  registration: string;
  opened_at: string | null;
  closed_at: string | null;
  cancelled_at: string | null;
  token_expires_at: string | null;
  updated_at: string;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  if (!isTrustedSameOriginRequest(request)) {
    return NextResponse.json({ message: "مصدر الطلب غير موثوق." }, { status: 403 });
  }

  const { sessionId } = await params;
  if (!uuidPattern.test(sessionId)) {
    return NextResponse.json({ message: "معرّف الجلسة غير صالح." }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ message: "بيانات الإجراء غير صالحة." }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action.toLowerCase() : "";
  const tokenMinutes = Number(body.tokenMinutes ?? 120);
  if (
    !actions.has(action) ||
    (tokenActions.has(action) &&
      (!Number.isInteger(tokenMinutes) || tokenMinutes < 10 || tokenMinutes > 480))
  ) {
    return NextResponse.json({ message: "إجراء الجلسة غير صالح." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ message: "انتهت جلسة الدخول." }, { status: 401 });
  }

  const generatedToken = tokenActions.has(action) ? createOperationalSessionToken() : null;
  const expiresAt = generatedToken
    ? new Date(Date.now() + tokenMinutes * 60_000).toISOString()
    : null;
  const { data, error } = await supabase.rpc("manage_operational_session", {
    target_action: action,
    target_session_id: sessionId,
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
              ? "غير مصرح لك بإدارة هذه الجلسة."
              : "لا يمكن تنفيذ الإجراء على الجلسة في حالتها الحالية.",
      },
      { status: error.code === "42883" ? 503 : error.code === "42501" ? 403 : 409 },
    );
  }

  const session = firstRpcRow<ManagedSession>(data as ManagedSession[]);
  if (!session) {
    return NextResponse.json({ message: "تعذر قراءة الجلسة بعد الإجراء." }, { status: 503 });
  }

  const join = generatedToken
    ? await createOperationalSessionQr(request, generatedToken.token)
    : null;
  return NextResponse.json(
    { session, join },
    { headers: { "Cache-Control": "no-store" } },
  );
}
