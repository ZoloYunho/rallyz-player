"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getProfile, getUserId } from "@/lib/auth";
import { AREAS } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";
import { bangkokLocalToIso } from "@/lib/time";
import type { ActionState } from "@/lib/types";

const uuid = z.uuid();

const eventSchema = z
  .object({
    title: z.string().trim().min(3, "Give the event a title (3+ characters)").max(120),
    type: z.enum(["practice", "match_play", "lesson", "tournament", "social"]),
    format: z.enum(["singles", "doubles", "mixed"]),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
    start_time: z.string().regex(/^\d{2}:\d{2}$/, "Pick a start time"),
    end_time: z.string().regex(/^\d{2}:\d{2}$/, "Pick an end time"),
    venue_id: z.uuid().optional(),
    venue_name: z.string().trim().max(120).optional(),
    area: z.enum(AREAS, "Pick an area"),
    address: z.string().trim().max(300).optional(),
    courts: z.coerce.number().int().min(1).max(50).optional(),
    level_min: z.coerce.number().int().min(1).max(9),
    level_max: z.coerce.number().int().min(1).max(9),
    fee_thb: z.coerce.number().int("Use whole baht").min(0).max(100000),
    capacity: z.coerce.number().int().min(1, "At least 1 player").max(200),
    entry_mode: z.enum(["instant", "approval"]),
    cancel_deadline_hours: z.coerce.number().int().min(0).max(168),
    cancellation_policy: z.string().trim().max(1000).optional().default(""),
    description: z.string().trim().max(5000).optional().default(""),
    participant_note: z.string().trim().max(2000).optional().default(""),
    repeat_weeks: z.coerce.number().int().min(1).max(12).optional().default(1),
  })
  .refine((v) => v.level_max >= v.level_min, { message: "Highest level must be at or above the lowest", path: ["level_max"] })
  .refine((v) => v.end_time > v.start_time, { message: "End time must be after the start time", path: ["end_time"] })
  .refine((v) => v.venue_id || (v.venue_name && v.venue_name.length >= 2), {
    message: "Pick a venue from the list, or type the venue name",
    path: ["venue_name"],
  });

function readEventForm(formData: FormData) {
  const get = (k: string) => {
    const v = formData.get(k);
    return v === null || v === "" ? undefined : v;
  };
  return eventSchema.safeParse({
    title: get("title"),
    type: get("type"),
    format: get("format"),
    date: get("date"),
    start_time: get("start_time"),
    end_time: get("end_time"),
    venue_id: get("venue_id"),
    venue_name: get("venue_name"),
    area: get("area"),
    address: get("address"),
    courts: get("courts"),
    level_min: get("level_min"),
    level_max: get("level_max"),
    fee_thb: get("fee_thb") ?? 0,
    capacity: get("capacity"),
    entry_mode: get("entry_mode"),
    cancel_deadline_hours: get("cancel_deadline_hours") ?? 24,
    cancellation_policy: get("cancellation_policy"),
    description: get("description"),
    participant_note: get("participant_note"),
    repeat_weeks: get("repeat_weeks"),
  });
}

type ResolvedVenue = { venue_id: string | null; venue_name: string; address: string | null };

/** Uses the chosen venue from the main site's list, or the typed-in name. */
async function resolveVenue(v: z.infer<typeof eventSchema>): Promise<ResolvedVenue | { error: string }> {
  if (!v.venue_id) return { venue_id: null, venue_name: v.venue_name!, address: v.address ?? null };
  const supabase = await createClient();
  const { data } = await supabase.from("venues").select("id, name, address").eq("id", v.venue_id).eq("is_active", true).maybeSingle();
  if (!data) return { error: "That venue isn't available. Pick another or type the name." };
  return { venue_id: data.id, venue_name: data.name, address: v.address || data.address || null };
}

function toRow(v: z.infer<typeof eventSchema>, venue: ResolvedVenue, weekOffset: number) {
  const start = new Date(bangkokLocalToIso(`${v.date}T${v.start_time}`)!);
  const end = new Date(bangkokLocalToIso(`${v.date}T${v.end_time}`)!);
  const shift = weekOffset * 7 * 86400_000;
  return {
    title: v.title,
    type: v.type,
    format: v.format,
    starts_at: new Date(start.getTime() + shift).toISOString(),
    ends_at: new Date(end.getTime() + shift).toISOString(),
    venue_id: venue.venue_id,
    venue_name: venue.venue_name,
    area: v.area,
    address: venue.address,
    courts: v.courts ?? null,
    level_min: v.level_min,
    level_max: v.level_max,
    fee_thb: v.fee_thb,
    capacity: v.capacity,
    entry_mode: v.entry_mode,
    cancel_deadline_hours: v.cancel_deadline_hours,
    cancellation_policy: v.cancellation_policy,
    description: v.description,
  };
}

export async function createEvent(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await getProfile();
  if (!profile) redirect("/auth/login?next=/events/new");
  if (!profile.onboarded) redirect("/onboarding?next=/events/new");

  const parsed = readEventForm(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const v = parsed.data;
  if (new Date(bangkokLocalToIso(`${v.date}T${v.start_time}`)!) <= new Date()) {
    return { error: "Pick a start time in the future." };
  }

  const venue = await resolveVenue(v);
  if ("error" in venue) return { error: venue.error };

  const seriesId = v.repeat_weeks > 1 ? crypto.randomUUID() : null;
  const rows = Array.from({ length: v.repeat_weeks }, (_, i) => ({
    ...toRow(v, venue, i),
    organizer_id: profile.id,
    series_id: seriesId,
  }));

  const supabase = await createClient();
  const { data, error } = await supabase.from("events").insert(rows).select("id").order("starts_at");
  if (error || !data?.length) return { error: error?.message ?? "Could not create the event." };

  if (v.participant_note) {
    await supabase
      .from("event_private_notes")
      .update({ note: v.participant_note })
      .in("event_id", data.map((d) => d.id));
  }

  revalidatePath("/events");
  redirect(`/events/${data[0].id}?created=${data.length}`);
}

export async function updateEvent(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await getUserId();
  if (!userId) redirect("/auth/login");
  const id = uuid.safeParse(formData.get("event_id"));
  if (!id.success) return { error: "Unknown event." };

  const parsed = readEventForm(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const venue = await resolveVenue(parsed.data);
  if ("error" in venue) return { error: venue.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .update(toRow(parsed.data, venue, 0))
    .eq("id", id.data)
    .eq("organizer_id", userId)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "You can only edit your own events that aren't cancelled." };

  await supabase.from("event_private_notes").update({ note: parsed.data.participant_note }).eq("event_id", id.data);

  revalidatePath(`/events/${id.data}`);
  revalidatePath("/events");
  redirect(`/events/${id.data}?updated=1`);
}

// --- Player and organizer actions. These redirect back with a message so
// they work as plain forms.

function back(eventId: string, params: Record<string, string>, path = ""): never {
  revalidatePath(`/events/${eventId}`);
  revalidatePath(`/events/${eventId}/manage`);
  revalidatePath("/events");
  redirect(`/events/${eventId}${path}?${new URLSearchParams(params).toString()}`);
}

async function eventIdFrom(formData: FormData) {
  const id = uuid.safeParse(formData.get("event_id"));
  if (!id.success) redirect("/events");
  const userId = await getUserId();
  if (!userId) redirect(`/auth/login?next=/events/${id.data}`);
  return id.data;
}

export async function joinEvent(formData: FormData) {
  const eventId = await eventIdFrom(formData);
  const profile = await getProfile();
  if (!profile?.onboarded) redirect(`/onboarding?next=/events/${eventId}`);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("join_event", { p_event: eventId });
  if (error) back(eventId, { error: error.message });
  back(eventId, { joined: String(data) });
}

export async function leaveEvent(formData: FormData) {
  const eventId = await eventIdFrom(formData);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("leave_event", { p_event: eventId });
  if (error) back(eventId, { error: error.message });
  back(eventId, { left: data ? "late" : "1" });
}

export async function claimPayment(formData: FormData) {
  const eventId = await eventIdFrom(formData);
  const userId = (await getUserId())!;
  const supabase = await createClient();
  const status = formData.get("status") === "unpaid" ? "unpaid" : "claimed";
  const { error } = await supabase.rpc("set_payment_status", { p_event: eventId, p_user: userId, p_status: status });
  if (error) back(eventId, { error: error.message });
  back(eventId, { paid: status });
}

export async function messageUser(formData: FormData) {
  const other = uuid.safeParse(formData.get("user_id"));
  const userId = await getUserId();
  if (!userId) redirect("/auth/login");
  if (!other.success) redirect("/chat");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_or_create_direct", { p_other: other.data });
  if (error || !data) redirect(`/chat?error=${encodeURIComponent(error?.message ?? "Could not open chat")}`);
  redirect(`/chat/${data}`);
}

// --- Organizer tools

export async function decideParticipant(formData: FormData) {
  const eventId = await eventIdFrom(formData);
  const player = uuid.safeParse(formData.get("user_id"));
  if (!player.success) back(eventId, { error: "Unknown player" }, "/manage");
  const approve = formData.get("decision") === "approve";
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_participant", { p_event: eventId, p_user: player.data, p_approve: approve });
  if (error) back(eventId, { error: error.message }, "/manage");
  back(eventId, { ok: approve ? "Approved" : "Removed" }, "/manage");
}

export async function setPlayerPayment(formData: FormData) {
  const eventId = await eventIdFrom(formData);
  const player = uuid.safeParse(formData.get("user_id"));
  const status = z.enum(["unpaid", "claimed", "paid"]).safeParse(formData.get("status"));
  if (!player.success || !status.success) back(eventId, { error: "Invalid payment update" }, "/manage");
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_payment_status", {
    p_event: eventId,
    p_user: player.data,
    p_status: status.data,
  });
  if (error) back(eventId, { error: error.message }, "/manage");
  back(eventId, { ok: "Payment updated" }, "/manage");
}

export async function saveParticipantNote(formData: FormData) {
  const eventId = await eventIdFrom(formData);
  const note = String(formData.get("note") ?? "").trim().slice(0, 2000);
  const supabase = await createClient();
  const { error } = await supabase.from("event_private_notes").update({ note }).eq("event_id", eventId);
  if (error) back(eventId, { error: error.message }, "/manage");
  back(eventId, { ok: "Note saved" }, "/manage");
}

export async function cancelEvent(formData: FormData) {
  const eventId = await eventIdFrom(formData);
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 300);
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_event", { p_event: eventId, p_reason: reason });
  if (error) back(eventId, { error: error.message }, "/manage");
  back(eventId, { cancelled: "1" });
}
