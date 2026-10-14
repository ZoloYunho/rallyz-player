"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/form";
import { field, label } from "@/components/ui";
import { REPORT_REASONS } from "@/lib/constants";
import { blockPlayer, reportPlayer } from "@/app/[sport]/partner/actions";

/** "Report or block" disclosure, used on posts and in direct chats. */
export function SafetyMenu({ userId, name, postId, back }: { userId: string; name: string; postId?: string; back: string }) {
  const [state, action] = useActionState(reportPlayer, undefined);
  return (
    <details className="rounded-xl border border-line bg-white px-4 py-2 text-sm">
      <summary className="cursor-pointer text-muted">Report or block {name}</summary>
      <div className="space-y-4 py-3">
        <form action={action} className="space-y-2">
          <input type="hidden" name="user_id" value={userId} />
          {postId ? <input type="hidden" name="post_id" value={postId} /> : null}
          <label htmlFor={`reason-${userId}`} className={label}>Report to Rallyz</label>
          <select id={`reason-${userId}`} name="reason" required defaultValue="" className={field}>
            <option value="" disabled>Choose a reason</option>
            {REPORT_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <textarea name="details" rows={2} maxLength={1000} className={field} placeholder="What happened? (optional)" aria-label="Details" />
          <FormMessage state={state} />
          <SubmitButton variant="secondary" pending="Sending…">Send report</SubmitButton>
        </form>
        <form action={blockPlayer} className="space-y-2 border-t border-line pt-3">
          <input type="hidden" name="user_id" value={userId} />
          <input type="hidden" name="back" value={back} />
          <p className="text-muted">
            Blocking hides your posts from each other, stops direct messages, hides each other&apos;s messages in group chats, and
            removes {name} from your matches. They aren&apos;t told.
          </p>
          <SubmitButton variant="danger" pending="Blocking…">Block {name}</SubmitButton>
        </form>
      </div>
    </details>
  );
}
