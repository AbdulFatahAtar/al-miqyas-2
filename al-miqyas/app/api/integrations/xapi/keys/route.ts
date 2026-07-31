import { NextResponse } from "next/server";
import { firstRpcRow } from "../../../../../lib/access-requests";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { createXapiApiKey } from "../../../../../lib/xapi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type XapiKeyRecord = {
  id: string;
  org_id: string;
  label: string;
  key_prefix: string;
  status: "active" | "revoked";
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

async function authenticatedClient() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { supabase, user };
}

export async function GET(request: Request) {
  const organizationId = new URL(request.url).searchParams.get(
    "organizationId",
  );

  if (!organizationId || !uuidPattern.test(organizationId)) {
    return NextResponse.json(
      { message: "معرّف الجهة غير صالح." },
      { status: 400 },
    );
  }

  const { supabase, user } = await authenticatedClient();
  if (!user) {
    return NextResponse.json(
      { message: "انتهت جلسة الدخول." },
      { status: 401 },
    );
  }

  const { data, error } = await supabase.rpc("list_org_xapi_keys", {
    target_org_id: organizationId,
  });

  if (error) {
    return NextResponse.json(
      { message: "غير مصرح لك بعرض مفاتيح هذه الجهة." },
      { status: 403 },
    );
  }

  return NextResponse.json(
    { keys: (data ?? []) as XapiKeyRecord[] },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;

  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { message: "بيانات المفتاح غير صالحة." },
      { status: 400 },
    );
  }

  const organizationId =
    typeof body.organizationId === "string"
      ? body.organizationId.trim()
      : "";
  const label =
    typeof body.label === "string"
      ? body.label.trim().replace(/\s+/g, " ")
      : "";

  if (
    !uuidPattern.test(organizationId) ||
    label.length < 2 ||
    label.length > 120
  ) {
    return NextResponse.json(
      { message: "معرّف الجهة أو اسم المفتاح غير صالح." },
      { status: 400 },
    );
  }

  const { supabase, user } = await authenticatedClient();
  if (!user) {
    return NextResponse.json(
      { message: "انتهت جلسة الدخول." },
      { status: 401 },
    );
  }

  const generatedKey = createXapiApiKey();
  const { data, error } = await supabase.rpc("create_org_xapi_key", {
    target_key_hash: generatedKey.tokenHash,
    target_key_prefix: generatedKey.prefix,
    target_label: label,
    target_org_id: organizationId,
  });

  if (error) {
    return NextResponse.json(
      { message: "غير مصرح لك بإنشاء مفتاح لهذه الجهة." },
      { status: 403 },
    );
  }

  const keyRecord = firstRpcRow<XapiKeyRecord>(
    data as XapiKeyRecord[],
  );

  if (!keyRecord) {
    return NextResponse.json(
      { message: "تعذر إنشاء المفتاح." },
      { status: 503 },
    );
  }

  return NextResponse.json(
    {
      key: keyRecord,
      token: generatedKey.token,
      warning:
        "انسخ المفتاح الآن. لن تعرض المنظومة قيمته الخام مرة أخرى.",
    },
    {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

