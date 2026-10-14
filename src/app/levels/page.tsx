import type { Metadata } from "next";
import { LEVELS } from "@/lib/constants";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = {
  title: "Tennis levels",
  description: "The Rallyz 1–9 tennis level scale, with NTRP equivalents.",
};

export default function LevelsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Tennis levels"
        subtitle="One scale for everything on Rallyz: events, instructors and players. If two levels fit, pick the higher one."
      />
      <ol className="space-y-3">
        {LEVELS.map((l) => (
          <li key={l.level} className="flex gap-4 rounded-xl border border-line bg-white p-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-court font-mono text-lg font-bold text-ball">
              {l.level}
            </span>
            <div>
              <p className="font-semibold">
                {l.name} <span className="text-sm font-normal text-muted">· NTRP {l.ntrp}</span>
              </p>
              <p className="mt-1 text-sm text-muted">{l.description}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
