import { NextResponse } from "next/server";
import {
  firstRpcRow,
  type AccessRequestReviewContext,
} from "../../../../lib/access-requests";
import { isTrustedSameOriginRequest } from "../../../../lib/http/request-security";
import { sendAccessRequestInvitation } from "../../../../lib/send-access-request-invitation";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function textField(body: Record<string, unknown>, key: string) {
  return typeof body[key] === "string" ? body[key].trim() : "";
}

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
      { message: "بيانات الدعوة غير صالحة." },
      { status: 400 },
    );
  }

  const organizationId = textField(body, "organizationId");
  const fullName = textField(body, "fullName");
  const email = textField(body, "email").toLowerCase();
  const role = textField(body, "role");
  const reason = textField(body, "reason");

  if (
    !uuidPattern.test(organizationId) ||
    fullName.length < 2 ||
    fullName.length > 160 ||
    !emailPattern.test(email) ||
    email.length > 254 ||
    !["owner", "trainer", "viewer"].includes(role) ||
    reason.length < 5 ||
    reason.length > 500
  ) {
    return NextResponse.json(
      { message: "أكمل اسم المستخدم وبريده وجهته ودوره وسبب الدعوة بقيم صالحة." },
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

  const { data: permissionAllowed, error: permissionError } = await supabase.rpc(
    "has_permission",
    {
      target_permission: "users.create",
      target_org_id: null,
    },
  );

  if (permissionError || permissionAllowed !== true) {
    return NextResponse.json(
      { message: "لا تملك صلاحية دعوة مستخدمين على مستوى المنصة." },
      { status: 403 },
    );
  }

  const { data, error } = await supabase.rpc(
    "create_platform_user_invitation",
    {
      target_org_id: organizationId,
      target_full_name: fullName,
      target_email: email,
      target_role: role,
      target_reason: reason,
    },
  );

  if (error) {
    const status = error.code === "42501" ? 403 : 409;
    return NextResponse.json(
      {
        message:
          status === 403
            ? "رفضت قاعدة البيانات هذه الدعوة لعدم كفاية الصلاحية."
            : "تعذر إنشاء الدعوة. قد يكون المستخدم عضوًا بالفعل أو لديه دعوة مفتوحة.",
      },
      { status },
    );
  }

  const context = firstRpcRow<AccessRequestReviewContext>(
    data as AccessRequestReviewContext[],
  );

  if (!context) {
    return NextResponse.json(
      { message: "أنشأت قاعدة البيانات العملية لكن لم تُرجع سياق الدعوة." },
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
