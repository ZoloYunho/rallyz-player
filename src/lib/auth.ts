import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

/** The signed-in user's id, or null. Verified against Supabase Auth. */
export const getUserId = cache(async (): Promise<string | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return (data?.claims?.sub as string | undefined) ?? null;
});

/** The signed-in user's profile, or null when signed out. */
export const getProfile = cache(async (): Promise<Profile | null> => {
  const userId = await getUserId();
  if (!userId) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (data) return data as Profile;
  // Signed in on the shared project but no Rallyz profile yet: create it.
  await supabase.rpc("rallyz_ensure_profile");
  const { data: created } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  return (created as Profile | null) ?? null;
});

/** Redirects to sign-in (and back afterwards) when signed out. */
export async function requireProfile(nextPath: string): Promise<Profile> {
  const profile = await getProfile();
  if (!profile) {
    // Signed in but the profile still can't be created: show an error rather
    // than bouncing between sign-in and this page.
    if (await getUserId()) throw new Error("Your Rallyz profile could not be loaded. Please try again.");
    redirect(`/auth/login?next=${encodeURIComponent(nextPath)}`);
  }
  return profile;
}

/** Like requireProfile, and sends people who haven't set their level to onboarding. */
export async function requireOnboarded(nextPath: string): Promise<Profile> {
  const profile = await requireProfile(nextPath);
  if (!profile.onboarded) redirect(`/onboarding?next=${encodeURIComponent(nextPath)}`);
  return profile;
}

export async function requireAdmin(): Promise<Profile> {
  const profile = await requireProfile("/admin");
  if (!profile.is_admin) redirect("/");
  return profile;
}

/**
 * Only allow same-site relative redirects. Parsing (rather than prefix checks)
 * catches tricks like "/\t/evil.com", which browsers read as "//evil.com".
 */
export function safeNext(next: string | null | undefined, fallback = "/events"): string {
  if (!next || !next.startsWith("/") || /[\x00-\x20\\]/.test(next)) return fallback;
  try {
    const url = new URL(next, "http://rallyz.invalid");
    if (url.origin !== "http://rallyz.invalid") return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
