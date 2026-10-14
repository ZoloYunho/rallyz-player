import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { formatLabel, levelName, levelRange, playTimeLabel } from "@/lib/constants";
import { getPost, myAsks, spotsLeft } from "@/lib/partner";
import { createClient } from "@/lib/supabase/server";
import { formatFullDate, formatRelative, formatTimeRange } from "@/lib/time";
import type { PlayAsk, PublicProfile } from "@/lib/types";
import { SubmitButton } from "@/components/form";
import { SafetyMenu } from "@/components/safety-menu";
import { Avatar, Badge, ButtonLink, Card, LevelBadge, Notice, PlayerLevel, field } from "@/components/ui";
import { answerAsk, askToPlay, cancelPost, withdrawAsk } from "../actions";

export const metadata: Metadata = { title: "Game post" };

const MESSAGES: Record<string, (v: string) => { tone: "court" | "warn" | "danger"; text: string }> = {
  posted: () => ({ tone: "court", text: "Posted. Players at your level can now ask to play; you'll get a notification." }),
  asked: () => ({ tone: "court", text: "Ask sent. The player will reply in your chat." }),
  answered: (v) => ({ tone: "court", text: v === "accepted" ? "Accepted. You're both in the match chat." : "Declined. They've been told politely." }),
  withdrawn: () => ({ tone: "warn", text: "You've withdrawn." }),
  cancelled: () => ({ tone: "warn", text: "Post cancelled. Anyone who asked has been told." }),
  blocked: () => ({ tone: "court", text: "Blocked. You won't see each other's posts, and neither of you can message the other." }),
  error: (v) => ({ tone: "danger", text: v }),
};

type AskRow = PlayAsk & { player: PublicProfile | null };

export default async function PostPage(props: PageProps<"/partner/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const me = await requireProfile(`/partner/${id}`);
  const post = await getPost(id);
  if (!post) notFound(); // missing, or hidden by a block

  const supabase = await createClient();
  const isAuthor = post.author_id === me.id;
  const myAsk = isAuthor ? undefined : (await myAsks([id])).get(id);
  const canSeeMatch = isAuthor || myAsk?.status === "accepted";

  const [{ data: askRows }, { data: rosterRows }, { data: match }] = await Promise.all([
    isAuthor
      ? supabase.from("play_request_responses").select("*").eq("request_id", id).order("created_at")
      : Promise.resolve({ data: [] }),
    canSeeMatch ? supabase.rpc("get_play_roster", { p_request: id }) : Promise.resolve({ data: [] }),
    canSeeMatch ? supabase.from("conversations").select("id").eq("play_request_id", id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  // Names for the asks (author view).
  const asks = (askRows ?? []) as PlayAsk[];
  const { data: people } = asks.length
    ? await supabase.from("player_profiles").select("id, display_name, avatar_url, level, is_founding_organizer").in("id", asks.map((a) => a.user_id))
    : { data: [] };
  const byId = new Map(((people ?? []) as PublicProfile[]).map((p) => [p.id, p]));
  const askList: AskRow[] = asks.map((a) => ({ ...a, player: byId.get(a.user_id) ?? null }));
  const pending = askList.filter((a) => a.status === "pending");
  const roster = (rosterRows ?? []) as { user_id: string; display_name: string; avatar_url: string | null; level: number | null; is_author: boolean }[];

  const author = post.author;
  const authorName = author?.display_name || "Player";
  const left = spotsLeft(post);
  const started = new Date(post.starts_at) <= new Date();
  const open = post.status === "open" && !started;
  const levelOk = !me.level || (me.level >= post.level_min && me.level <= post.level_max);
  const banners = Object.entries(MESSAGES).filter(([k]) => typeof sp[k] === "string").map(([k, fn]) => fn(sp[k] as string));

  const { data: authorMore } = await supabase.from("player_profiles").select("play_times, formats").eq("id", post.author_id).maybeSingle();

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href="/partner" className="text-sm text-muted hover:text-court">← Find a partner</Link>
      {banners.map((b, i) => <Notice key={i} tone={b.tone}>{b.text}</Notice>)}
      {post.status === "cancelled" ? <Notice tone="danger">This post was cancelled.</Notice> : null}

      <Card className="space-y-4">
        <div className="flex items-center gap-3">
          <Avatar name={authorName} url={author?.avatar_url} size={56} />
          <div>
            <p className="text-lg font-semibold">{isAuthor ? "Your post" : authorName}</p>
            <PlayerLevel level={author?.level ?? null} />
            {authorMore?.play_times?.length ? (
              <p className="text-xs text-muted">Usually plays: {authorMore.play_times.map(playTimeLabel).join(", ")}</p>
            ) : null}
          </div>
          <span className="ml-auto text-xs text-muted">Posted {formatRelative(post.created_at)}</span>
        </div>

        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted">When</dt>
            <dd className="font-semibold">{formatFullDate(post.starts_at)}</dd>
            <dd className="font-mono">{formatTimeRange(post.starts_at, post.ends_at)}</dd>
          </div>
          <div>
            <dt className="text-muted">Where</dt>
            <dd className="font-semibold">{post.venue?.name ?? post.venue_name ?? "Court not decided"}</dd>
            <dd>{post.area}</dd>
            <dd className="mt-1">{post.court_booked ? <Badge tone="court">Court booked</Badge> : <Badge>Court not booked yet</Badge>}</dd>
          </div>
          <div>
            <dt className="text-muted">Looking for</dt>
            <dd className="font-semibold">
              {formatLabel(post.format)} · {post.status === "filled" ? "full" : `${left} more player${left === 1 ? "" : "s"}`}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Level</dt>
            <dd className="flex items-center gap-2"><LevelBadge min={post.level_min} max={post.level_max} /></dd>
            <dd className="text-xs text-muted">
              {levelName(post.level_min)}{post.level_max !== post.level_min ? ` to ${levelName(post.level_max)}` : ""}
            </dd>
          </div>
        </dl>
        {post.note ? <p className="rounded-xl bg-paper px-4 py-3 text-sm whitespace-pre-line">{post.note}</p> : null}
      </Card>

      {/* Author: asks to answer, players in, match chat, cancel */}
      {isAuthor ? (
        <>
          <Card>
            <h2 className="mb-3 font-semibold">Asks {pending.length ? <span className="font-normal text-muted">· {pending.length} to answer</span> : null}</h2>
            {askList.length === 0 ? (
              <p className="text-sm text-muted">No asks yet. Share the post in your group to get more eyes on it.</p>
            ) : (
              <ul className="divide-y divide-line">
                {askList.map((a) => (
                  <li key={a.user_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar name={a.player?.display_name ?? "?"} url={a.player?.avatar_url} size={36} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{a.player?.display_name || "Player"}</p>
                        <PlayerLevel level={a.player?.level ?? null} />
                        {a.message ? <p className="text-sm text-ink/80">&ldquo;{a.message}&rdquo;</p> : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {a.conversation_id ? <ButtonLink href={`/chat/${a.conversation_id}`} variant="ghost" className="py-1">Chat</ButtonLink> : null}
                      {a.status === "pending" && open ? (
                        <>
                          <form action={answerAsk}>
                            <input type="hidden" name="post_id" value={id} />
                            <input type="hidden" name="user_id" value={a.user_id} />
                            <SubmitButton name="decision" value="accept" className="py-1" pending="…">Accept</SubmitButton>
                          </form>
                          <form action={answerAsk}>
                            <input type="hidden" name="post_id" value={id} />
                            <input type="hidden" name="user_id" value={a.user_id} />
                            <SubmitButton name="decision" value="decline" variant="secondary" className="py-1" pending="…">Decline</SubmitButton>
                          </form>
                        </>
                      ) : (
                        <Badge tone={a.status === "accepted" ? "court" : "neutral"}>{a.status}</Badge>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : null}

      {canSeeMatch && roster.length > 1 ? (
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Playing</h2>
            {match ? <ButtonLink href={`/chat/${match.id}`} className="py-1.5">Match chat</ButtonLink> : null}
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {roster.map((p) => (
              <li key={p.user_id} className="flex items-center gap-3">
                <Avatar name={p.display_name} url={p.avatar_url} size={32} />
                <div>
                  <p className="text-sm font-medium">{p.display_name || "Player"}{p.user_id === me.id ? " (you)" : ""}</p>
                  <PlayerLevel level={p.level} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* Other players: ask, status, withdraw */}
      {!isAuthor ? (
        <Card>
          {myAsk?.status === "accepted" ? (
            <div className="space-y-3">
              <Notice>You&apos;re in. Sort out the details in the match chat.</Notice>
              {!started ? (
                <form action={withdrawAsk}>
                  <input type="hidden" name="post_id" value={id} />
                  <SubmitButton variant="danger" pending="…">I can&apos;t make it</SubmitButton>
                </form>
              ) : null}
            </div>
          ) : myAsk?.status === "pending" ? (
            <div className="space-y-3">
              <Notice tone="warn">Asked. Waiting for {authorName} to reply.</Notice>
              <div className="flex flex-wrap gap-2">
                {myAsk.conversation_id ? <ButtonLink href={`/chat/${myAsk.conversation_id}`} variant="secondary">Open chat</ButtonLink> : null}
                <form action={withdrawAsk}>
                  <input type="hidden" name="post_id" value={id} />
                  <SubmitButton variant="ghost" pending="…">Withdraw</SubmitButton>
                </form>
              </div>
            </div>
          ) : myAsk?.status === "declined" && !(myAsk.closed_by_fill && open) ? (
            <p className="text-sm text-muted">{authorName} found other players for this one. There are more posts on the partner page.</p>
          ) : myAsk?.status === "withdrawn" && myAsk.times_withdrawn >= 2 ? (
            <p className="text-sm text-muted">You&apos;ve withdrawn from this post twice. Message {authorName} if plans change again.</p>
          ) : open ? (
            !me.safety_ack_at ? (
              <div className="space-y-3">
                <p className="text-sm">Before your first game with someone new, read the safety tips.</p>
                <ButtonLink href={`/partner/safety?next=/partner/${id}`}>Read safety tips</ButtonLink>
              </div>
            ) : (
              <form action={askToPlay} className="space-y-3">
                <input type="hidden" name="post_id" value={id} />
                <label htmlFor="message" className="block font-semibold">Ask to play</label>
                {!levelOk ? (
                  <p className="text-xs text-warn">This post is for {levelRange(post.level_min, post.level_max)}; you&apos;re Lv.{me.level}. Mention it in your message.</p>
                ) : null}
                <textarea id="message" name="message" rows={2} maxLength={500} className={field}
                  placeholder={`Hi ${authorName}, I'm free then. Happy to split the court.`} />
                <SubmitButton variant="accent" className="py-2.5" pending="Sending…">Ask to play</SubmitButton>
              </form>
            )
          ) : (
            <p className="text-sm text-muted">This post is {post.status === "filled" ? "full" : "no longer open"}.</p>
          )}
        </Card>
      ) : null}

      {isAuthor && post.status !== "cancelled" && !started ? (
        <form action={cancelPost} className="flex justify-end">
          <input type="hidden" name="post_id" value={id} />
          <SubmitButton variant="danger" pending="Cancelling…">Cancel post</SubmitButton>
        </form>
      ) : null}

      {!isAuthor ? <SafetyMenu userId={post.author_id} name={authorName} postId={id} back="/partner" /> : null}
    </div>
  );
}
