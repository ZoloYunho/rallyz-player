"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/form";
import { field, hint, label } from "@/components/ui";
import { requestLesson } from "../actions";

export function LessonRequestForm({ coachId, hasGroup, minDate }: { coachId: string; hasGroup: boolean; minDate: string }) {
  const [state, action] = useActionState(requestLesson, undefined);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="coach_id" value={coachId} />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor="kind" className={label}>Lesson</label>
          <select id="kind" name="kind" className={field} defaultValue="private">
            <option value="private">Private</option>
            {hasGroup ? <option value="group">Group</option> : null}
          </select>
        </div>
        <div>
          <label htmlFor="players" className={label}>Players</label>
          <input id="players" name="players" type="number" min={1} max={12} defaultValue={1} className={field} />
        </div>
      </div>
      <div>
        <label htmlFor="preferred_at" className={label}>Preferred time</label>
        <input id="preferred_at" name="preferred_at" type="datetime-local" required min={`${minDate}T06:00`} step={1800} className={field} />
        <p className={hint}>Bangkok time. The coach confirms or suggests another time in chat.</p>
      </div>
      <div>
        <label htmlFor="note" className={label}>Message <span className="font-normal text-muted">(optional)</span></label>
        <textarea id="note" name="note" rows={3} maxLength={1000} className={field} placeholder="What do you want to work on? Any court you prefer?" />
      </div>
      <FormMessage state={state} />
      <SubmitButton variant="accent" className="w-full py-2.5" pending="Sending…">Send request</SubmitButton>
    </form>
  );
}
