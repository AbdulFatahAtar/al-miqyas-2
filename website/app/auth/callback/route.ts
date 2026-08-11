import { NextResponse } from "next/server";
import { safeInternalPath } from "../../../lib/auth/safe-redirect";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = safeInternalPath(requestUrl.searchParams.get("next"));
  let exchangeFailed = !code;

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    exchangeFailed = Boolean(error);
  }

  const destination = exchangeFailed ? "/login?error=auth_callback" : next;
  const response = NextResponse.redirect(
    new URL(destination, requestUrl.origin),
  );
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
