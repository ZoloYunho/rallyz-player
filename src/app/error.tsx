"use client";

import { btn, cx, EmptyState } from "@/components/ui";

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="mx-auto max-w-lg space-y-4 text-center">
      <EmptyState title="Something went wrong">{error.digest ? `Reference ${error.digest}` : "Please try again."}</EmptyState>
      <button onClick={() => retry()} className={cx(btn.base, btn.primary)}>Try again</button>
    </div>
  );
}
