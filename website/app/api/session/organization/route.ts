import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACTIVE_ORGANIZATION_COOKIE } from "../../../../lib/auth/active-organization";
import { getCurrentAccessContext } from "../../../../lib/auth/server";
import { isTrustedSameOriginRequest } from "../../../../lib/http/request-security";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
      { message: "بيانات الجهة غير صالحة." },
      { status: 400 },
    );
  }

  const organizationId =
    typeof body.organizationId === "string"
      ? body.organizationId.trim()
      : "";

  if (!uuidPattern.test(organizationId)) {
    return NextResponse.json(
      { message: "معرّف الجهة غير صالح." },
      { status: 400 },
    );
  }

  const context = await getCurrentAccessContext();

  if (!context.user) {
    return NextResponse.json(
      { message: "انتهت جلسة الدخول." },
      { status: 401 },
    );
  }

  if (context.loadError) {
    return NextResponse.json(
      { message: "تعذر التحقق من نطاق الوصول." },
      { status: 503 },
    );
  }

  const organization = context.organizations.find(
    (item) => item.id === organizationId,
  );

  if (
    !organization ||
    (!context.isPlatformOwner && organization.status !== "active")
  ) {
    return NextResponse.json(
      { message: "لا تملك وصولًا نشطًا إلى هذه الجهة." },
      { status: 403 },
    );
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ORGANIZATION_COOKIE, organization.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  });

  return NextResponse.json(
    {
      activeOrganizationId: organization.id,
      organization,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
