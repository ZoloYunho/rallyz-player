"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/form";
import { AreaChips } from "@/components/level-picker";
import { field, hint, label } from "@/components/ui";
import { LEVELS } from "@/lib/constants";
import type { Profile } from "@/lib/types";
import { savePromptPay, updateProfile } from "./actions";

export function ProfileForm({ profile, areas }: { profile: Profile; areas: readonly string[] }) {
  const [state, action] = useActionState(updateProfile, undefined);
  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="display_name" className={label}>Name</label>
        <input id="display_name" name="display_name" defaultValue={profile.display_name} required minLength={2} maxLength={60} className={field} />
      </div>
      <div>
        <label htmlFor="level" className={label}>Level</label>
        <select id="level" name="level" defaultValue={profile.level ?? ""} required className={field}>
          <option value="" disabled>Choose your level</option>
          {LEVELS.map((l) => <option key={l.level} value={l.level}>Lv.{l.level} {l.name} (NTRP {l.ntrp})</option>)}
        </select>
      </div>
      <div>
        <p className={label}>Areas</p>
        <AreaChips areas={areas} defaultValue={profile.areas} />
      </div>
      <div>
        <label htmlFor="bio" className={label}>About you <span className="font-normal text-muted">(optional)</span></label>
        <textarea id="bio" name="bio" rows={3} maxLength={500} defaultValue={profile.bio} className={field} />
      </div>
      <FormMessage state={state} />
      <SubmitButton variant="secondary">Save profile</SubmitButton>
    </form>
  );
}

export function PaymentForm({ promptpayId }: { promptpayId: string }) {
  const [state, action] = useActionState(savePromptPay, undefined);
  return (
    <form action={action} className="space-y-3">
      <div>
        <label htmlFor="promptpay_id" className={label}>PromptPay number</label>
        <input id="promptpay_id" name="promptpay_id" inputMode="numeric" defaultValue={promptpayId} className={field} placeholder="0812345678" />
        <p className={hint}>Mobile number or 13-digit ID linked to PromptPay. Leave empty to remove.</p>
      </div>
      <FormMessage state={state} />
      <SubmitButton variant="secondary">Save PromptPay</SubmitButton>
    </form>
  );
}
