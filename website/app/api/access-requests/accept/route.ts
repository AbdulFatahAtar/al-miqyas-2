import { NextResponse } from "next/server";
import {
  firstRpcRow,
  hashInvitationToken,
} from "../../../../lib/access-requests";
import { isTrustedSameOriginRequest } from "../../../../lib/http/request-security";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";

type CompletionResult = {
  result: "completed" | "expired" | "invalid" | "email_mismatch";
  organization_slug: string | null;
};

export async function POST(request: Request) {
  if (!isTrustedSameOriginRequest(request)) {
    return NextResponse.json(
      { message: "مصدر الطلب غير موثوق." },
      { status: 403 },
    );
  }

  let body: Record<string, unknown>;

  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { message: "رابط الدعوة غير صالح." },
      { status: 400 },
    );
  }

  const requestId =
    typeof body.requestId === "string" ? body.requestId.trim() : "";
  const token = typeof body.token === "string" ? body.token.trim() : "";

  if (!requestId || token.length < 32) {
    return NextResponse.json(
      { message: "رابط الدعوة غير صالح." },
      { status: 400 },
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { message: "افتح رابط الدعوة الأصلي مرة أخرى لإثبات ملكية البريد." },
      { status: 401 },
    );
  }

  const { data, error } = await supabase.rpc("complete_access_request", {
    target_request_id: requestId,
    invitation_token_hash: hashInvitationToken(token),
  });

  if (error) {
    const suspendedUser = error.message.includes(
      "suspended user cannot receive an active membership",
    );
    return NextResponse.json(
      {
        message: suspendedUser
          ? "الحساب معلّق ولا يمكنه قبول دعوة جديدة. راجع مسؤول المنصة."
          : "تعذر تفعيل العضوية.",
      },
      { status: suspendedUser ? 403 : 400 },
    );
  }

  const result = firstRpcRow<CompletionResult>(
    data as CompletionResult[],
  );

  if (!result || result.result === "invalid") {
    return NextResponse.json(
      { message: "رابط الدعوة غير صالح أو استُخدم مسبقًا." },
      { status: 409 },
    );
  }

  if (result.result === "expired") {
    return NextResponse.json(
      { message: "انتهت صلاحية الدعوة. اطلب من مسؤول الجهة إعادة إرسالها." },
      { status: 410 },
    );
  }

  if (result.result === "email_mismatch") {
    return NextResponse.json(
      { message: "البريد المفتوح لا يطابق البريد المدعو." },
      { status: 403 },
    );
  }

  return NextResponse.json({
    status: "completed",
    organizationSlug: result.organization_slug,
    message: "تم تفعيل عضويتك بنجاح.",
  });
}
