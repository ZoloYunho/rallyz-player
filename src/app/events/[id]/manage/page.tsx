import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { baht } from "@/lib/constants";
import { getEvent } from "@/lib/events";
import { createClient } from "@/lib/supabase/server";
import { formatDay, formatRelative, formatTimeRange } from "@/lib/time";
import type { ParticipantStatus, PaymentStatus, PublicProfile } from "@/lib/types";
import { SubmitButton } from "@/components/form";
import { Avatar, Badge, ButtonLink, Card, EmptyState, Notice, PageHeader, PlayerLevel, field } from "@/components/ui";
import { cancelEvent, decideParticipant, saveParticipantNote, setPlayerPayment } from "../../actions";

export const metadata: Metadata = { title: "Manage event" };

type Entry = {
  user_id: string;
  status: ParticipantStatus;
  payment_status: PaymentStatus;
  cancelled_late: boolean;
  queued_at: string;
  updated_at: string;
  player: PublicProfile | null;
};

function Hidden({ eventId, userId }: { eventId: string; userId: string }) {
  return (
    <>
      <input type="hidden" name="event_id" value={eventId} />
      <input type="hidden" name="user_id" value={userId} />
    </>
  );
}

function PlayerCell({ e }: { e: Entry }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={e.player?.display_name ?? "?"} url={e.player?.avatar_url} size={32} />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{e.player?.display_name || "Player"}</p>
        <PlayerLevel level={e.player?.level ?? null} />
      </div>
    </div>
  );
}

const PAY_LABEL: Record<PaymentStatus, { text: string; tone: "neutral" | "ball" | "court" }> = {
  unpaid: { text: "Not paid", tone: "neutral" },
  claimed: { text: "Says paid", tone: "ball" },
  paid: { text: "Paid", tone: "court" },
};

export default async function ManageEventPage(props: PageProps<"/events/[id]/manage">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const profile = await requireProfile(`/events/${id}/manage`);
  const event = await getEvent(id);
  if (!event) notFound();
  if (event.organizer_id !== profile.id) redirect(`/events/${id}`);

  const supabase = await createClient();
  const [{ data }, { data: note }] = await Promise.all([
    supabase
      .from("event_participants")
      .select("user_id, status, payment_status, cancelled_late, queued_at, updated_at, player:player_profiles!event_participants_user_id_fkey(id, display_name, avatar_url, level, is_founding_organizer)")
      .eq("event_id", id)
      .order("queued_at"),
    supabase.from("event_private_notes").select("note").eq("event_id", id).maybeSingle(),
  ]);
  const entries = (data ?? []) as unknown as Entry[];
  const by = (s: ParticipantStatus) => entries.filter((e) => e.status === s);
  const pending = by("pending");
  const confirmed = by("confirmed");
  const waitlisted = by("waitlisted");
  const left = entries.filter((e) => e.status === "cancelled" || e.status === "declined");
  const paidCount = confirmed.filter((e) => e.payment_status === "paid").length;
  const locked = !!event.cancelled_at || new Date(event.starts_at) <= new Date();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href={`/events/${id}`} className="text-sm text-muted hover:text-court">← Event page</Link>
        <PageHeader
          title={event.title}
          subtitle={`${formatDay(event.starts_at)} · ${formatTimeRange(event.starts_at, event.ends_at)} · ${event.venue_name}`}
          action={!event.cancelled_at ? <ButtonLink href={`/events/${id}/edit`} variant="secondary">Edit details</ButtonLink> : null}
        />
      </div>

      {typeof sp.error === "string" ? <Notice tone="danger">{sp.error}</Notice> : null}
      {typeof sp.ok === "string" ? <Notice>{sp.ok}</Notice> : null}
      {event.cancelled_at ? <Notice tone="danger">This event is cancelled.</Notice> : null}

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: "Confirmed", value: `${event.confirmed_count}/${event.capacity}` },
          { label: "Requests", value: event.pending_count },
          { label: "Waitlist", value: event.waitlist_count },
          { label: "Paid", value: event.fee_thb > 0 ? `${paidCount}/${confirmed.length}` : "Free" },
        ].map((s) => (
          <Card key={s.label} className="p-4">
            <p className="text-xs text-muted">{s.label}</p>
            <p className="text-2xl font-bold">{s.value}</p>
          </Card>
        ))}
      </div>

      {pending.length ? (
        <Card>
          <h2 className="mb-3 font-semibold">Requests to join</h2>
          <ul className="divide-y divide-line">
            {pending.map((e) => (
              <li key={e.user_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <PlayerCell e={e} />
                <span className="text-xs text-muted">{formatRelative(e.queued_at)}</span>
                {!locked ? (
                  <div className="flex gap-2">
                    <form action={decideParticipant}>
                      <Hidden eventId={id} userId={e.user_id} />
                      <SubmitButton name="decision" value="approve" pending="…">Approve</SubmitButton>
                    </form>
                    <form action={decideParticipant}>
                      <Hidden eventId={id} userId={e.user_id} />
                      <SubmitButton name="decision" value="decline" variant="secondary" pending="…">Decline</SubmitButton>
                    </form>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <h2 className="mb-3 font-semibold">
          Confirmed players {event.fee_thb > 0 ? <span className="font-normal text-muted">· {baht(event.fee_thb)} each</span> : null}
        </h2>
        {confirmed.length === 0 ? (
          <EmptyState title="No confirmed players yet">Share the event link in your groups to fill it.</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {confirmed.map((e) => (
              <li key={e.user_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <PlayerCell e={e} />
                <div className="flex flex-wrap items-center gap-2">
                  {event.fee_thb > 0 ? (
                    <>
                      <Badge tone={PAY_LABEL[e.payment_status].tone}>{PAY_LABEL[e.payment_status].text}</Badge>
                      <form action={setPlayerPayment}>
                        <Hidden eventId={id} userId={e.user_id} />
                        {e.payment_status === "paid" ? (
                          <SubmitButton name="status" value="unpaid" variant="ghost" pending="…">Mark unpaid</SubmitButton>
                        ) : (
                          <SubmitButton name="status" value="paid" variant="secondary" pending="…">Mark paid</SubmitButton>
                        )}
                      </form>
                    </>
                  ) : null}
                  {!locked ? (
                    <form action={decideParticipant}>
                      <Hidden eventId={id} userId={e.user_id} />
                      <SubmitButton name="decision" value="remove" variant="ghost" pending="…">Remove</SubmitButton>
                    </form>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {waitlisted.length ? (
        <Card>
          <h2 className="mb-1 font-semibold">Waitlist</h2>
          <p className="mb-3 text-sm text-muted">Players move up in this order when a spot opens or you add spots.</p>
          <ol className="divide-y divide-line">
            {waitlisted.map((e, i) => (
              <li key={e.user_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="flex items-center gap-3">
                  <span className="w-6 text-center font-mono text-sm text-muted">#{i + 1}</span>
                  <PlayerCell e={e} />
                </div>
                {!locked ? (
                  <form action={decideParticipant}>
                    <Hidden eventId={id} userId={e.user_id} />
                    <SubmitButton name="decision" value="remove" variant="ghost" pending="…">Remove</SubmitButton>
                  </form>
                ) : null}
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      <Card>
        <h2 className="mb-1 font-semibold">Note for confirmed players</h2>
        <p className="mb-3 text-sm text-muted">Only you and confirmed players see this: meeting point, court number, gate code.</p>
        <form action={saveParticipantNote} className="space-y-3">
          <input type="hidden" name="event_id" value={id} />
          <textarea name="note" rows={3} maxLength={2000} defaultValue={note?.note ?? ""} className={field} />
          <SubmitButton variant="secondary">Save note</SubmitButton>
        </form>
      </Card>

      {left.length ? (
        <Card>
          <h2 className="mb-3 font-semibold">Left or declined</h2>
          <ul className="divide-y divide-line">
            {left.map((e) => (
              <li key={e.user_id} className="flex items-center justify-between gap-3 py-3">
                <PlayerCell e={e} />
                <div className="flex gap-2">
                  {e.status === "declined" ? <Badge>Declined</Badge> : <Badge>Left {formatRelative(e.updated_at)}</Badge>}
                  {e.cancelled_late ? <Badge tone="warn">After deadline</Badge> : null}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {!event.cancelled_at ? (
        <Card className="border-danger/30">
          <h2 className="mb-1 font-semibold text-danger">Cancel this event</h2>
          <p className="mb-3 text-sm text-muted">Everyone who joined or is waiting gets a notification. This can&apos;t be undone.</p>
          <form action={cancelEvent} className="flex flex-wrap gap-2">
            <input type="hidden" name="event_id" value={id} />
            <input name="reason" maxLength={300} placeholder="Reason (optional), e.g. rain" className={`${field} flex-1`} />
            <SubmitButton variant="danger" pending="Cancelling…">Cancel event</SubmitButton>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
