export function supabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set. Copy .env.example to .env.local.");
  return url;
}

/** Accepts the new publishable key or the legacy anon key. */
export function supabaseKey(): string {
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set. Copy .env.example to .env.local.");
  }
  return key;
}

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/**
 * Set to ".rallyz.club" in production so the sign-in cookie is shared with the
 * main site (same Supabase project). Leave unset on localhost.
 */
export function cookieDomain(): string | undefined {
  return process.env.NEXT_PUBLIC_COOKIE_DOMAIN || undefined;
}

/** The main rallyz.club site (court search), linked from the header. */
export function mainSiteUrl(): string {
  return (process.env.NEXT_PUBLIC_MAIN_SITE_URL ?? "https://rallyz.club").replace(/\/$/, "");
}
