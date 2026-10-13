import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient as createPlainClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { cookieDomain, supabaseKey, supabaseUrl } from "./env";

/** Supabase client bound to the signed-in user's cookies. One per request. */
export async function createClient() {
  const cookieStore = await cookies();
  const domain = cookieDomain();
  return createServerClient(supabaseUrl(), supabaseKey(), {
    ...(domain ? { cookieOptions: { domain } } : {}),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // The proxy refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}

/** Anonymous client with no cookies, for public data (share previews). */
export function createPublicClient() {
  return createPlainClient(supabaseUrl(), supabaseKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
