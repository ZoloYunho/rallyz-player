"use client";

import { useActionState } from "react";
import Link from "next/link";
import { FormMessage, SubmitButton } from "@/components/form";
import { AreaChips, LevelPicker } from "@/components/level-picker";
import { Card, field, hint, label } from "@/components/ui";
import { completeOnboarding } from "../me/actions";

export function OnboardingForm({ next, name, areas }: { next: string; name: string; areas: readonly string[] }) {
  const [state, action] = useActionState(completeOnboarding, undefined);
  return (
    <form action={action} className="mt-6 space-y-6">
      <input type="hidden" name="next" value={next} />
      <Card>
        <label htmlFor="display_name" className={label}>
          1. Your name
        </label>
        <input id="display_name" name="display_name" defaultValue={name} required minLength={2} maxLength={60} className={field} />
        <p className={hint}>Shown on events you join and host.</p>
      </Card>
      <Card>
        <p className={label}>2. Your level</p>
        <p className="mb-3 text-sm text-muted">
          Be honest; it helps everyone get good games. Not sure? Read the{" "}
          <Link href="/levels" target="_blank" className="text-court underline">
            level guide
          </Link>
          .
        </p>
        <LevelPicker />
      </Card>
      <Card>
        <p className={label}>3. Where do you usually play?</p>
        <p className="mb-3 text-sm text-muted">Pick any that apply.</p>
        <AreaChips areas={areas} />
      </Card>
      <FormMessage state={state} />
      <SubmitButton className="w-full py-3 text-base" pending="Saving…">
        Start playing
      </SubmitButton>
    </form>
  );
}
