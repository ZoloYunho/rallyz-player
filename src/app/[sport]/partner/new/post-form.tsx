"use client";

import { useParams } from "next/navigation";
import { useActionState, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/form";
import { Card, field, hint, label } from "@/components/ui";
import { AREAS, FORMATS, LEVELS } from "@/lib/constants";
import type { VenueOption } from "@/lib/events";
import { createPost } from "../actions";

export function PostForm({
  venues,
  minDate,
  defaults,
}: {
  venues: VenueOption[];
  minDate: string;
  defaults: { level_min: number; level_max: number; area?: string; format: string };
}) {
  const [state, action] = useActionState(createPost, undefined);
  const [format, setFormat] = useState(defaults.format);
  const byDistrict = new Map<string, VenueOption[]>();
  for (const v of venues) byDistrict.set(v.district || "Other", [...(byDistrict.get(v.district || "Other") ?? []), v]);

  const { sport } = useParams<{ sport: string }>();
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="sport" value={sport} />
      <Card className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="date" className={label}>Date</label>
          <input id="date" name="date" type="date" required min={minDate} className={field} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="start_time" className={label}>From</label>
            <input id="start_time" name="start_time" type="time" required step={900} defaultValue="18:00" className={field} />
          </div>
          <div>
            <label htmlFor="end_time" className={label}>Until</label>
            <input id="end_time" name="end_time" type="time" required step={900} defaultValue="20:00" className={field} />
          </div>
        </div>
        <p className={`${hint} sm:col-span-2`}>A window is fine: &quot;Saturday 7 to 10am&quot;. Agree the exact time in chat.</p>
        <div>
          <label htmlFor="area" className={label}>Area</label>
          <select id="area" name="area" required defaultValue={defaults.area ?? ""} className={field}>
            <option value="" disabled>Choose an area</option>
            {AREAS.map((a) => <option key={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="venue_id" className={label}>Court <span className="font-normal text-muted">(optional)</span></label>
          <select id="venue_id" name="venue_id" defaultValue="" className={field}>
            <option value="">Not decided / not listed</option>
            {[...byDistrict.entries()].map(([district, list]) => (
              <optgroup key={district} label={district}>
                {list.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="venue_name" className={label}>Or type the place <span className="font-normal text-muted">(optional)</span></label>
          <input id="venue_name" name="venue_name" maxLength={120} className={field} placeholder="Condo courts, Sukhumvit 24" />
        </div>
        <fieldset className="sm:col-span-2">
          <legend className={label}>Have you booked a court?</legend>
          <div className="flex gap-2">
            {[
              { value: "yes", text: "Yes, court booked" },
              { value: "no", text: "Not yet, we'll book together" },
            ].map((o) => (
              <label key={o.value} className="cursor-pointer rounded-full border border-line bg-white px-3 py-1 text-sm has-[:checked]:border-court has-[:checked]:bg-court has-[:checked]:text-white">
                <input type="radio" name="court_booked" value={o.value} defaultChecked={o.value === "no"} className="sr-only" />
                {o.text}
              </label>
            ))}
          </div>
        </fieldset>
      </Card>

      <Card className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="format" className={label}>Format</label>
          <select id="format" name="format" value={format} onChange={(e) => setFormat(e.target.value)} className={field}>
            {FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="players_needed" className={label}>Players needed</label>
          {format === "singles" ? (
            <>
              <input type="hidden" name="players_needed" value="1" />
              <p className="py-2 text-sm text-muted">1 opponent</p>
            </>
          ) : (
            <select id="players_needed" name="players_needed" defaultValue="3" className={field}>
              <option value="1">1 more (we have 3)</option>
              <option value="2">2 more (we have 2)</option>
              <option value="3">3 more (just me)</option>
            </select>
          )}
        </div>
        <div>
          <label htmlFor="level_min" className={label}>Lowest level</label>
          <select id="level_min" name="level_min" defaultValue={defaults.level_min} className={field}>
            {LEVELS.map((l) => <option key={l.level} value={l.level}>Lv.{l.level} {l.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="level_max" className={label}>Highest level</label>
          <select id="level_max" name="level_max" defaultValue={defaults.level_max} className={field}>
            {LEVELS.map((l) => <option key={l.level} value={l.level}>Lv.{l.level} {l.name}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="note" className={label}>Note <span className="font-normal text-muted">(optional)</span></label>
          <textarea id="note" name="note" rows={3} maxLength={500} className={field}
            placeholder="Rally for 20 minutes then play a set. I'll bring new balls; we split the court." />
        </div>
      </Card>

      <FormMessage state={state} />
      <SubmitButton className="w-full py-3 text-base" pending="Posting…">Post</SubmitButton>
    </form>
  );
}
