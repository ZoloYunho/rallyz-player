"use client";

import { createBrowserClient } from "@supabase/ssr";

let client: ReturnType<typeof createBrowserClient> | undefined;

/** Browser Supabase client (used for realtime chat). */
export function createClient() {
  if (!client) {
    const domain = process.env.NEXT_PUBLIC_COOKIE_DOMAIN || undefined;
    client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
      domain ? { cookieOptions: { domain } } : undefined,
    );
  }
  return client;
}
