"use client";

import { useParams } from "next/navigation";
import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/form";
import { AreaChips } from "@/components/level-picker";
import { Card, field, hint, label } from "@/components/ui";
import { LEVELS } from "@/lib/constants";
import type { CoachProfile } from "@/lib/types";
import { saveCoachProfile } from "../actions";

export function CoachForm({
  coach,
  areas,
  languages,
}: {
  coach: CoachProfile | null;
  areas: readonly string[];
  languages: readonly string[];
}) {
  const [state, action] = useActionState(saveCoachProfile, undefined);
  const c = coach;

  const { sport } = useParams<{ sport: string }>();
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="sport" value={sport} />
      <Card className="space-y-4">
        <div>
          <label htmlFor="headline" className={label}>Headline</label>
          <input id="headline" name="headline" required minLength={5} maxLength={100} defaultValue={c?.headline} className={field}
            placeholder="Patient coach for beginners and improvers" />
        </div>
        <div>
          <label htmlFor="bio" className={label}>About you</label>
          <textarea id="bio" name="bio" rows={5} maxLength={3000} defaultValue={c?.bio} className={field}
            placeholder="Your background, how you teach, who you work best with." />
        </div>
      </Card>

      <Card className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="rate_private_thb" className={label}>Private lesson (฿ per hour)</label>
          <input id="rate_private_thb" name="rate_private_thb" type="number" min={0} max={100000} required defaultValue={c?.rate_private_thb} className={field} />
        </div>
        <div>
          <label htmlFor="rate_group_thb" className={label}>Group lesson (฿ per hour) <span className="font-normal text-muted">(optional)</span></label>
          <input id="rate_group_thb" name="rate_group_thb" type="number" min={0} max={100000} defaultValue={c?.rate_group_thb ?? undefined} className={field} />
        </div>
        <div>
          <label htmlFor="level_min" className={label}>Teaches from</label>
          <select id="level_min" name="level_min" defaultValue={c?.level_min ?? 1} className={field}>
            {LEVELS.map((l) => <option key={l.level} value={l.level}>Lv.{l.level} {l.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="level_max" className={label}>Teaches up to</label>
          <select id="level_max" name="level_max" defaultValue={c?.level_max ?? 6} className={field}>
            {LEVELS.map((l) => <option key={l.level} value={l.level}>Lv.{l.level} {l.name}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="trial_offer" className={label}>Trial offer <span className="font-normal text-muted">(optional)</span></label>
          <input id="trial_offer" name="trial_offer" maxLength={200} defaultValue={c?.trial_offer} className={field} placeholder="First 30-minute lesson ฿500" />
        </div>
      </Card>

      <Card className="space-y-4">
        <div>
          <p className={label}>Areas you teach in</p>
          <AreaChips areas={areas} defaultValue={c?.areas ?? []} />
        </div>
        <div>
          <label htmlFor="venues" className={label}>Courts you usually use <span className="font-normal text-muted">(optional)</span></label>
          <input id="venues" name="venues" maxLength={300} defaultValue={c?.venues} className={field} placeholder="Lumphini Park, Sathorn Tennis Club" />
        </div>
        <div>
          <p className={label}>Languages</p>
          <AreaChips name="languages" areas={languages} defaultValue={c?.languages ?? ["English"]} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="years_coaching" className={label}>Years coaching <span className="font-normal text-muted">(optional)</span></label>
            <input id="years_coaching" name="years_coaching" type="number" min={0} max={70} defaultValue={c?.years_coaching ?? undefined} className={field} />
          </div>
          <div>
            <label htmlFor="certifications" className={label}>Certifications <span className="font-normal text-muted">(optional)</span></label>
            <input id="certifications" name="certifications" maxLength={300} defaultValue={c?.certifications} className={field} placeholder="ITF Level 1, PTR" />
          </div>
        </div>
        <p className={hint}>Your name and photo come from your Rallyz profile.</p>
      </Card>

      <FormMessage state={state} />
      <SubmitButton className="w-full py-3 text-base" pending="Saving…">
        {c ? "Save profile" : "Submit for review"}
      </SubmitButton>
    </form>
  );
}
