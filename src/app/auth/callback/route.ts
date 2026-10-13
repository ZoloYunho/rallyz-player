import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** Finishes Google and email sign-in, then sends new players to onboarding. */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));
  const errorDescription = url.searchParams.get("error_description");

  if (errorDescription) {
    return NextResponse.redirect(new URL(`/auth/login?error=${encodeURIComponent(errorDescription)}`, url.origin));
  }
  if (!code) {
    return NextResponse.redirect(new URL("/auth/login?error=Missing%20sign-in%20code", url.origin));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    return NextResponse.redirect(
      new URL(`/auth/login?error=${encodeURIComponent(error?.message ?? "Sign-in failed")}`, url.origin),
    );
  }

  const { data: profile } = await supabase.from("profiles").select("onboarded").eq("id", data.user.id).single();
  const destination = profile?.onboarded ? next : `/onboarding?next=${encodeURIComponent(next)}`;
  return NextResponse.redirect(new URL(destination, url.origin));
}
