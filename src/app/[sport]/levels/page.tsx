import type { Metadata } from "next";
import { sportName } from "@/lib/sports";
import { LEVELS } from "@/lib/constants";
import { PageHeader } from "@/components/ui";

export async function generateMetadata(props: PageProps<"/[sport]/levels">): Promise<Metadata> {
  const name = sportName((await props.params).sport);
  return {
    title: `${name} levels`,
    description: `The Rallyz 1–9 ${name.toLowerCase()} level scale.`,
  };
}

export default async function LevelsPage(props: PageProps<"/[sport]/levels">) {
  const { sport } = await props.params;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={`${sportName(sport)} levels`}
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
