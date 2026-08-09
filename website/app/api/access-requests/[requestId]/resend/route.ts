import { NextResponse } from "next/server";
import {
  firstRpcRow,
  type AccessRequestReviewContext,
} from "../../../../../lib/access-requests";
import { isTrustedSameOriginRequest } from "../../../../../lib/http/request-security";
import { sendAccessRequestInvitation } from "../../../../../lib/send-access-request-invitation";
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
    "prepare_access_request_invitation",
    {
      target_request_id: requestId,
    },
  );

  if (error) {
    return NextResponse.json(
      { message: "لا يمكن إعادة إرسال الدعوة لهذا الطلب." },
      { status: error.message.includes("not allowed") ? 403 : 409 },
    );
  }

  const context = firstRpcRow<AccessRequestReviewContext>(
    data as AccessRequestReviewContext[],
  );

  if (!context) {
    return NextResponse.json(
      { message: "تعذر تجهيز الدعوة." },
      { status: 500 },
    );
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
