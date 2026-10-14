import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { getEvent, listVenueOptions } from "@/lib/events";
import { createClient } from "@/lib/supabase/server";
import { isoToBangkokLocal, todayInBangkok } from "@/lib/time";
import { Notice, PageHeader } from "@/components/ui";
import { EventForm } from "../../event-form";

export const metadata: Metadata = { title: "Edit event" };

export default async function EditEventPage(props: PageProps<"/[sport]/events/[id]/edit">) {
  const { id, sport } = await props.params;
  const profile = await requireProfile(`/${sport}/events/${id}/edit`);
  const event = await getEvent(id);
  if (!event) notFound();
  // Old or mistyped sport in the address: send to the event's own section.
  if (event.sport !== sport) redirect(`/${event.sport}/events/${id}/edit`);
  if (event.organizer_id !== profile.id) redirect(`/${sport}/events/${id}`);
  if (event.cancelled_at) redirect(`/${sport}/events/${id}`);

  const supabase = await createClient();
  const [{ data: note }, venues] = await Promise.all([
    supabase.from("event_private_notes").select("note").eq("event_id", id).maybeSingle(),
    listVenueOptions(),
  ]);
  const start = isoToBangkokLocal(event.starts_at);
  const end = isoToBangkokLocal(event.ends_at);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Edit event" subtitle={event.title} />
      {event.confirmed_count > 0 ? (
        <div className="mb-5">
          <Notice tone="warn">
            {event.confirmed_count} player{event.confirmed_count === 1 ? " has" : "s have"} joined. Tell them in the event chat if
            you change the time or place. Lowering the spots never removes confirmed players.
          </Notice>
        </div>
      ) : null}
      <EventForm
        mode="edit"
        minDate={todayInBangkok()}
        venues={venues}
        values={{
          event_id: event.id,
          title: event.title,
          type: event.type,
          format: event.format,
          date: start.slice(0, 10),
          start_time: start.slice(11, 16),
          end_time: end.slice(11, 16),
          venue_id: event.venue_id,
          venue_name: event.venue_name,
          area: event.area,
          address: event.address ?? "",
          courts: event.courts,
          level_min: event.level_min,
          level_max: event.level_max,
          fee_thb: event.fee_thb,
          capacity: event.capacity,
          entry_mode: event.entry_mode,
          cancel_deadline_hours: event.cancel_deadline_hours,
          cancellation_policy: event.cancellation_policy,
          description: event.description,
          participant_note: note?.note ?? "",
        }}
      />
    </div>
  );
}
