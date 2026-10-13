"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/form";
import { field, label } from "@/components/ui";
import { signInWithEmail } from "../actions";

export function EmailForm({ next }: { next: string }) {
  const [state, action] = useActionState(signInWithEmail, undefined);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="next" value={next} />
      <div>
        <label htmlFor="email" className={label}>
          Email
        </label>
        <input id="email" name="email" type="email" required autoComplete="email" className={field} placeholder="you@example.com" />
      </div>
      <FormMessage state={state} />
      <SubmitButton className="w-full py-2.5" pending="Sending link…">
        Email me a sign-in link
      </SubmitButton>
    </form>
  );
}
