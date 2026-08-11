import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import {
  createInvitationToken,
  getApplicationUrl,
  type AccessRequestReviewContext,
} from "./access-requests";

export type InvitationDispatchResult = {
  status: "invited" | "completed" | "approved";
  invitationSent: boolean;
  message: string;
};

export async function sendAccessRequestInvitation({
  request,
  sessionClient,
  context,
}: {
  request: Request;
  sessionClient: SupabaseClient;
  context: AccessRequestReviewContext;
}): Promise<InvitationDispatchResult> {
  if (context.request_status === "completed") {
    return {
      status: "completed",
      invitationSent: false,
      message:
        "تم تفعيل العضوية مباشرة لأن البريد مرتبط بحساب موثّق مسبقًا.",
    };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !publishableKey) {
    return {
      status: "approved",
      invitationSent: false,
      message: "تم اعتماد الطلب، لكن إعداد خدمة البريد غير مكتمل.",
    };
  }

  const authClient = createClient(supabaseUrl, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const { token, tokenHash } = createInvitationToken();
  const applicationUrl = getApplicationUrl(request);
  const invitationUrl = new URL("/accept-invitation", applicationUrl);
  invitationUrl.searchParams.set("request", context.request_id);
  invitationUrl.searchParams.set("token", token);
  const callbackUrl = new URL("/auth/callback", applicationUrl);
  callbackUrl.searchParams.set("next", `${invitationUrl.pathname}${invitationUrl.search}`);

  const { error: inviteError } = await authClient.auth.signInWithOtp({
    email: context.applicant_email,
    options: {
      // The auth callback exchanges Supabase's one-time code before the
      // invitation page reads the session. Going directly to the page leaves
      // an already-signed-in browser on the wrong account.
      emailRedirectTo: callbackUrl.toString(),
      shouldCreateUser: true,
      data: {
        full_name: context.applicant_name,
        access_request_id: context.request_id,
        organization_id: context.organization_id,
        requested_role: context.requested_role,
      },
    },
  });

  if (inviteError) {
    return {
      status: "approved",
      invitationSent: false,
      message:
        "تم اعتماد الطلب، لكن خدمة البريد لم ترسل الدعوة. يمكن إعادة المحاولة من لوحة الطلبات.",
    };
  }

  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
  const { error: markError } = await sessionClient.rpc(
    "mark_access_request_invited",
    {
      target_request_id: context.request_id,
      invited_user_id: null,
      invitation_token_hash: tokenHash,
      invitation_expires_at: expiresAt,
    },
  );

  if (markError) {
    return {
      status: "approved",
      invitationSent: false,
      message:
        "أُرسل رابط الدخول، لكن تعذر ربطه بالطلب. أعد الإرسال من لوحة الطلبات.",
    };
  }

  return {
    status: "invited",
    invitationSent: true,
    message: "تم اعتماد الطلب وإرسال دعوة صالحة لمدة 72 ساعة.",
  };
}
