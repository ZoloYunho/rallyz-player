import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";
import { baht, eventTypeLabel, formatLabel, levelName, levelRange } from "@/lib/constants";
import { getEvent } from "@/lib/events";
import { createClient, createPublicClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/supabase/env";
import { formatDay, formatFullDate, formatTime, formatTimeRange } from "@/lib/time";
import type { EventRow, ParticipantStatus, PaymentStatus, RosterEntry } from "@/lib/types";
import { SubmitButton } from "@/components/form";
import { PromptPayQr } from "@/components/promptpay-qr";
import { ShareButton } from "@/components/share-button";
import { Avatar, Badge, ButtonLink, Card, FoundingBadge, LevelBadge, Notice, PlayerLevel } from "@/components/ui";
import { claimPayment, joinEvent, leaveEvent, messageUser } from "../actions";

function summary(e: Pick<EventRow, "starts_at" | "ends_at" | "area" | "level_min" | "level_max" | "fee_thb">) {
  return `${formatDay(e.starts_at)} · ${formatTimeRange(e.starts_at, e.ends_at)} · ${e.area} · ${levelRange(e.level_min, e.level_max)} · ${baht(e.fee_thb)}`;
}

export async function generateMetadata(props: PageProps<"/[sport]/events/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return {};
  const { data } = await createPublicClient()
    .from("events")
    .select("title, starts_at, ends_at, area, level_min, level_max, fee_thb, venue_name")
    .eq("id", id)
    .maybeSingle();
  if (!data) return { title: "Event not found" };
  const description = `${summary(data)} · ${data.venue_name}. Join on Rallyz.`;
  return { title: data.title, description, openGraph: { title: data.title, description, type: "website" } };
}

const MESSAGES: Record<string, (v: string) => { tone: "court" | "warn" | "danger"; text: string }> = {
  created: (v) => ({ tone: "court", text: Number(v) > 1 ? `Published ${v} weekly events. This is the first one.` : "Your event is live. Share the link in your group." }),
  updated: () => ({ tone: "court", text: "Changes saved." }),
  joined: (v) => ({
    tone: v === "waitlisted" ? "warn" : "court",
    text: v === "confirmed" ? "You're in! See you on court." : v === "pending" ? "Request sent. The organizer will confirm you." : "The event is full, so you're on the waitlist. You'll move up automatically if a spot opens.",
  }),
  left: (v) => ({ tone: v === "late" ? "warn" : "court", text: v === "late" ? "You've left. This was after the free cancellation deadline, so check the organizer's policy." : "You've left this event." }),
  paid: (v) => ({ tone: "court", text: v === "claimed" ? "Marked as paid. The organizer will confirm." : "Payment mark removed." }),
  cancelled: () => ({ tone: "warn", text: "Event cancelled. Players have been notified." }),
  error: (v) => ({ tone: "danger", text: v }),
};

export default async function EventPage(props: PageProps<"/[sport]/events/[id]">) {
  const { id, sport } = await props.params;
  const sp = await props.searchParams;
  const event = await getEvent(id);
  if (!event) notFound();
  // Old or mistyped sport in the address: send to the event's own section.
  if (event.sport !== sport) redirect(`/${event.sport}/events/${id}`);

  const profile = await getProfile();
  const supabase = await createClient();
  const isOrganizer = profile?.id === event.organizer_id;

  const [{ data: rosterData }, { data: mine }, { data: chat }] = await Promise.all([
    supabase.rpc("get_roster", { p_event: id }),
    profile
      ? supabase.from("event_participants").select("status, payment_status, cancelled_late").eq("event_id", id).eq("user_id", profile.id).maybeSingle()
      : Promise.resolve({ data: null }),
    profile ? supabase.from("conversations").select("id").eq("event_id", id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const roster = (rosterData ?? []) as RosterEntry[];
  const confirmed = roster.filter((r) => r.status === "confirmed");
  const waitlist = roster.filter((r) => r.status === "waitlisted");
  const my = mine as { status: ParticipantStatus; payment_status: PaymentStatus } | null;
  const myStatus = my?.status;
  const waitPos = profile ? waitlist.findIndex((r) => r.user_id === profile.id) + 1 : 0;

  const canSeeInner = isOrganizer || myStatus === "confirmed";
  const [{ data: note }, { data: payInfo }] = canSeeInner
    ? await Promise.all([
        supabase.from("event_private_notes").select("note").eq("event_id", id).maybeSingle(),
        event.fee_thb > 0 ? supabase.rpc("get_payment_info", { p_event: id }).maybeSingle() : Promise.resolve({ data: null }),
      ])
    : [{ data: null }, { data: null }];
  const promptpayId = (payInfo as { promptpay_id: string | null } | null)?.promptpay_id ?? null;

  const started = new Date(event.starts_at) <= new Date();
  const deadline = new Date(new Date(event.starts_at).getTime() - event.cancel_deadline_hours * 3600_000);
  const pastDeadline = new Date() > deadline;
  const levelOk = !profile?.level || (profile.level >= event.level_min && profile.level <= event.level_max);
  const url = `${siteUrl()}/events/${event.id}`;

  const banners = Object.entries(MESSAGES)
    .filter(([k]) => typeof sp[k] === "string")
    .map(([k, fn]) => fn(sp[k] as string));

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        {banners.map((b, i) => <Notice key={i} tone={b.tone}>{b.text}</Notice>)}
        {event.cancelled_at ? <Notice tone="danger">This event was cancelled by the organizer.</Notice> : null}

        <div>
          <Link href={`/${sport}/events`} className="text-sm text-muted hover:text-court">← All events</Link>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <LevelBadge min={event.level_min} max={event.level_max} />
            <Badge>{eventTypeLabel(event.type)}</Badge>
            <Badge>{formatLabel(event.format)}</Badge>
            <Badge tone={event.entry_mode === "approval" ? "warn" : "court"}>
              {event.entry_mode === "approval" ? "Organizer approves players" : "Instant confirmation"}
            </Badge>
            {event.series_id ? <Badge>Weekly</Badge> : null}
          </div>
          <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{event.title}</h1>
          {event.organizer ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <Avatar name={event.organizer.display_name} url={event.organizer.avatar_url} size={28} />
              <span>
                Hosted by <span className="font-semibold">{event.organizer.display_name || "Organizer"}</span>
              </span>
              {event.organizer.is_founding_organizer ? <FoundingBadge /> : null}
            </div>
          ) : null}
        </div>

      </div>
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-6">
        {canSeeInner && note?.note ? (
          <Card className="border-court/30 bg-court-50">
            <p className="text-xs font-semibold tracking-wide text-court uppercase">For confirmed players</p>
            <p className="mt-1 whitespace-pre-line">{note.note}</p>
          </Card>
        ) : null}

        {event.description ? (
          <Card>
            <h2 className="mb-2 font-semibold">About this event</h2>
            <p className="whitespace-pre-line text-ink/90">{event.description}</p>
          </Card>
        ) : null}

        <Card>
          <h2 className="mb-3 font-semibold">
            Players <span className="font-normal text-muted">· {event.confirmed_count}/{event.capacity}</span>
          </h2>
          {confirmed.length === 0 ? (
            <p className="text-sm text-muted">No one yet. Be the first to join.</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {confirmed.map((p) => (
                <li key={p.user_id} className="flex items-center gap-3">
                  <Avatar name={p.display_name} url={p.avatar_url} size={32} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.display_name || "Player"}</p>
                    <PlayerLevel level={p.level} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          {waitlist.length ? <p className="mt-4 text-sm text-muted">{waitlist.length} on the waitlist.</p> : null}
        </Card>

        <Card>
          <h2 className="mb-2 font-semibold">Cancellations</h2>
          <p className="text-sm text-ink/90">
            {event.cancel_deadline_hours === 0
              ? "You can leave any time before the start."
              : `Free cancellation until ${formatDay(deadline.toISOString())}, ${formatTime(deadline.toISOString())} (${event.cancel_deadline_hours} hours before the start).`}
          </p>
          {event.cancellation_policy ? <p className="mt-2 text-sm text-muted">{event.cancellation_policy}</p> : null}
        </Card>
      </div>

      {/* Summary and actions */}
      <aside className="order-first space-y-4 lg:order-last lg:sticky lg:top-20 lg:self-start">
        <Card className="space-y-3">
          {event.venue?.photos?.[0]?.startsWith("https://") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={event.venue.photos[0]}
              alt={event.venue.name}
              loading="lazy"
              referrerPolicy="no-referrer"
              className="-mx-5 -mt-5 mb-1 aspect-[16/9] w-[calc(100%+2.5rem)] max-w-none rounded-t-2xl object-cover"
            />
          ) : null}
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-muted">When</dt>
              <dd className="font-semibold">{formatFullDate(event.starts_at)}</dd>
              <dd className="font-mono">{formatTimeRange(event.starts_at, event.ends_at)}</dd>
            </div>
            <div>
              <dt className="text-muted">Where</dt>
              <dd className="font-semibold">{event.venue_name}</dd>
              <dd>
                {event.area}
                {event.courts ? ` · ${event.courts} court${event.courts > 1 ? "s" : ""}` : ""}
              </dd>
              {event.address ? <dd className="text-muted">{event.address}</dd> : null}
              <dd>
                <a
                  className="text-court underline"
                  target="_blank"
                  rel="noreferrer"
                  href={
                    event.venue?.google_maps_url?.startsWith("https://")
                      ? event.venue.google_maps_url
                      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${event.venue_name} ${event.address ?? ""} ${event.area} Bangkok`)}`
                  }
                >
                  Open in Maps
                </a>
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <div>
                <dt className="text-muted">Level</dt>
                <dd className="font-semibold">
                  {levelRange(event.level_min, event.level_max)}
                </dd>
                <dd className="text-xs text-muted">
                  {levelName(event.level_min)}
                  {event.level_max !== event.level_min ? ` to ${levelName(event.level_max)}` : ""}
                </dd>
              </div>
              <div className="text-right">
                <dt className="text-muted">Fee</dt>
                <dd className="text-xl font-bold">{baht(event.fee_thb)}</dd>
              </div>
            </div>
            <div>
              <dt className="text-muted">Spots</dt>
              <dd className="font-semibold">
                {event.spots_left > 0 ? `${event.spots_left} of ${event.capacity} left` : `Full${event.waitlist_count ? ` · ${event.waitlist_count} waiting` : ""}`}
              </dd>
            </div>
          </dl>

          <div className="space-y-2 border-t border-line pt-3">
            <ActionArea
              sport={sport}
              eventId={event.id}
              isSignedIn={!!profile}
              isOrganizer={isOrganizer}
              status={myStatus}
              cancelled={!!event.cancelled_at}
              started={started}
              full={event.spots_left <= 0}
              approval={event.entry_mode === "approval"}
              pastDeadline={pastDeadline}
              waitPos={waitPos}
              levelOk={levelOk}
              playerLevel={profile?.level ?? null}
            />
            {chat ? (
              <ButtonLink href={`/chat/${chat.id}`} variant="secondary" className="w-full">Event chat</ButtonLink>
            ) : null}
            {profile && !isOrganizer ? (
              <form action={messageUser}>
                <input type="hidden" name="user_id" value={event.organizer_id} />
                <SubmitButton variant="ghost" className="w-full" pending="Opening chat…">Message the organizer</SubmitButton>
              </form>
            ) : null}
          </div>
        </Card>

        {myStatus === "confirmed" && event.fee_thb > 0 ? (
          <Card className="space-y-3 text-center">
            <h2 className="font-semibold">Pay {baht(event.fee_thb)}</h2>
            {my?.payment_status === "paid" ? (
              <Notice>The organizer confirmed your payment. Thanks!</Notice>
            ) : promptpayId ? (
              <>
                <PromptPayQr promptpayId={promptpayId} amount={event.fee_thb} />
                <p className="text-xs text-muted">Scan with any Thai banking app. The amount is filled in.</p>
                {my?.payment_status === "claimed" ? (
                  <form action={claimPayment}>
                    <input type="hidden" name="event_id" value={event.id} />
                    <input type="hidden" name="status" value="unpaid" />
                    <p className="mb-2 text-sm text-court">Marked as paid. Waiting for the organizer to confirm.</p>
                    <SubmitButton variant="ghost" pending="Updating…">Undo</SubmitButton>
                  </form>
                ) : (
                  <form action={claimPayment}>
                    <input type="hidden" name="event_id" value={event.id} />
                    <SubmitButton className="w-full" pending="Updating…">I&apos;ve paid</SubmitButton>
                  </form>
                )}
              </>
            ) : (
              <p className="text-sm text-muted">The organizer hasn&apos;t added PromptPay yet. Ask them how to pay in the event chat.</p>
            )}
          </Card>
        ) : null}

        <div className="flex justify-center">
          <ShareButton url={url} title={event.title} text={`${event.title}\n${summary(event)}`} />
        </div>
      </aside>
    </div>
    </div>
  );
}

function ActionArea(p: {
  sport: string;
  eventId: string;
  isSignedIn: boolean;
  isOrganizer: boolean;
  status?: ParticipantStatus;
  cancelled: boolean;
  started: boolean;
  full: boolean;
  approval: boolean;
  pastDeadline: boolean;
  waitPos: number;
  levelOk: boolean;
  playerLevel: number | null;
}) {
  if (p.isOrganizer) {
    return (
      <div className="grid grid-cols-2 gap-2">
        <ButtonLink href={`/${p.sport}/events/${p.eventId}/manage`}>Manage</ButtonLink>
        {!p.cancelled ? <ButtonLink href={`/${p.sport}/events/${p.eventId}/edit`} variant="secondary">Edit</ButtonLink> : null}
      </div>
    );
  }
  if (p.cancelled) return <p className="text-sm text-danger">Cancelled</p>;
  if (p.started) return <p className="text-sm text-muted">This event has started.</p>;
  if (!p.isSignedIn) {
    return <ButtonLink href={`/auth/login?next=/${p.sport}/events/${p.eventId}`} className="w-full py-2.5">Log in to join</ButtonLink>;
  }

  const leave = (label: string, warn?: string) => (
    <form action={leaveEvent} className="space-y-2">
      <input type="hidden" name="event_id" value={p.eventId} />
      {warn ? <p className="text-xs text-warn">{warn}</p> : null}
      <SubmitButton variant="danger" className="w-full" pending="Leaving…">{label}</SubmitButton>
    </form>
  );

  switch (p.status) {
    case "confirmed":
      return (
        <>
          <Notice>You&apos;re confirmed.</Notice>
          {leave("Leave event", p.pastDeadline ? "The free cancellation deadline has passed." : undefined)}
        </>
      );
    case "waitlisted":
      return (
        <>
          <Notice tone="warn">You&apos;re #{p.waitPos || "?"} on the waitlist. You&apos;ll move up automatically if a spot opens.</Notice>
          {leave("Leave waitlist")}
        </>
      );
    case "pending":
      return (
        <>
          <Notice tone="warn">Request sent. Waiting for the organizer.</Notice>
          {leave("Withdraw request")}
        </>
      );
    case "declined":
      return <p className="text-sm text-muted">The organizer couldn&apos;t accept you for this event.</p>;
    default: {
      const label = p.approval ? "Request to join" : p.full ? "Join the waitlist" : "Join";
      return (
        <form action={joinEvent} className="space-y-2">
          <input type="hidden" name="event_id" value={p.eventId} />
          {!p.levelOk ? (
            <p className="text-xs text-warn">
              This event is for a different level than yours (Lv.{p.playerLevel}). You can still join, but check with the organizer.
            </p>
          ) : null}
          <SubmitButton variant="accent" className="w-full py-2.5 text-base" pending="Joining…">{label}</SubmitButton>
        </form>
      );
    }
  }
}
