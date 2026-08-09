import { NextResponse } from "next/server";
import { isTrustedSameOriginRequest } from "../../../../../lib/http/request-security";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  if (!isTrustedSameOriginRequest(request)) {
    return NextResponse.json(
      { message: "مصدر الطلب غير موثوق." },
      { status: 403 },
    );
  }

  const { requestId } = await params;
  let body: Record<string, unknown> = {};

  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // The cancellation note is optional.
  }

  const note = typeof body.note === "string" ? body.note.trim() : "";

  if (note.length > 1000) {
    return NextResponse.json(
      { message: "ملاحظة الإلغاء طويلة جدًا." },
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

  const { error } = await supabase.rpc("cancel_access_request", {
    target_request_id: requestId,
    cancellation_note: note || null,
  });

  if (error) {
    return NextResponse.json(
      { message: "تعذر إلغاء الدعوة لهذا الطلب." },
      { status: error.message.includes("not allowed") ? 403 : 409 },
    );
  }

  return NextResponse.json({
    status: "cancelled",
    message: "تم إلغاء الدعوة ومنع تفعيل العضوية من خلالها.",
  });
}
