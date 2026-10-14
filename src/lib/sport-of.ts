import "server-only";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_SPORT, toSport, type Sport } from "@/lib/sports";

/** Which sport an event, post or instructor belongs to (for links and redirects). */
export async function eventSport(id: string): Promise<Sport> {
  const supabase = await createClient();
  const { data } = await supabase.from("events").select("sport").eq("id", id).maybeSingle();
  return toSport(data?.sport);
}

export async function postSport(id: string): Promise<Sport> {
  const supabase = await createClient();
  const { data } = await supabase.from("play_requests").select("sport").eq("id", id).maybeSingle();
  return toSport(data?.sport);
}

export async function coachSport(userId: string): Promise<Sport> {
  const supabase = await createClient();
  const { data } = await supabase.from("coach_profiles").select("sports").eq("user_id", userId).maybeSingle();
  return toSport((data?.sports as string[] | undefined)?.[0] ?? DEFAULT_SPORT);
}
