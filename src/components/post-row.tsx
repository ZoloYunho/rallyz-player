import Link from "next/link";
import { formatLabel } from "@/lib/constants";
import { spotsLeft } from "@/lib/partner";
import { formatDay, formatTimeRange } from "@/lib/time";
import type { PlayAsk, PlayRequest } from "@/lib/types";
import { Avatar, Badge, LevelBadge } from "@/components/ui";

const ASK_LABEL: Record<string, { text: string; tone: "ball" | "court" | "neutral" }> = {
  pending: { text: "Asked", tone: "ball" },
  accepted: { text: "You're in", tone: "court" },
  declined: { text: "Not this time", tone: "neutral" },
  withdrawn: { text: "Withdrawn", tone: "neutral" },
};

/** One "looking to play" post in the feed. */
export function PostRow({ post, ask, mine }: { post: PlayRequest; ask?: PlayAsk; mine?: boolean }) {
  const left = spotsLeft(post);
  const name = post.author?.display_name || "Player";
  return (
    <Link
      href={`/${post.sport}/partner/${post.id}`}
      className="grid grid-cols-[3rem_1fr] gap-3 rounded-xl border border-line bg-white p-4 transition hover:border-court sm:grid-cols-[3rem_1fr_auto]"
    >
      <Avatar name={name} url={post.author?.avatar_url} size={48} />
      <div className="min-w-0">
        <p className="truncate font-semibold">
          {mine ? "Your post" : name}
          {post.author?.level && !mine ? <span className="font-normal text-muted"> · Lv.{post.author.level}</span> : null}
        </p>
        <p className="text-sm">
          {formatDay(post.starts_at)} · <span className="font-mono">{formatTimeRange(post.starts_at, post.ends_at)}</span>
        </p>
        <p className="truncate text-sm text-muted">
          {post.area}
          {post.venue_name ? ` · ${post.venue_name}` : ""}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <LevelBadge min={post.level_min} max={post.level_max} />
          <Badge>{formatLabel(post.format)}</Badge>
          {post.court_booked ? <Badge tone="court">Court booked</Badge> : <Badge>No court yet</Badge>}
        </div>
      </div>
      <div className="col-span-2 flex items-center justify-between gap-2 sm:col-span-1 sm:flex-col sm:items-end sm:justify-center">
        <p className="text-sm font-semibold">
          {post.status === "filled" ? "Full" : `Needs ${left} player${left === 1 ? "" : "s"}`}
        </p>
        {ask ? <Badge tone={ASK_LABEL[ask.status].tone}>{ASK_LABEL[ask.status].text}</Badge> : null}
        {mine && post.pending_count ? <Badge tone="ball">{post.pending_count} to answer</Badge> : null}
      </div>
    </Link>
  );
}
