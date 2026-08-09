import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    return NextResponse.json(
      { message: "إعداد الاتصال بقاعدة البيانات غير مكتمل." },
      { status: 503 },
    );
  }

  const supabase = createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const { data, error } = await supabase.rpc("list_joinable_organizations");

  if (error) {
    return NextResponse.json(
      { message: "تعذر تحميل الجهات المتاحة حاليًا." },
      { status: 503 },
    );
  }

  return NextResponse.json(
    { organizations: data ?? [] },
    {
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    },
  );
}

