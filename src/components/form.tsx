"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";
import { btn, cx, Notice } from "@/components/ui";
import type { ActionState } from "@/lib/types";

export function SubmitButton({
  children,
  pending,
  variant = "primary",
  className,
  name,
  value,
}: {
  children: ReactNode;
  pending?: ReactNode;
  variant?: keyof typeof btn;
  className?: string;
  name?: string;
  value?: string;
}) {
  const status = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={status.pending}
      className={cx(btn.base, btn[variant], className)}
    >
      {status.pending ? (pending ?? "Saving…") : children}
    </button>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (!state) return null;
  if (state.error) return <Notice tone="danger">{state.error}</Notice>;
  if (state.ok) return <Notice>{state.ok}</Notice>;
  return null;
}
