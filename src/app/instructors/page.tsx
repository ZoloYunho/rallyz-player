import type { Metadata } from "next";
import Link from "next/link";
import { AREAS, LANGUAGES, LEVELS, baht, levelRange } from "@/lib/constants";
import { listCoaches, readCoachFilters } from "@/lib/coaches";
import { Avatar, Badge, ButtonLink, EmptyState, PageHeader, btn, cx, field } from "@/components/ui";

export const metadata: Metadata = {
  title: "Tennis instructors in Bangkok",
  description: "Freelance tennis coaches with clear prices, areas, levels and languages.",
};

const PRICE_CAPS = [800, 1000, 1500, 2000, 3000];

export default async function InstructorsPage(props: PageProps<"/instructors">) {
  const sp = await props.searchParams;
  const filters = readCoachFilters(sp);
  const coaches = await listCoaches(filters);
  const active = Object.values(filters).some((v) => v !== undefined);

  return (
    <div>
      <PageHeader
        title="Instructors"
        subtitle="Freelance coaches around Bangkok. Prices, areas and levels up front."
        action={<ButtonLink href="/instructors/apply" variant="secondary">I&apos;m a coach</ButtonLink>}
      />

      <form className="mb-6 grid grid-cols-2 gap-2 rounded-xl border border-line bg-white p-3 sm:grid-cols-5">
        <select name="area" defaultValue={filters.area ?? ""} className={field} aria-label="Area">
          <option value="">All areas</option>
          {AREAS.map((a) => <option key={a}>{a}</option>)}
        </select>
        <select name="level" defaultValue={filters.level ?? ""} className={field} aria-label="Your level">
          <option value="">Any level</option>
          {LEVELS.map((l) => <option key={l.level} value={l.level}>Teaches Lv.{l.level}</option>)}
        </select>
        <select name="max" defaultValue={filters.maxPrice ?? ""} className={field} aria-label="Max price">
          <option value="">Any price</option>
          {PRICE_CAPS.map((p) => <option key={p} value={p}>Up to {baht(p)}/h</option>)}
        </select>
        <select name="lang" defaultValue={filters.language ?? ""} className={field} aria-label="Language">
          <option value="">Any language</option>
          {LANGUAGES.map((l) => <option key={l}>{l}</option>)}
        </select>
        <button className={cx(btn.base, btn.primary, "col-span-2 sm:col-span-1")}>Filter</button>
      </form>

      {coaches.length === 0 ? (
        <EmptyState title={active ? "No instructors match these filters" : "No instructors listed yet"}>
          {active ? <Link href="/instructors" className="text-court underline">Clear filters</Link> : "Coaches: list yourself for free."}
        </EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {coaches.map((c) => (
            <Link key={c.user_id} href={`/instructors/${c.user_id}`} className="flex flex-col rounded-xl border border-line bg-white p-4 transition hover:border-court">
              <div className="flex items-center gap-3">
                <Avatar name={c.profile?.display_name ?? "Coach"} url={c.profile?.avatar_url} size={48} />
                <div className="min-w-0">
                  <p className="truncate font-semibold">{c.profile?.display_name || "Coach"}</p>
                  <p className="line-clamp-2 text-sm text-muted">{c.headline}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge tone="court" className="font-mono">Teaches {levelRange(c.level_min, c.level_max)}</Badge>
                {c.languages.slice(0, 3).map((l) => <Badge key={l}>{l}</Badge>)}
                {c.trial_offer ? <Badge tone="ball">Trial lesson</Badge> : null}
              </div>
              <p className="mt-2 text-sm text-muted">{c.areas.join(" · ")}</p>
              <div className="mt-auto flex items-end justify-between pt-3">
                <p>
                  <span className="text-lg font-bold">{baht(c.rate_private_thb)}</span>
                  <span className="text-sm text-muted">/h private</span>
                </p>
                {c.rate_group_thb ? <p className="text-sm text-muted">{baht(c.rate_group_thb)}/h group</p> : null}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
