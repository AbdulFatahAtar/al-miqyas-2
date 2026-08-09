import { NextResponse } from "next/server";
import { isTrustedSameOriginRequest } from "../../../../../../lib/http/request-security";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ keyId: string }> },
) {
  if (!isTrustedSameOriginRequest(request)) {
    return NextResponse.json(
      { message: "مصدر الطلب غير موثوق." },
      { status: 403 },
    );
  }

  const { keyId } = await params;
  if (!uuidPattern.test(keyId)) {
    return NextResponse.json(
      { message: "معرّف المفتاح غير صالح." },
      { status: 400 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { message: "يجب إرسال سبب إلغاء المفتاح." },
      { status: 400 },
    );
  }
  const reason =
    typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 5 || reason.length > 500) {
    return NextResponse.json(
      { message: "سبب الإلغاء يجب أن يكون بين 5 و500 حرف." },
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

  const { data, error } = await supabase.rpc("revoke_org_xapi_key", {
    target_key_id: keyId,
    target_reason: reason,
  });

  if (error) {
    return NextResponse.json(
      { message: "غير مصرح لك بإلغاء هذا المفتاح." },
      { status: 403 },
    );
  }

  return NextResponse.json(
    { status: data ? "revoked" : "already_revoked" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
