import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { levelName } from "@/lib/constants";

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

export const btn = {
  base: "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
  primary: "bg-court text-white hover:bg-court-600",
  accent: "bg-court text-white hover:bg-court-600",
  secondary: "border border-court bg-white text-court hover:bg-court-50",
  ghost: "text-court hover:bg-court-50",
  danger: "border border-danger/30 bg-white text-danger hover:bg-danger/5",
};

export function ButtonLink({
  variant = "primary",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: keyof typeof btn }) {
  return <Link className={cx(btn.base, btn[variant], className)} {...props} />;
}

export const field =
  "w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-ink placeholder:text-muted focus:border-court focus:bg-white focus:outline-none";
export const label = "mb-1 block text-sm font-medium text-ink";
export const hint = "mt-1 text-xs text-muted";

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-xl border border-line bg-white p-5", className)}>{children}</div>;
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-muted">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: "neutral" | "court" | "ball" | "warn" | "danger";
  children: ReactNode;
  className?: string;
}) {
  const tones = {
    neutral: "bg-paper text-ink border-line",
    court: "bg-court-50 text-court border-court/20",
    ball: "bg-court-50 text-court-600 border-court/30 font-semibold",
    warn: "bg-warn/10 text-warn border-warn/20",
    danger: "bg-danger/10 text-danger border-danger/20",
  };
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function LevelBadge({ min, max }: { min: number; max: number }) {
  return (
    <Badge tone="court" className="font-mono">
      {min === max ? `Lv.${min}` : `Lv.${min}–${max}`}
    </Badge>
  );
}

export function PlayerLevel({ level }: { level: number | null }) {
  if (!level) return <span className="text-xs text-muted">Unrated</span>;
  return (
    <span className="text-xs text-muted">
      <span className="font-mono">Lv.{level}</span> {levelName(level)}
    </span>
  );
}

export function Avatar({ name, url, size = 36 }: { name: string; url?: string | null; size?: number }) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "?";
  if (url && url.startsWith("https://")) {
    return (
      // Plain <img>: avatars come from Google or Supabase Storage, and a bad
      // URL should show a broken image, not crash the page.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="shrink-0 rounded-full border border-line object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-court-50 font-semibold text-court"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials}
    </span>
  );
}

export function FoundingBadge() {
  return (
    <Badge tone="ball" className="font-semibold">
      Founding organizer
    </Badge>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-white/60 px-6 py-12 text-center">
      <p className="font-semibold">{title}</p>
      {children ? <div className="mt-2 text-sm text-muted">{children}</div> : null}
    </div>
  );
}

export function Notice({ tone = "court", children }: { tone?: "court" | "warn" | "danger"; children: ReactNode }) {
  const tones = {
    court: "border-court/20 bg-court-50 text-court",
    warn: "border-warn/20 bg-warn/10 text-warn",
    danger: "border-danger/20 bg-danger/10 text-danger",
  };
  return <div className={cx("rounded-xl border px-4 py-3 text-sm", tones[tone])}>{children}</div>;
}
