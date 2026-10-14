import type { Metadata } from "next";
import { sportName } from "@/lib/sports";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";
import { baht, levelName, levelRange } from "@/lib/constants";
import { getCoach } from "@/lib/coaches";
import { EVENT_SELECT } from "@/lib/events";
import { createClient } from "@/lib/supabase/server";
import { todayInBangkok } from "@/lib/time";
import type { EventWithOrganizer } from "@/lib/types";
import { EventRow } from "@/components/event-row";
import { Avatar, Badge, ButtonLink, Card, Notice } from "@/components/ui";
import { LessonRequestForm } from "./request-form";

export async function generateMetadata(props: PageProps<"/[sport]/instructors/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const coach = await getCoach(id);
  if (!coach) return { title: "Instructor not found" };
  return {
    title: `${coach.profile?.display_name ?? "Coach"} · ${sportName(coach.sports[0] ?? "tennis")} instructor`,
    description: `${coach.headline} · ${baht(coach.rate_private_thb)}/h · ${coach.areas.join(", ")}`,
  };
}

export default async function InstructorPage(props: PageProps<"/[sport]/instructors/[id]">) {
  const { id, sport } = await props.params;
  const coach = await getCoach(id);
  if (!coach) notFound();
  if (!coach.sports.includes(sport)) redirect(`/${coach.sports[0] ?? sport}/instructors/${id}`);
  const viewer = await getProfile();
  const isSelf = viewer?.id === coach.user_id;

  const supabase = await createClient();
  const { data: lessons } = await supabase
    .from("events")
    .select(EVENT_SELECT)
    .eq("organizer_id", coach.user_id)
    .is("cancelled_at", null)
    .gte("starts_at", new Date().toISOString())
    .order("starts_at")
    .limit(10);
  const upcoming = (lessons ?? []) as EventWithOrganizer[];
  const name = coach.profile?.display_name || "Coach";

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-6">
        <Link href={`/${sport}/instructors`} className="text-sm text-muted hover:text-court">← All instructors</Link>
        {coach.status !== "approved" ? (
          <Notice tone="warn">This profile is {coach.status === "pending" ? "in review" : "not approved yet"} and only visible to you.</Notice>
        ) : null}

        <div className="flex items-center gap-4">
          <Avatar name={name} url={coach.profile?.avatar_url} size={72} />
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{name}</h1>
            <p className="text-muted">{coach.headline}</p>
          </div>
        </div>

        <Card>
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted">Private lesson</dt>
              <dd className="text-xl font-bold">{baht(coach.rate_private_thb)}<span className="text-sm font-normal text-muted"> / hour</span></dd>
            </div>
            {coach.rate_group_thb ? (
              <div>
                <dt className="text-muted">Group lesson</dt>
                <dd className="text-xl font-bold">{baht(coach.rate_group_thb)}<span className="text-sm font-normal text-muted"> / hour</span></dd>
              </div>
            ) : null}
            <div>
              <dt className="text-muted">Teaches</dt>
              <dd className="font-semibold">{levelRange(coach.level_min, coach.level_max)}</dd>
              <dd className="text-xs text-muted">{levelName(coach.level_min)} to {levelName(coach.level_max)}</dd>
            </div>
            <div>
              <dt className="text-muted">Languages</dt>
              <dd className="mt-1 flex flex-wrap gap-1">{coach.languages.map((l) => <Badge key={l}>{l}</Badge>)}</dd>
            </div>
            <div>
              <dt className="text-muted">Areas</dt>
              <dd className="font-semibold">{coach.areas.join(" · ")}</dd>
            </div>
            {coach.venues ? (
              <div>
                <dt className="text-muted">Usual courts</dt>
                <dd>{coach.venues}</dd>
              </div>
            ) : null}
            {coach.years_coaching != null ? (
              <div>
                <dt className="text-muted">Coaching for</dt>
                <dd className="font-semibold">{coach.years_coaching} year{coach.years_coaching === 1 ? "" : "s"}</dd>
              </div>
            ) : null}
            {coach.certifications ? (
              <div>
                <dt className="text-muted">Certifications</dt>
                <dd>{coach.certifications}</dd>
              </div>
            ) : null}
          </dl>
          {coach.trial_offer ? (
            <div className="mt-4">
              <Notice>Trial: {coach.trial_offer}</Notice>
            </div>
          ) : null}
        </Card>

        {coach.bio ? (
          <Card>
            <h2 className="mb-2 font-semibold">About</h2>
            <p className="whitespace-pre-line text-ink/90">{coach.bio}</p>
          </Card>
        ) : null}

        {upcoming.length ? (
          <section>
            <h2 className="mb-3 font-semibold">Upcoming sessions</h2>
            <div className="space-y-2">{upcoming.map((e) => <EventRow key={e.id} event={e} />)}</div>
          </section>
        ) : null}
      </div>

      <aside className="lg:sticky lg:top-20 lg:self-start">
        <Card>
          {isSelf ? (
            <div className="space-y-2">
              <p className="text-sm text-muted">This is your public instructor profile.</p>
              <ButtonLink href={`/${sport}/instructors/apply`} variant="secondary" className="w-full">Edit profile</ButtonLink>
              <ButtonLink href={`/${sport}/events/new`} className="w-full">Post a group lesson</ButtonLink>
            </div>
          ) : !viewer ? (
            <ButtonLink href={`/auth/login?next=/${sport}/instructors/${coach.user_id}`} className="w-full py-2.5">Log in to request a lesson</ButtonLink>
          ) : (
            <>
              <h2 className="mb-3 font-semibold">Request a lesson</h2>
              <LessonRequestForm coachId={coach.user_id} hasGroup={!!coach.rate_group_thb} minDate={todayInBangkok()} />
            </>
          )}
        </Card>
      </aside>
    </div>
  );
}
