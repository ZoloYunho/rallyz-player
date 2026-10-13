import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { CoachWithProfile } from "@/lib/types";

export const COACH_SELECT =
  "*, profile:profiles!coach_profiles_user_id_fkey(id, display_name, avatar_url, level, is_founding_organizer)";

export type CoachFilters = { area?: string; level?: number; maxPrice?: number; language?: string };

export function readCoachFilters(sp: Record<string, string | string[] | undefined>): CoachFilters {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const level = Number(one("level"));
  const maxPrice = Number(one("max"));
  return {
    area: one("area") || undefined,
    level: Number.isInteger(level) && level >= 1 && level <= 9 ? level : undefined,
    maxPrice: Number.isFinite(maxPrice) && maxPrice > 0 ? maxPrice : undefined,
    language: one("lang") || undefined,
  };
}

export async function listCoaches(f: CoachFilters): Promise<CoachWithProfile[]> {
  const supabase = await createClient();
  let query = supabase.from("coach_profiles").select(COACH_SELECT).eq("status", "approved").order("updated_at", { ascending: false }).limit(100);
  if (f.area) query = query.contains("areas", [f.area]);
  if (f.language) query = query.contains("languages", [f.language]);
  if (f.level) query = query.lte("level_min", f.level).gte("level_max", f.level);
  if (f.maxPrice) query = query.lte("rate_private_thb", f.maxPrice);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as CoachWithProfile[];
}

export async function getCoach(userId: string): Promise<CoachWithProfile | null> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("coach_profiles").select(COACH_SELECT).eq("user_id", userId).maybeSingle();
  return (data as CoachWithProfile | null) ?? null;
}
