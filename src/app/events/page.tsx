import type { Metadata } from "next";
import Link from "next/link";
import { getProfile } from "@/lib/auth";
import { AREAS, EVENT_TYPES, LEVELS } from "@/lib/constants";
import { listEvents, readEventFilters } from "@/lib/events";
import { formatFullDate, todayInBangkok } from "@/lib/time";
import { EventRow } from "@/components/event-row";
import { ButtonLink, EmptyState, PageHeader, btn, cx, field } from "@/components/ui";

export const metadata: Metadata = {
  title: "Tennis events in Bangkok",
  description: "Practice sessions, match play, group lessons and tournaments, filtered by level and area.",
};

export default async function EventsPage(props: PageProps<"/events">) {
  const sp = await props.searchParams;
  const filters = readEventFilters(sp);
  const profile = await getProfile();
  const events = await listEvents(filters);

  // Group by Bangkok day for scanning.
  const groups = new Map<string, typeof events>();
  for (const e of events) {
    const key = formatFullDate(e.starts_at);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }

  const active = Object.entries(filters).some(([k, v]) => k !== "limit" && v !== undefined && v !== false);

  return (
    <div>
      <PageHeader
        title="Tennis events"
        subtitle="Practice, match play, lessons and tournaments around Bangkok."
        action={<ButtonLink href="/events/new" variant="accent">Host an event</ButtonLink>}
      />

      <form className="mb-6 grid grid-cols-2 gap-2 rounded-2xl border border-line bg-white p-3 sm:grid-cols-3 lg:grid-cols-6">
        <input type="date" name="day" defaultValue={filters.day} min={todayInBangkok()} className={field} aria-label="Date" />
        <select name="area" defaultValue={filters.area ?? ""} className={field} aria-label="Area">
          <option value="">All areas</option>
          {AREAS.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <select name="level" defaultValue={filters.level ?? ""} className={field} aria-label="Level">
          <option value="">Any level</option>
          {LEVELS.map((l) => (
            <option key={l.level} value={l.level}>
              Lv.{l.level} {l.name}
              {profile?.level === l.level ? " (you)" : ""}
            </option>
          ))}
        </select>
        <select name="type" defaultValue={filters.type ?? ""} className={field} aria-label="Type">
          <option value="">All types</option>
          {EVENT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <input name="q" defaultValue={filters.q} placeholder="Search title or venue" className={field} aria-label="Search" />
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm whitespace-nowrap">
            <input type="checkbox" name="open" value="1" defaultChecked={filters.open} className="accent-[var(--color-court)]" />
            Open spots
          </label>
          <button className={cx(btn.base, btn.primary, "ml-auto py-2")}>Filter</button>
        </div>
      </form>

      {profile?.level && !filters.level ? (
        <p className="-mt-3 mb-5 text-sm text-muted">
          <Link className="text-court underline" href={`/events?level=${profile.level}`}>
            Show only events for my level (Lv.{profile.level})
          </Link>
        </p>
      ) : null}

      {events.length === 0 ? (
        <EmptyState title={active ? "No events match these filters" : "No upcoming events yet"}>
          {active ? (
            <Link href="/events" className="text-court underline">
              Clear filters
            </Link>
          ) : (
            "Be the first: host a session and share the link in your group."
          )}
        </EmptyState>
      ) : (
        <div className="space-y-8">
          {[...groups.entries()].map(([day, list]) => (
            <section key={day}>
              <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted uppercase">{day}</h2>
              <div className="space-y-2">
                {list.map((e) => (
                  <EventRow key={e.id} event={e} />
                ))}
              </div>
            </section>
          ))}
          {events.length === (filters.limit ?? 50) ? (
            <div className="text-center">
              <Link
                className={cx(btn.base, btn.secondary)}
                href={{ query: { ...Object.fromEntries(Object.entries(sp).filter(([, v]) => typeof v === "string")), limit: String((filters.limit ?? 50) + 50) } }}
              >
                Show more
              </Link>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
