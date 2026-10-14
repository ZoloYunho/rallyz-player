import type { Metadata } from "next";
import Link from "next/link";
import { getProfile } from "@/lib/auth";
import { AREAS, FORMATS, LEVELS } from "@/lib/constants";
import { listOpenPosts, myAsks, readPartnerFilters } from "@/lib/partner";
import { todayInBangkok } from "@/lib/time";
import { PostRow } from "@/components/post-row";
import { ButtonLink, Card, EmptyState, PageHeader, btn, cx, field } from "@/components/ui";

export const metadata: Metadata = {
  title: "Find a tennis partner",
  description: "Post when and where you want to play, and find players at your level in Bangkok.",
};

export default async function PartnerPage(props: PageProps<"/partner">) {
  const profile = await getProfile();

  if (!profile) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card className="space-y-4 p-8 text-center">
          <p className="text-sm font-semibold tracking-wide text-court uppercase">Find a partner</p>
          <h1 className="text-2xl font-bold">Find a hitting partner at your level</h1>
          <p className="text-muted">
            Post when and where you want to play, or answer someone else&apos;s post. Posts are only visible to signed-in players.
          </p>
          <div className="flex justify-center">
            <ButtonLink href="/auth/login?next=/partner">Log in to see who&apos;s playing</ButtonLink>
          </div>
        </Card>
      </div>
    );
  }

  const sp = await props.searchParams;
  const filters = readPartnerFilters(sp, profile.level);
  const posts = await listOpenPosts(filters);
  const asks = await myAsks(posts.map((p) => p.id));
  const mine = posts.filter((p) => p.author_id === profile.id);
  const others = posts.filter((p) => p.author_id !== profile.id);

  return (
    <div>
      <PageHeader
        title="Find a partner"
        subtitle="Players looking for a game. Ask to play, chat, and meet on court."
        action={<ButtonLink href="/partner/new" variant="accent">Post a game</ButtonLink>}
      />

      <form className="mb-4 grid grid-cols-2 gap-2 rounded-xl border border-line bg-white p-3 sm:grid-cols-5">
        <input type="date" name="day" defaultValue={filters.day} min={todayInBangkok()} className={field} aria-label="Date" />
        <select name="area" defaultValue={filters.area ?? ""} className={field} aria-label="Area">
          <option value="">All areas</option>
          {AREAS.map((a) => <option key={a}>{a}</option>)}
        </select>
        <select name="format" defaultValue={filters.format ?? ""} className={field} aria-label="Format">
          <option value="">Any format</option>
          {FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
        <select name="level" defaultValue={filters.level ? String(filters.level) : "any"} className={field} aria-label="Level">
          <option value="any">Any level</option>
          {LEVELS.map((l) => (
            <option key={l.level} value={l.level}>
              For Lv.{l.level}{profile.level === l.level ? " (you)" : ""}
            </option>
          ))}
        </select>
        <button className={cx(btn.base, btn.primary, "col-span-2 sm:col-span-1")}>Filter</button>
      </form>
      {filters.levelIsMine ? (
        <p className="mb-5 text-sm text-muted">
          Showing posts that include your level (Lv.{filters.level}).{" "}
          <Link className="text-court underline" href="/partner?level=any">Show all levels</Link>
        </p>
      ) : (
        <div className="mb-5" />
      )}

      {!profile.safety_ack_at ? (
        <Card className="mb-6 flex flex-wrap items-center justify-between gap-3 border-court/30 bg-court-50">
          <p className="text-sm text-court">Before you meet anyone, take a minute to read the safety tips.</p>
          <ButtonLink href="/partner/safety" variant="secondary" className="py-1.5">Read safety tips</ButtonLink>
        </Card>
      ) : null}

      {mine.length ? (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted uppercase">Your open posts</h2>
          <div className="space-y-2">{mine.map((p) => <PostRow key={p.id} post={p} mine />)}</div>
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted uppercase">Looking to play</h2>
        {others.length === 0 ? (
          <EmptyState title="No posts match right now">
            Post your own game and players at your level will see it.{" "}
            {filters.level ? <Link href="/partner?level=any" className="text-court underline">Try all levels</Link> : null}
          </EmptyState>
        ) : (
          <div className="space-y-2">{others.map((p) => <PostRow key={p.id} post={p} ask={asks.get(p.id)} />)}</div>
        )}
      </section>
    </div>
  );
}
