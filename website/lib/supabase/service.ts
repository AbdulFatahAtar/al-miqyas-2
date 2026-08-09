import "server-only";

import { createClient } from "@supabase/supabase-js";

export class SupabaseServiceConfigurationError extends Error {
  constructor() {
    super("Supabase service-role configuration is missing or unsafe.");
    this.name = "SupabaseServiceConfigurationError";
  }
}

export function createSupabaseServiceRoleClient() {
  const url =
    process.env.SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (
    !url ||
    !serviceRoleKey ||
    serviceRoleKey === publishableKey
  ) {
    throw new SupabaseServiceConfigurationError();
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
