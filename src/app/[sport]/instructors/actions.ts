"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getProfile, getUserId, safeNext } from "@/lib/auth";
import { AREAS, LANGUAGES } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";
import { bangkokLocalToIso } from "@/lib/time";
import { toSport } from "@/lib/sports";
import type { ActionState } from "@/lib/types";

const coachSchema = z
  .object({
    headline: z.string().trim().min(5, "Write a short headline (5+ characters)").max(100),
    bio: z.string().trim().max(3000).default(""),
    rate_private_thb: z.coerce.number().int("Use whole baht").min(0).max(100000),
    rate_group_thb: z.coerce.number().int().min(0).max(100000).optional(),
    areas: z.array(z.enum(AREAS)).min(1, "Pick at least one area you teach in"),
    venues: z.string().trim().max(300).default(""),
    level_min: z.coerce.number().int().min(1).max(9),
    level_max: z.coerce.number().int().min(1).max(9),
    languages: z.array(z.enum(LANGUAGES)).min(1, "Pick at least one language"),
    years_coaching: z.coerce.number().int().min(0).max(70).optional(),
    certifications: z.string().trim().max(300).default(""),
    trial_offer: z.string().trim().max(200).default(""),
  })
  .refine((v) => v.level_max >= v.level_min, { message: "Highest level taught must be at or above the lowest", path: ["level_max"] });

export async function saveCoachProfile(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const sport = toSport(formData.get("sport"));
  const profile = await getProfile();
  if (!profile) redirect(`/auth/login?next=/${sport}/instructors/apply`);
  if (!profile.onboarded) redirect(`/onboarding?next=/${sport}/instructors/apply`);

  const get = (k: string) => {
    const v = formData.get(k);
    return v === null || v === "" ? undefined : v;
  };
  const parsed = coachSchema.safeParse({
    headline: get("headline"),
    bio: get("bio"),
    rate_private_thb: get("rate_private_thb"),
    rate_group_thb: get("rate_group_thb"),
    areas: formData.getAll("areas"),
    venues: get("venues"),
    level_min: get("level_min"),
    level_max: get("level_max"),
    languages: formData.getAll("languages"),
    years_coaching: get("years_coaching"),
    certifications: get("certifications"),
    trial_offer: get("trial_offer"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const row = { ...parsed.data, rate_group_thb: parsed.data.rate_group_thb ?? null, years_coaching: parsed.data.years_coaching ?? null };

  const supabase = await createClient();
  const { data: existing } = await supabase.from("coach_profiles").select("user_id, status, sports").eq("user_id", profile.id).maybeSingle();
  // A coach can teach several sports; saving from a sport's page adds that sport.
  const sports = Array.from(new Set([...((existing?.sports as string[] | undefined) ?? []), sport]));
  const { error } = existing
    ? await supabase.from("coach_profiles").update({ ...row, sports }).eq("user_id", profile.id)
    : await supabase.from("coach_profiles").insert({ ...row, sports, user_id: profile.id });
  if (error) return { error: error.message };

  revalidatePath("/[sport]/instructors", "page");
  revalidatePath("/[sport]/instructors/[id]", "page");
  return {
    ok: existing?.status === "approved"
      ? "Profile updated."
      : "Thanks! Your profile is in review. We'll notify you when it's live.",
  };
}

const requestSchema = z.object({
  coach_id: z.uuid(),
  kind: z.enum(["private", "group"]),
  players: z.coerce.number().int().min(1).max(12),
  preferred_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Pick a date and time"),
  note: z.string().trim().max(1000).default(""),
});

export async function requestLesson(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const sport = toSport(formData.get("sport"));
  const profile = await getProfile();
  const coachId = String(formData.get("coach_id") ?? "");
  if (!profile) redirect(`/auth/login?next=/${sport}/instructors/${coachId}`);
  if (!profile.onboarded) redirect(`/onboarding?next=/${sport}/instructors/${coachId}`);

  const parsed = requestSchema.safeParse({
    coach_id: coachId,
    kind: formData.get("kind"),
    players: formData.get("players") || 1,
    preferred_at: formData.get("preferred_at"),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const when = bangkokLocalToIso(parsed.data.preferred_at);
  if (!when) return { error: "Pick a date and time" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_lesson", {
    p_coach: parsed.data.coach_id,
    p_kind: parsed.data.kind,
    p_players: parsed.data.players,
    p_preferred_at: when,
    p_note: parsed.data.note,
  });
  if (error || !data) return { error: error?.message ?? "Could not send the request." };
  redirect(`/chat/${data}`);
}

export async function respondLesson(formData: FormData) {
  const userId = await getUserId();
  if (!userId) redirect("/auth/login?next=/me");
  const id = z.uuid().safeParse(formData.get("request_id"));
  if (!id.success) redirect("/me");
  const supabase = await createClient();
  const accept = formData.get("decision") === "accept";
  const { error } = await supabase.rpc("respond_lesson_request", { p_request: id.data, p_accept: accept });
  revalidatePath("/me");
  const backTo = safeNext(String(formData.get("back") ?? ""), "");
  if (backTo && !error) redirect(backTo);
  redirect(`/me?${new URLSearchParams(error ? { error: error.message } : { ok: accept ? "Lesson accepted" : "Request declined" })}#lessons`);
}

export async function cancelLesson(formData: FormData) {
  const userId = await getUserId();
  if (!userId) redirect("/auth/login?next=/me");
  const id = z.uuid().safeParse(formData.get("request_id"));
  if (!id.success) redirect("/me");
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_lesson_request", { p_request: id.data });
  revalidatePath("/me");
  const backTo = safeNext(String(formData.get("back") ?? ""), "");
  if (backTo && !error) redirect(backTo);
  redirect(`/me?${new URLSearchParams(error ? { error: error.message } : { ok: "Request cancelled" })}#lessons`);
}
