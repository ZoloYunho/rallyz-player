import type { Metadata } from "next";
import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { AREAS, levelName } from "@/lib/constants";
import { EVENT_SELECT } from "@/lib/events";
import { createClient } from "@/lib/supabase/server";
import { formatDay, formatTime } from "@/lib/time";
import type { EventWithOrganizer, LessonRequest, ParticipantStatus, PublicProfile } from "@/lib/types";
import { SubmitButton } from "@/components/form";
import { EventRow } from "@/components/event-row";
import { Avatar, Badge, ButtonLink, Card, EmptyState, FoundingBadge, Notice, PageHeader } from "@/components/ui";
import { signOut } from "@/app/auth/actions";
import { cancelLesson, respondLesson } from "@/app/instructors/actions";
import { PaymentForm, ProfileForm } from "./forms";

export const metadata: Metadata = { title: "My page" };

const STATUS_LABEL: Record<ParticipantStatus, string> = {
  confirmed: "Confirmed",
  waitlisted: "Waitlist",
  pending: "Requested",
  declined: "Declined",
  cancelled: "Left",
};

export default async function MePage(props: PageProps<"/me">) {
  const sp = await props.searchParams;
  const me = await requireProfile("/me");
  const supabase = await createClient();
  const now = new Date().toISOString();

  const [{ data: hosting }, { data: joined }, { data: settings }, { data: coach }, { data: lessons }] = await Promise.all([
    supabase.from("events").select(EVENT_SELECT).eq("organizer_id", me.id).is("cancelled_at", null).gte("starts_at", now).order("starts_at").limit(30),
    supabase
      .from("event_participants")
      .select(`status, event:events!inner(${EVENT_SELECT})`)
      .eq("user_id", me.id)
      .in("status", ["confirmed", "waitlisted", "pending"])
      .gte("event.starts_at", now)
      .limit(50),
    supabase.from("organizer_settings").select("promptpay_id").eq("user_id", me.id).maybeSingle(),
    supabase.from("coach_profiles").select("status").eq("user_id", me.id).maybeSingle(),
    supabase
      .from("lesson_requests")
      .select("*")
      .or(`coach_id.eq.${me.id},player_id.eq.${me.id}`)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const myEvents = ((joined ?? []) as unknown as { status: ParticipantStatus; event: EventWithOrganizer }[])
    .filter((j) => j.event)
    .sort((a, b) => a.event.starts_at.localeCompare(b.event.starts_at));
  const lessonList = (lessons ?? []) as LessonRequest[];
  const otherIds = [...new Set(lessonList.map((l) => (l.coach_id === me.id ? l.player_id : l.coach_id)))];
  const { data: people } = otherIds.length
    ? await supabase.from("player_profiles").select("id, display_name, avatar_url, level, is_founding_organizer").in("id", otherIds)
    : { data: [] };
  const peopleById = new Map(((people ?? []) as PublicProfile[]).map((p) => [p.id, p]));
  const lessonRows = lessonList.map((l) => ({ ...l, player: peopleById.get(l.player_id) ?? null, coach: peopleById.get(l.coach_id) ?? null }));

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <PageHeader
        title="My page"
        action={
          <form action={signOut}>
            <SubmitButton variant="ghost" pending="…">Log out</SubmitButton>
          </form>
        }
      />
      {typeof sp.error === "string" ? <Notice tone="danger">{sp.error}</Notice> : null}
      {typeof sp.ok === "string" ? <Notice>{sp.ok}</Notice> : null}

      <Card className="flex flex-wrap items-center gap-4">
        <Avatar name={me.display_name} url={me.avatar_url} size={56} />
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold">{me.display_name || "Player"}</p>
          <p className="text-sm text-muted">
            {me.level ? <><span className="font-mono">Lv.{me.level}</span> {levelName(me.level)}</> : "No level set"}
            {me.areas.length ? ` · ${me.areas.join(", ")}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {me.is_founding_organizer ? <FoundingBadge /> : null}
          {coach?.status === "approved" ? <Badge tone="court">Instructor</Badge> : null}
          {me.is_admin ? <ButtonLink href="/admin" variant="secondary" className="py-1">Admin</ButtonLink> : null}
        </div>
      </Card>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">My upcoming games</h2>
          <Link href="/events" className="text-sm text-court underline">Find events</Link>
        </div>
        {myEvents.length === 0 ? (
          <EmptyState title="You haven't joined anything yet" />
        ) : (
          <div className="space-y-2">
            {myEvents.map(({ status, event }) => (
              <div key={event.id} className="relative">
                <EventRow event={event} />
                <Badge tone={status === "confirmed" ? "court" : "warn"} className="absolute top-2 right-2">{STATUS_LABEL[status]}</Badge>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Hosting</h2>
          <ButtonLink href="/events/new" variant="accent" className="py-1.5">Host an event</ButtonLink>
        </div>
        {(hosting ?? []).length === 0 ? (
          <EmptyState title="No upcoming events you're hosting" />
        ) : (
          <div className="space-y-2">
            {((hosting ?? []) as EventWithOrganizer[]).map((e) => (
              <div key={e.id} className="relative">
                <EventRow event={e} />
                {e.pending_count ? (
                  <Link href={`/events/${e.id}/manage`} className="absolute top-2 right-2">
                    <Badge tone="warn">{e.pending_count} request{e.pending_count > 1 ? "s" : ""}</Badge>
                  </Link>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <section id="lessons">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Lessons</h2>
          <Link href="/instructors/apply" className="text-sm text-court underline">
            {coach ? "My instructor profile" : "List yourself as an instructor"}
          </Link>
        </div>
        {lessonRows.length === 0 ? (
          <EmptyState title="No lesson requests" />
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
            {lessonRows.map((l) => {
              const iAmCoach = l.coach_id === me.id;
              const other = iAmCoach ? l.player : l.coach;
              return (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={other?.display_name ?? "?"} url={other?.avatar_url} size={32} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {iAmCoach ? `${other?.display_name || "Player"} wants a lesson` : `Lesson with ${other?.display_name || "coach"}`}
                      </p>
                      <p className="text-xs text-muted">
                        {l.kind} · {l.players} player{l.players > 1 ? "s" : ""} · {formatDay(l.preferred_at)} {formatTime(l.preferred_at)}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={l.status === "accepted" ? "court" : l.status === "pending" ? "ball" : "neutral"}>{l.status}</Badge>
                    {l.conversation_id ? <ButtonLink href={`/chat/${l.conversation_id}`} variant="ghost" className="py-1">Chat</ButtonLink> : null}
                    {iAmCoach && l.status === "pending" ? (
                      <>
                        <form action={respondLesson}>
                          <input type="hidden" name="request_id" value={l.id} />
                          <SubmitButton name="decision" value="accept" className="py-1" pending="…">Accept</SubmitButton>
                        </form>
                        <form action={respondLesson}>
                          <input type="hidden" name="request_id" value={l.id} />
                          <SubmitButton name="decision" value="decline" variant="secondary" className="py-1" pending="…">Decline</SubmitButton>
                        </form>
                      </>
                    ) : null}
                    {!iAmCoach && (l.status === "pending" || l.status === "accepted") ? (
                      <form action={cancelLesson}>
                        <input type="hidden" name="request_id" value={l.id} />
                        <SubmitButton variant="ghost" className="py-1" pending="…">Cancel</SubmitButton>
                      </form>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Profile</h2>
          <ProfileForm profile={me} areas={AREAS} />
        </Card>
        <Card>
          <h2 id="payments" className="mb-1 font-semibold">PromptPay for your events</h2>
          <p className="mb-3 text-sm text-muted">
            Players who are confirmed for your paid events see a QR code with the fee filled in. Money goes straight to you; Rallyz never
            touches it. You confirm payments on each event&apos;s Manage page.
          </p>
          <PaymentForm promptpayId={settings?.promptpay_id ?? ""} />
        </Card>
      </section>
    </div>
  );
}
