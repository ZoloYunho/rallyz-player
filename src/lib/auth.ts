import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";
import { DEFAULT_SPORT } from "@/lib/sports";

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
  let { data } = await supabase.from("player_profiles").select("*").eq("id", userId).maybeSingle();
  if (!data) {
    // Signed in on the shared project but no Rallyz profile yet: create it.
    await supabase.rpc("rallyz_ensure_profile");
    ({ data } = await supabase.from("player_profiles").select("*").eq("id", userId).maybeSingle());
  }
  if (!data) return null;
  // Admin rights live in app_admins, shared with the main site's rules.
  const { data: isAdmin } = await supabase.rpc("rallyz_is_admin");
  return { ...(data as Omit<Profile, "is_admin">), is_admin: isAdmin === true };
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
export function safeNext(next: string | null | undefined, fallback = `/${DEFAULT_SPORT}/events`): string {
  if (!next || !next.startsWith("/") || /[\x00-\x20\\]/.test(next)) return fallback;
  try {
    const url = new URL(next, "http://rallyz.invalid");
    if (url.origin !== "http://rallyz.invalid") return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
