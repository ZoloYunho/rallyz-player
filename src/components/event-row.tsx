import Link from "next/link";
import { baht, eventTypeLabel, formatLabel } from "@/lib/constants";
import { formatDay, formatTimeRange } from "@/lib/time";
import type { EventWithOrganizer } from "@/lib/types";
import { Badge, LevelBadge } from "@/components/ui";

export function SpotsLabel({ event }: { event: Pick<EventWithOrganizer, "spots_left" | "capacity" | "waitlist_count"> }) {
  if (event.spots_left <= 0) {
    return (
      <Badge tone="warn">
        Full{event.waitlist_count ? ` · ${event.waitlist_count} waiting` : " · join waitlist"}
      </Badge>
    );
  }
  return (
    <Badge tone={event.spots_left <= 2 ? "ball" : "neutral"}>
      {event.spots_left} of {event.capacity} spots left
    </Badge>
  );
}

/**
 * One event in a list. Price and open spots are on the row itself, so players
 * don't have to open each event (or ask in a group) to find out.
 */
export function EventRow({ event }: { event: EventWithOrganizer }) {
  return (
    <Link
      href={`/${event.sport}/events/${event.id}`}
      className="group grid grid-cols-[4.5rem_1fr] gap-4 rounded-xl border border-line bg-white p-4 transition hover:border-court sm:grid-cols-[5.5rem_1fr_auto]"
    >
      <div className="text-center">
        <p className="text-xs font-semibold tracking-wide text-muted uppercase">{formatDay(event.starts_at).split(" ")[0]}</p>
        <p className="text-lg leading-tight font-bold">{formatDay(event.starts_at).split(" ").slice(1).join(" ")}</p>
        <p className="mt-1 font-mono text-xs text-muted">{formatTimeRange(event.starts_at, event.ends_at)}</p>
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <LevelBadge min={event.level_min} max={event.level_max} />
          <Badge>{eventTypeLabel(event.type)}</Badge>
          <Badge>{formatLabel(event.format)}</Badge>
          {event.entry_mode === "approval" ? <Badge tone="warn">Approval</Badge> : null}
        </div>
        <p className="mt-1.5 truncate font-semibold group-hover:text-court">{event.title}</p>
        <p className="truncate text-sm text-muted">
          {event.area} · {event.venue_name}
          {event.organizer ? ` · by ${event.organizer.display_name || "Organizer"}` : ""}
          {event.organizer?.is_founding_organizer ? " ★" : ""}
        </p>
      </div>

      <div className="col-span-2 flex items-center justify-between gap-2 sm:col-span-1 sm:flex-col sm:items-end sm:justify-center">
        <p className="text-lg font-bold">{baht(event.fee_thb)}</p>
        <SpotsLabel event={event} />
      </div>
    </Link>
  );
}
