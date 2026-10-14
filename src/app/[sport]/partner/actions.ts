"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getProfile, getUserId, safeNext } from "@/lib/auth";
import { AREAS, REPORT_REASONS } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";
import { bangkokLocalToIso } from "@/lib/time";
import { postSport } from "@/lib/sport-of";
import { DEFAULT_SPORT, toSport } from "@/lib/sports";
import type { ActionState } from "@/lib/types";

const uuid = z.uuid();

async function requireUser(next: string) {
  const userId = await getUserId();
  if (!userId) redirect(`/auth/login?next=${encodeURIComponent(next)}`);
  return userId;
}

function back(path: string, params: Record<string, string>): never {
  revalidatePath("/[sport]/partner", "page");
  revalidatePath(path);
  revalidatePath("/me");
  const qs = new URLSearchParams(params).toString();
  redirect(qs ? `${path}?${qs}` : path);
}

export async function acceptSafety(formData: FormData) {
  const sport = toSport(formData.get("sport"));
  const userId = await requireUser(`/${sport}/partner/safety`);
  const supabase = await createClient();
  await supabase.from("player_profiles").update({ safety_ack_at: new Date().toISOString() }).eq("id", userId);
  revalidatePath(`/${sport}/partner`);
  redirect(safeNext(String(formData.get("next") ?? ""), `/${sport}/partner`));
}

const postSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
    start_time: z.string().regex(/^\d{2}:\d{2}$/, "Pick a start time"),
    end_time: z.string().regex(/^\d{2}:\d{2}$/, "Pick an end time"),
    area: z.enum(AREAS, "Pick an area"),
    venue_id: z.uuid().optional(),
    venue_name: z.string().trim().max(120).optional(),
    court_booked: z.boolean(),
    format: z.enum(["singles", "doubles", "mixed"]),
    players_needed: z.coerce.number().int().min(1).max(3),
    level_min: z.coerce.number().int().min(1).max(9),
    level_max: z.coerce.number().int().min(1).max(9),
    note: z.string().trim().max(500).default(""),
  })
  .refine((v) => v.end_time > v.start_time, { message: "End time must be after the start time", path: ["end_time"] })
  .refine((v) => v.level_max >= v.level_min, { message: "Highest level must be at or above the lowest", path: ["level_max"] });

export async function createPost(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const sport = toSport(formData.get("sport"));
  const profile = await getProfile();
  if (!profile) redirect(`/auth/login?next=/${sport}/partner/new`);
  if (!profile.onboarded) redirect(`/onboarding?next=/${sport}/partner/new`);
  if (!profile.safety_ack_at) redirect(`/${sport}/partner/safety?next=/${sport}/partner/new`);

  const get = (k: string) => {
    const v = formData.get(k);
    return v === null || v === "" ? undefined : v;
  };
  const parsed = postSchema.safeParse({
    date: get("date"),
    start_time: get("start_time"),
    end_time: get("end_time"),
    area: get("area"),
    venue_id: get("venue_id"),
    venue_name: get("venue_name"),
    court_booked: formData.get("court_booked") === "yes",
    format: get("format"),
    players_needed: get("players_needed") ?? 1,
    level_min: get("level_min"),
    level_max: get("level_max"),
    note: get("note"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const v = parsed.data;

  const starts = bangkokLocalToIso(`${v.date}T${v.start_time}`);
  const ends = bangkokLocalToIso(`${v.date}T${v.end_time}`);
  if (!starts || !ends) return { error: "Check the date and times." };

  const supabase = await createClient();
  let venueName = v.venue_name ?? null;
  if (v.venue_id) {
    const { data: venue } = await supabase.from("venues").select("name").eq("id", v.venue_id).eq("is_active", true).maybeSingle();
    if (!venue) return { error: "That venue isn't available. Pick another or leave it empty." };
    venueName = venue.name;
  }

  const { data, error } = await supabase
    .from("play_requests")
    .insert({
      author_id: profile.id,
      sport,
      starts_at: starts,
      ends_at: ends,
      area: v.area,
      venue_id: v.venue_id ?? null,
      venue_name: venueName,
      court_booked: v.court_booked,
      format: v.format,
      players_needed: v.format === "singles" ? 1 : v.players_needed,
      level_min: v.level_min,
      level_max: v.level_max,
      note: v.note,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Could not post." };
  back(`/${sport}/partner/${data.id}`, { posted: "1" });
}

export async function askToPlay(formData: FormData) {
  const id = uuid.safeParse(formData.get("post_id"));
  if (!id.success) redirect(`/${DEFAULT_SPORT}/partner`);
  const sport = await postSport(id.data);
  await requireUser(`/${sport}/partner/${id.data}`);
  const profile = await getProfile();
  if (!profile?.onboarded) redirect(`/onboarding?next=/${sport}/partner/${id.data}`);
  if (!profile.safety_ack_at) redirect(`/${sport}/partner/safety?next=/${sport}/partner/${id.data}`);
  const supabase = await createClient();
  const { error } = await supabase.rpc("ask_to_play", {
    p_request: id.data,
    p_message: String(formData.get("message") ?? "").slice(0, 500),
  });
  if (error) back(`/${sport}/partner/${id.data}`, { error: error.message });
  back(`/${sport}/partner/${id.data}`, { asked: "1" });
}

export async function answerAsk(formData: FormData) {
  const id = uuid.safeParse(formData.get("post_id"));
  const player = uuid.safeParse(formData.get("user_id"));
  if (!id.success || !player.success) redirect(`/${DEFAULT_SPORT}/partner`);
  const sport = await postSport(id.data);
  await requireUser(`/${sport}/partner/${id.data}`);
  const accept = formData.get("decision") === "accept";
  const supabase = await createClient();
  const { error } = await supabase.rpc("answer_play_ask", { p_request: id.data, p_user: player.data, p_accept: accept });
  if (error) back(`/${sport}/partner/${id.data}`, { error: error.message });
  back(`/${sport}/partner/${id.data}`, { answered: accept ? "accepted" : "declined" });
}

export async function withdrawAsk(formData: FormData) {
  const id = uuid.safeParse(formData.get("post_id"));
  if (!id.success) redirect(`/${DEFAULT_SPORT}/partner`);
  const sport = await postSport(id.data);
  await requireUser(`/${sport}/partner/${id.data}`);
  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_play_ask", { p_request: id.data });
  if (error) back(`/${sport}/partner/${id.data}`, { error: error.message });
  back(`/${sport}/partner/${id.data}`, { withdrawn: "1" });
}

export async function cancelPost(formData: FormData) {
  const id = uuid.safeParse(formData.get("post_id"));
  if (!id.success) redirect(`/${DEFAULT_SPORT}/partner`);
  const sport = await postSport(id.data);
  await requireUser(`/${sport}/partner/${id.data}`);
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_play_request", { p_request: id.data });
  if (error) back(`/${sport}/partner/${id.data}`, { error: error.message });
  back(`/${sport}/partner/${id.data}`, { cancelled: "1" });
}

export async function blockPlayer(formData: FormData) {
  const sport = DEFAULT_SPORT;
  const userId = await requireUser(`/${sport}/partner`);
  const other = uuid.safeParse(formData.get("user_id"));
  if (!other.success || other.data === userId) redirect(`/${sport}/partner`);
  const supabase = await createClient();
  const { error } = await supabase.from("user_blocks").insert({ blocker_id: userId, blocked_id: other.data });
  revalidatePath("/chat");
  // Duplicate block = already blocked; fine.
  back(safeNext(String(formData.get("back") ?? ""), `/${sport}/partner`), error && error.code !== "23505" ? { error: error.message } : { blocked: "1" });
}

export async function unblockPlayer(formData: FormData) {
  const userId = await requireUser("/me");
  const other = uuid.safeParse(formData.get("user_id"));
  if (!other.success) redirect("/me");
  const supabase = await createClient();
  await supabase.from("user_blocks").delete().eq("blocker_id", userId).eq("blocked_id", other.data);
  back("/me", { ok: "Unblocked" });
}

const reportSchema = z.object({
  user_id: z.uuid(),
  reason: z.enum(REPORT_REASONS.map((r) => r.value) as [string, ...string[]]),
  details: z.string().trim().max(1000).default(""),
  post_id: z.uuid().optional(),
});

export async function reportPlayer(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser(`/${DEFAULT_SPORT}/partner`);
  const parsed = reportSchema.safeParse({
    user_id: formData.get("user_id"),
    reason: formData.get("reason"),
    details: formData.get("details") ?? "",
    post_id: formData.get("post_id") || undefined,
  });
  if (!parsed.success) return { error: "Pick a reason for the report." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("report_player", {
    p_user: parsed.data.user_id,
    p_reason: parsed.data.reason,
    p_details: parsed.data.details,
    p_request: parsed.data.post_id ?? null,
  });
  if (error) return { error: error.message };
  return { ok: "Thanks. The Rallyz team will review this. You can also block this player." };
}
