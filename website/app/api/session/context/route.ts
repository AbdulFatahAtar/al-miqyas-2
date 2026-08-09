import { NextResponse } from "next/server";
import { getCurrentAccessContext } from "../../../../lib/auth/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await getCurrentAccessContext();

  if (!context.user) {
    return NextResponse.json(
      { message: "انتهت جلسة الدخول." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (context.loadError) {
    return NextResponse.json(
      { message: "تعذر تحميل نطاق الوصول بأمان." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    {
      user: context.user,
      isPlatformOwner: context.isPlatformOwner,
      organizations: context.organizations,
      activeOrganizationId: context.activeOrganizationId,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
