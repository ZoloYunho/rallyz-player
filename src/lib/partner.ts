import "server-only";
import { createClient } from "@/lib/supabase/server";
import { bangkokDayRange } from "@/lib/time";
import type { PlayAsk, PlayRequest } from "@/lib/types";

export const PLAY_SELECT =
  "*, author:player_profiles!play_requests_author_id_fkey(id, display_name, avatar_url, level, is_founding_organizer), venue:venues(id, name, district, google_maps_url)";

export type PartnerFilters = {
  day?: string;
  area?: string;
  format?: string;
  level?: number; // undefined = any level
};

export function readPartnerFilters(
  sp: Record<string, string | string[] | undefined>,
  myLevel: number | null,
): PartnerFilters & { levelIsMine: boolean } {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const lv = one("level");
  const parsed = Number(lv);
  const level = lv === "any" ? undefined : Number.isInteger(parsed) && parsed >= 1 && parsed <= 9 ? parsed : (myLevel ?? undefined);
  return {
    day: /^\d{4}-\d{2}-\d{2}$/.test(one("day") ?? "") ? one("day") : undefined,
    area: one("area") || undefined,
    format: ["singles", "doubles", "mixed"].includes(one("format") ?? "") ? one("format") : undefined,
    level,
    levelIsMine: lv === undefined && level !== undefined,
  };
}

export async function listOpenPosts(f: PartnerFilters): Promise<PlayRequest[]> {
  const supabase = await createClient();
  let query = supabase
    .from("play_requests")
    .select(PLAY_SELECT)
    .eq("status", "open")
    .order("starts_at", { ascending: true })
    .limit(100);
  const range = f.day ? bangkokDayRange(f.day) : null;
  if (range) {
    const now = new Date().toISOString();
    query = query.gte("starts_at", range[0] > now ? range[0] : now).lt("starts_at", range[1]);
  } else {
    query = query.gt("starts_at", new Date().toISOString());
  }
  if (f.area) query = query.eq("area", f.area);
  if (f.format) query = query.eq("format", f.format);
  if (f.level) query = query.lte("level_min", f.level).gte("level_max", f.level);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as PlayRequest[];
}

export async function getPost(id: string): Promise<PlayRequest | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("play_requests").select(PLAY_SELECT).eq("id", id).maybeSingle();
  return (data as PlayRequest | null) ?? null;
}

/** The signed-in player's asks, keyed by post id. */
export async function myAsks(postIds?: string[]): Promise<Map<string, PlayAsk>> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const uid = claims?.claims?.sub as string | undefined;
  if (!uid) return new Map();
  let query = supabase.from("play_request_responses").select("*").eq("user_id", uid);
  if (postIds) {
    if (!postIds.length) return new Map();
    query = query.in("request_id", postIds);
  }
  const { data } = await query;
  return new Map(((data ?? []) as PlayAsk[]).map((a) => [a.request_id, a]));
}

export function spotsLeft(p: Pick<PlayRequest, "players_needed" | "accepted_count">): number {
  return Math.max(0, p.players_needed - p.accepted_count);
}
