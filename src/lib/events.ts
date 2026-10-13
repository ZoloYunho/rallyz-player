import "server-only";
import { EVENT_TYPES } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";
import { bangkokDayRange } from "@/lib/time";
import type { EventWithOrganizer } from "@/lib/types";

export const EVENT_SELECT =
  "*, organizer:profiles!events_organizer_id_fkey(id, display_name, avatar_url, level, is_founding_organizer)";

export type EventFilters = {
  day?: string;
  area?: string;
  level?: number;
  type?: string;
  open?: boolean;
  q?: string;
  limit?: number;
};

export function readEventFilters(sp: Record<string, string | string[] | undefined>): EventFilters {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const level = Number(one("level"));
  const limit = Number(one("limit"));
  return {
    day: /^\d{4}-\d{2}-\d{2}$/.test(one("day") ?? "") ? one("day") : undefined,
    area: one("area") || undefined,
    level: Number.isInteger(level) && level >= 1 && level <= 9 ? level : undefined,
    type: EVENT_TYPES.some((t) => t.value === one("type")) ? one("type") : undefined,
    open: one("open") === "1",
    q: one("q")?.trim().slice(0, 80) || undefined,
    limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 50,
  };
}

export async function listEvents(filters: EventFilters): Promise<EventWithOrganizer[]> {
  const supabase = await createClient();
  let query = supabase
    .from("events")
    .select(EVENT_SELECT)
    .is("cancelled_at", null)
    .order("starts_at", { ascending: true })
    .limit(filters.limit ?? 50);

  const range = filters.day ? bangkokDayRange(filters.day) : null;
  if (range) {
    const from = new Date(range[0]) > new Date() ? range[0] : new Date().toISOString();
    query = query.gte("starts_at", from).lt("starts_at", range[1]);
  } else {
    query = query.gte("starts_at", new Date().toISOString());
  }
  if (filters.area) query = query.eq("area", filters.area);
  if (filters.level) query = query.lte("level_min", filters.level).gte("level_max", filters.level);
  if (filters.type) query = query.eq("type", filters.type);
  if (filters.open) query = query.gt("spots_left", 0);
  if (filters.q) {
    const term = filters.q.replace(/[%,()]/g, " ");
    query = query.or(`title.ilike.%${term}%,venue_name.ilike.%${term}%`);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as EventWithOrganizer[];
}

export async function getEvent(id: string): Promise<EventWithOrganizer | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("events").select(EVENT_SELECT).eq("id", id).maybeSingle();
  return (data as EventWithOrganizer | null) ?? null;
}
