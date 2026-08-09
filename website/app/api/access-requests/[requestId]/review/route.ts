import { NextResponse } from "next/server";
import {
  firstRpcRow,
  type AccessRequestReviewContext,
} from "../../../../../lib/access-requests";
import { isTrustedSameOriginRequest } from "../../../../../lib/http/request-security";
import { sendAccessRequestInvitation } from "../../../../../lib/send-access-request-invitation";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";

function reviewErrorStatus(message: string) {
  if (message.includes("not found")) {
    return 404;
  }

  if (message.includes("not allowed")) {
    return 403;
  }

  if (message.includes("no longer pending")) {
    return 409;
  }

  return 400;
}

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
  let body: Record<string, unknown>;

  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { message: "بيانات القرار غير صالحة." },
      { status: 400 },
    );
  }

  const decision = body.decision;
  const note = typeof body.note === "string" ? body.note.trim() : "";

  if (
    (decision !== "approve" && decision !== "reject") ||
    (decision === "reject" && note.length < 3) ||
    note.length > 1000
  ) {
    return NextResponse.json(
      { message: "أدخل قرارًا صالحًا وسبب رفض واضحًا عند الرفض." },
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

  const { data, error } = await supabase.rpc("review_access_request", {
    target_request_id: requestId,
    review_decision: decision,
    reviewer_note: note || null,
  });

  if (error) {
    return NextResponse.json(
      { message: "تعذر حفظ القرار. قد يكون الطلب عولج مسبقًا." },
      { status: reviewErrorStatus(error.message) },
    );
  }

  const context = firstRpcRow<AccessRequestReviewContext>(
    data as AccessRequestReviewContext[],
  );

  if (!context) {
    return NextResponse.json(
      { message: "تعذر قراءة نتيجة المراجعة." },
      { status: 500 },
    );
  }

  if (decision === "reject") {
    return NextResponse.json({
      status: "rejected",
      message: "تم رفض الطلب وتسجيل السبب في سجل التدقيق.",
    });
  }

  const dispatch = await sendAccessRequestInvitation({
    request,
    sessionClient: supabase,
    context,
  });

  return NextResponse.json(dispatch, {
    status: dispatch.status === "approved" ? 202 : 200,
  });
}
