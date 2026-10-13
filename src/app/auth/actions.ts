"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { safeNext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/supabase/env";
import type { ActionState } from "@/lib/types";

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return process.env.NEXT_PUBLIC_SITE_URL ? siteUrl() : host ? `${proto}://${host}` : siteUrl();
}

function callbackUrl(base: string, next: string) {
  return `${base}/auth/callback?next=${encodeURIComponent(safeNext(next))}`;
}

export async function signInWithGoogle(formData: FormData) {
  const next = String(formData.get("next") ?? "/events");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callbackUrl(await origin(), next) },
  });
  if (error || !data.url) redirect(`/auth/login?error=${encodeURIComponent(error?.message ?? "Could not start Google sign-in")}`);
  redirect(data.url);
}

const emailSchema = z.object({ email: z.email("Enter a valid email address"), next: z.string().optional() });

export async function signInWithEmail(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = emailSchema.safeParse({ email: formData.get("email"), next: formData.get("next") ?? undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { emailRedirectTo: callbackUrl(await origin(), parsed.data.next ?? "/events") },
  });
  if (error) return { error: error.message };
  return { ok: `Check ${parsed.data.email} for a sign-in link.` };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
