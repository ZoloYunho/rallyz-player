"use client";

import { useParams } from "next/navigation";
import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/form";
import { Card, field, hint, label } from "@/components/ui";
import { AREAS, EVENT_TYPES, FORMATS, LEVELS } from "@/lib/constants";
import type { VenueOption } from "@/lib/events";
import { createEvent, updateEvent } from "./actions";

export type EventFormValues = {
  event_id?: string;
  title?: string;
  type?: string;
  format?: string;
  date?: string;
  start_time?: string;
  end_time?: string;
  venue_id?: string | null;
  venue_name?: string;
  area?: string;
  address?: string;
  courts?: number | null;
  level_min?: number;
  level_max?: number;
  fee_thb?: number;
  capacity?: number;
  entry_mode?: string;
  cancel_deadline_hours?: number;
  cancellation_policy?: string;
  description?: string;
  participant_note?: string;
};

const DEADLINES = [
  { value: 0, label: "Any time before start" },
  { value: 6, label: "6 hours before" },
  { value: 12, label: "12 hours before" },
  { value: 24, label: "24 hours before" },
  { value: 48, label: "2 days before" },
  { value: 72, label: "3 days before" },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <h2 className="mb-4 font-semibold">{title}</h2>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </Card>
  );
}

export function EventForm({
  mode,
  values = {},
  minDate,
  venues,
}: {
  mode: "create" | "edit";
  values?: EventFormValues;
  minDate: string;
  venues: VenueOption[];
}) {
  const [state, action] = useActionState(mode === "create" ? createEvent : updateEvent, undefined);
  const v = values;
  const byDistrict = new Map<string, VenueOption[]>();
  for (const venue of venues) byDistrict.set(venue.district || "Other", [...(byDistrict.get(venue.district || "Other") ?? []), venue]);

  const { sport } = useParams<{ sport: string }>();
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="sport" value={sport} />
      {v.event_id ? <input type="hidden" name="event_id" value={v.event_id} /> : null}

      <Section title="What">
        <div className="sm:col-span-2">
          <label htmlFor="title" className={label}>Title</label>
          <input id="title" name="title" required minLength={3} maxLength={120} defaultValue={v.title} className={field}
            placeholder="Tuesday night doubles, intermediate" />
        </div>
        <div>
          <label htmlFor="type" className={label}>Type</label>
          <select id="type" name="type" defaultValue={v.type ?? "practice"} className={field}>
            {EVENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="format" className={label}>Format</label>
          <select id="format" name="format" defaultValue={v.format ?? "doubles"} className={field}>
            {FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="description" className={label}>Description</label>
          <textarea id="description" name="description" rows={5} maxLength={5000} defaultValue={v.description} className={field}
            placeholder="What you'll do, balls provided?, how games are rotated, what to bring…" />
        </div>
      </Section>

      <Section title="When and where">
        <div>
          <label htmlFor="date" className={label}>Date</label>
          <input id="date" name="date" type="date" required min={mode === "create" ? minDate : undefined} defaultValue={v.date} className={field} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="start_time" className={label}>Start</label>
            <input id="start_time" name="start_time" type="time" required step={900} defaultValue={v.start_time ?? "18:00"} className={field} />
          </div>
          <div>
            <label htmlFor="end_time" className={label}>End</label>
            <input id="end_time" name="end_time" type="time" required step={900} defaultValue={v.end_time ?? "20:00"} className={field} />
          </div>
        </div>
        {mode === "create" ? (
          <div className="sm:col-span-2">
            <label htmlFor="repeat_weeks" className={label}>Repeat weekly</label>
            <select id="repeat_weeks" name="repeat_weeks" defaultValue="1" className={field}>
              <option value="1">Just this date</option>
              {[2, 3, 4, 6, 8, 12].map((n) => <option key={n} value={n}>Every week for {n} weeks</option>)}
            </select>
            <p className={hint}>Creates a separate event for each week, so players join each date on its own.</p>
          </div>
        ) : null}
        <div className="sm:col-span-2">
          <label htmlFor="venue_id" className={label}>Venue</label>
          <select id="venue_id" name="venue_id" defaultValue={v.venue_id ?? ""} className={field}>
            <option value="">Not listed: I&apos;ll type it below</option>
            {[...byDistrict.entries()].map(([district, list]) => (
              <optgroup key={district} label={district}>
                {list.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
              </optgroup>
            ))}
          </select>
          <p className={hint}>Listed venues show their photos and map on the event page.</p>
        </div>
        <div>
          <label htmlFor="venue_name" className={label}>Venue name if not listed</label>
          <input id="venue_name" name="venue_name" maxLength={120} defaultValue={v.venue_id ? "" : v.venue_name} className={field} placeholder="Condo courts, Sukhumvit 24" />
        </div>
        <div>
          <label htmlFor="area" className={label}>Area</label>
          <select id="area" name="area" required defaultValue={v.area ?? ""} className={field}>
            <option value="" disabled>Choose an area</option>
            {AREAS.map((a) => <option key={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="address" className={label}>Address or map link <span className="font-normal text-muted">(optional)</span></label>
          <input id="address" name="address" maxLength={300} defaultValue={v.address} className={field} />
        </div>
        <div>
          <label htmlFor="courts" className={label}>Courts booked <span className="font-normal text-muted">(optional)</span></label>
          <input id="courts" name="courts" type="number" min={1} max={50} defaultValue={v.courts ?? undefined} className={field} />
        </div>
      </Section>

      <Section title="Who and how much">
        <div className="grid grid-cols-2 gap-3 sm:col-span-2">
          <div>
            <label htmlFor="level_min" className={label}>Lowest level</label>
            <select id="level_min" name="level_min" defaultValue={v.level_min ?? 3} className={field}>
              {LEVELS.map((l) => <option key={l.level} value={l.level}>Lv.{l.level} {l.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="level_max" className={label}>Highest level</label>
            <select id="level_max" name="level_max" defaultValue={v.level_max ?? 6} className={field}>
              {LEVELS.map((l) => <option key={l.level} value={l.level}>Lv.{l.level} {l.name}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="capacity" className={label}>Players (spots)</label>
          <input id="capacity" name="capacity" type="number" min={1} max={200} required defaultValue={v.capacity ?? 8} className={field} />
          <p className={hint}>When it&apos;s full, new players join a waitlist and move up automatically.</p>
        </div>
        <div>
          <label htmlFor="fee_thb" className={label}>Fee per player (฿)</label>
          <input id="fee_thb" name="fee_thb" type="number" min={0} max={100000} step={1} defaultValue={v.fee_thb ?? 0} className={field} />
          <p className={hint}>0 for free. Add your PromptPay on My page to show players a QR code.</p>
        </div>
        <fieldset className="sm:col-span-2">
          <legend className={label}>How players join</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              { value: "instant", title: "Instant", text: "Players are confirmed straight away while spots are open." },
              { value: "approval", title: "I approve each player", text: "Players send a request; you accept or decline." },
            ].map((o) => (
              <label key={o.value} className="flex cursor-pointer gap-3 rounded-xl border border-line p-3 has-[:checked]:border-court has-[:checked]:bg-court-50">
                <input type="radio" name="entry_mode" value={o.value} defaultChecked={(v.entry_mode ?? "instant") === o.value} className="mt-1 accent-[var(--color-court)]" />
                <span>
                  <span className="block text-sm font-semibold">{o.title}</span>
                  <span className="block text-xs text-muted">{o.text}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </Section>

      <Section title="Cancellations and details">
        <div>
          <label htmlFor="cancel_deadline_hours" className={label}>Players can cancel free until</label>
          <select id="cancel_deadline_hours" name="cancel_deadline_hours" defaultValue={v.cancel_deadline_hours ?? 24} className={field}>
            {DEADLINES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="cancellation_policy" className={label}>Late cancellation policy <span className="font-normal text-muted">(optional)</span></label>
          <input id="cancellation_policy" name="cancellation_policy" maxLength={1000} defaultValue={v.cancellation_policy} className={field}
            placeholder="Late cancellations pay the full fee unless you find a replacement." />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="participant_note" className={label}>Note for confirmed players only <span className="font-normal text-muted">(optional)</span></label>
          <textarea id="participant_note" name="participant_note" rows={2} maxLength={2000} defaultValue={v.participant_note} className={field}
            placeholder="Meeting point, court number, gate code…" />
        </div>
      </Section>

      <FormMessage state={state} />
      <SubmitButton className="w-full py-3 text-base" pending={mode === "create" ? "Creating…" : "Saving…"}>
        {mode === "create" ? "Publish event" : "Save changes"}
      </SubmitButton>
    </form>
  );
}
