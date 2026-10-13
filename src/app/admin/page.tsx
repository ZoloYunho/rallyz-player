import type { Metadata } from "next";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { baht, levelRange } from "@/lib/constants";
import { COACH_SELECT } from "@/lib/coaches";
import { createClient } from "@/lib/supabase/server";
import { formatRelative } from "@/lib/time";
import type { CoachWithProfile, PublicProfile } from "@/lib/types";
import { SubmitButton } from "@/components/form";
import { Avatar, Badge, Card, EmptyState, Notice, PageHeader, field } from "@/components/ui";

export const metadata: Metadata = { title: "Admin" };

async function reviewCoach(formData: FormData) {
  "use server";
  await requireAdmin();
  const user = z.uuid().safeParse(formData.get("user_id"));
  if (!user.success) redirect("/admin");
  const approve = formData.get("decision") === "approve";
  const note = String(formData.get("note") ?? "").trim().slice(0, 300) || null;
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_coach", { p_user: user.data, p_approve: approve, p_note: note });
  revalidatePath("/admin");
  revalidatePath("/instructors");
  redirect(`/admin?${new URLSearchParams(error ? { error: error.message } : { ok: approve ? "Instructor approved" : "Sent back for changes" })}`);
}

async function setFounding(formData: FormData) {
  "use server";
  await requireAdmin();
  const user = z.uuid().safeParse(formData.get("user_id"));
  if (!user.success) redirect("/admin");
  const value = formData.get("value") === "1";
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_founding_organizer", { p_user: user.data, p_value: value });
  revalidatePath("/admin");
  redirect(`/admin?${new URLSearchParams(error ? { error: error.message } : { ok: value ? "Founding Organizer badge granted" : "Badge removed" })}#organizers`);
}

function daysAgoIso(days: number) {
  return new Date(Date.now() - days * 86400_000).toISOString();
}

type Metric = { week_start: string; new_players: number; events_posted: number; joins: number; lesson_requests: number; messages_sent: number };

export default async function AdminPage(props: PageProps<"/admin">) {
  const sp = await props.searchParams;
  await requireAdmin();
  const supabase = await createClient();

  const [{ data: pending }, { data: metrics }, { data: events }] = await Promise.all([
    supabase.from("coach_profiles").select(COACH_SELECT).eq("status", "pending").order("updated_at"),
    supabase.rpc("admin_weekly_metrics", { p_weeks: 12 }),
    supabase
      .from("events")
      .select("organizer_id, organizer:player_profiles!events_organizer_id_fkey(id, display_name, avatar_url, level, is_founding_organizer)")
      .gte("created_at", daysAgoIso(60))
      .limit(1000),
  ]);

  // Most active organizers over the last 60 days.
  const counts = new Map<string, { profile: PublicProfile; n: number }>();
  for (const e of (events ?? []) as unknown as { organizer_id: string; organizer: PublicProfile | null }[]) {
    if (!e.organizer) continue;
    const cur = counts.get(e.organizer_id) ?? { profile: e.organizer, n: 0 };
    cur.n += 1;
    counts.set(e.organizer_id, cur);
  }
  const organizers = [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 20);
  const rows = ((metrics ?? []) as Metric[]).map((m) => ({ ...m, week_start: String(m.week_start).slice(0, 10) }));

  return (
    <div className="space-y-8">
      <PageHeader title="Admin" subtitle="Instructor reviews, organizers and weekly numbers." />
      {typeof sp.error === "string" ? <Notice tone="danger">{sp.error}</Notice> : null}
      {typeof sp.ok === "string" ? <Notice>{sp.ok}</Notice> : null}

      <section>
        <h2 className="mb-3 text-lg font-semibold">Instructor profiles to review</h2>
        {(pending ?? []).length === 0 ? (
          <EmptyState title="Nothing to review" />
        ) : (
          <div className="space-y-3">
            {((pending ?? []) as CoachWithProfile[]).map((c) => (
              <Card key={c.user_id} className="space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Avatar name={c.profile?.display_name ?? "?"} url={c.profile?.avatar_url} size={40} />
                  <div className="min-w-0 flex-1">
                    <Link href={`/instructors/${c.user_id}`} className="font-semibold underline">{c.profile?.display_name || "Coach"}</Link>
                    <p className="text-sm text-muted">{c.headline}</p>
                  </div>
                  <span className="text-xs text-muted">Submitted {formatRelative(c.updated_at)}</span>
                </div>
                <div className="flex flex-wrap gap-1.5 text-sm">
                  <Badge>{baht(c.rate_private_thb)}/h</Badge>
                  <Badge tone="court">Teaches {levelRange(c.level_min, c.level_max)}</Badge>
                  <Badge>{c.areas.join(", ")}</Badge>
                  <Badge>{c.languages.join(", ")}</Badge>
                  {c.certifications ? <Badge>{c.certifications}</Badge> : null}
                </div>
                {c.bio ? <p className="line-clamp-4 text-sm whitespace-pre-line text-ink/80">{c.bio}</p> : null}
                <form action={reviewCoach} className="flex flex-wrap gap-2">
                  <input type="hidden" name="user_id" value={c.user_id} />
                  <input name="note" maxLength={300} placeholder="Note if sending back, e.g. add your hourly rate details" className={`${field} min-w-60 flex-1`} />
                  <SubmitButton name="decision" value="approve" pending="…">Approve</SubmitButton>
                  <SubmitButton name="decision" value="reject" variant="secondary" pending="…">Send back</SubmitButton>
                </form>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Weekly numbers</h2>
        <div className="overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full text-sm">
            <thead className="bg-paper text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Week of (Mon)</th>
                <th className="px-4 py-2 text-right font-medium">New players</th>
                <th className="px-4 py-2 text-right font-medium">Events posted</th>
                <th className="px-4 py-2 text-right font-medium">Joins</th>
                <th className="px-4 py-2 text-right font-medium">Lesson requests</th>
                <th className="px-4 py-2 text-right font-medium">Messages</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line font-mono">
              {rows.map((m) => (
                <tr key={m.week_start}>
                  <td className="px-4 py-2 font-sans">{m.week_start}</td>
                  <td className="px-4 py-2 text-right">{m.new_players}</td>
                  <td className="px-4 py-2 text-right">{m.events_posted}</td>
                  <td className="px-4 py-2 text-right">{m.joins}</td>
                  <td className="px-4 py-2 text-right">{m.lesson_requests}</td>
                  <td className="px-4 py-2 text-right">{m.messages_sent}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="organizers">
        <h2 className="mb-1 text-lg font-semibold">Most active organizers (last 60 days)</h2>
        <p className="mb-3 text-sm text-muted">Grant the Founding Organizer badge to the people filling Rallyz with games.</p>
        {organizers.length === 0 ? (
          <EmptyState title="No events yet" />
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
            {organizers.map(({ profile, n }) => (
              <li key={profile.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex items-center gap-3">
                  <Avatar name={profile.display_name} url={profile.avatar_url} size={32} />
                  <span className="font-medium">{profile.display_name || "Organizer"}</span>
                  <Badge>{n} event{n > 1 ? "s" : ""}</Badge>
                </div>
                <form action={setFounding}>
                  <input type="hidden" name="user_id" value={profile.id} />
                  {profile.is_founding_organizer ? (
                    <SubmitButton name="value" value="0" variant="ghost" pending="…">Remove badge</SubmitButton>
                  ) : (
                    <SubmitButton name="value" value="1" variant="accent" pending="…">Make Founding Organizer</SubmitButton>
                  )}
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
