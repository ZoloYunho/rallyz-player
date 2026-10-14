import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDay, formatTime } from "@/lib/time";
import type { LessonRequest, Message } from "@/lib/types";
import { SubmitButton } from "@/components/form";
import { Badge } from "@/components/ui";
import { SafetyMenu } from "@/components/safety-menu";
import { cancelLesson, respondLesson } from "@/app/[sport]/instructors/actions";
import { ChatRoom, type Member } from "./chat-room";

export const metadata: Metadata = { title: "Chat" };

export default async function ConversationPage(props: PageProps<"/chat/[id]">) {
  const { id } = await props.params;
  const me = await requireProfile(`/chat/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();
  const { data: conv } = await supabase
    .from("conversations")
    .select("id, kind, event_id, play_request_id, event:events(id, title, starts_at, sport)")
    .eq("id", id)
    .maybeSingle();
  if (!conv) notFound(); // not a member, or doesn't exist

  const [{ data: memberRows }, { data: messageRows }, { data: lessonRows }] = await Promise.all([
    supabase
      .from("conversation_members")
      .select("user_id, profile:player_profiles!conversation_members_user_id_fkey(display_name, avatar_url)")
      .eq("conversation_id", id),
    supabase.from("messages").select("*").eq("conversation_id", id).order("created_at", { ascending: false }).limit(100),
    conv.kind === "direct"
      ? supabase.from("lesson_requests").select("*").eq("conversation_id", id).in("status", ["pending", "accepted"]).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

  const members: Member[] = ((memberRows ?? []) as unknown as { user_id: string; profile: { display_name: string; avatar_url: string | null } | null }[]).map(
    (m) => ({ id: m.user_id, name: m.profile?.display_name || "Player", avatarUrl: m.profile?.avatar_url ?? null }),
  );
  const messages = ((messageRows ?? []) as Message[]).reverse();
  const event = (conv as unknown as { event: { id: string; title: string; starts_at: string; sport: string } | null }).event;
  const other = members.find((m) => m.id !== me.id);
  const title =
    conv.kind === "event" ? event?.title ?? "Event chat" : conv.kind === "match" ? "Match chat" : other?.name ?? "Conversation";
  const playRequestId = (conv as unknown as { play_request_id: string | null }).play_request_id;
  const lessons = (lessonRows ?? []) as LessonRequest[];

  return (
    <div className="mx-auto flex h-[calc(100dvh-10rem)] max-w-2xl flex-col">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Link href="/chat" className="text-sm text-muted hover:text-court">← Messages</Link>
          <h1 className="truncate text-xl font-bold">{title}</h1>
          {conv.kind === "match" && playRequestId ? (
            <p className="text-sm text-muted">
              {members.map((m) => m.name).join(", ")} · <Link href={`/partner/${playRequestId}`} className="text-court underline">Game post</Link>
            </p>
          ) : null}
          {conv.kind === "event" && event ? (
            <p className="text-sm text-muted">
              {formatDay(event.starts_at)} · <Link href={`/${event.sport}/events/${event.id}`} className="text-court underline">Event page</Link> ·{" "}
              {members.length} members
            </p>
          ) : null}
        </div>
      </div>

      {lessons.map((l) => {
        const iAmCoach = l.coach_id === me.id;
        return (
          <div key={l.id} className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white px-4 py-2 text-sm">
            <span>
              <Badge tone={l.status === "accepted" ? "court" : "ball"}>{l.status === "accepted" ? "Lesson accepted" : "Lesson request"}</Badge>{" "}
              {l.kind} · {l.players} player{l.players > 1 ? "s" : ""} · {formatDay(l.preferred_at)} {formatTime(l.preferred_at)}
            </span>
            <span className="flex gap-2">
              {iAmCoach && l.status === "pending" ? (
                <>
                  <form action={respondLesson}>
                    <input type="hidden" name="request_id" value={l.id} />
                    <input type="hidden" name="back" value={`/chat/${id}`} />
                    <SubmitButton name="decision" value="accept" className="py-1" pending="…">Accept</SubmitButton>
                  </form>
                  <form action={respondLesson}>
                    <input type="hidden" name="request_id" value={l.id} />
                    <input type="hidden" name="back" value={`/chat/${id}`} />
                    <SubmitButton name="decision" value="decline" variant="secondary" className="py-1" pending="…">Decline</SubmitButton>
                  </form>
                </>
              ) : null}
              {!iAmCoach ? (
                <form action={cancelLesson}>
                  <input type="hidden" name="request_id" value={l.id} />
                    <input type="hidden" name="back" value={`/chat/${id}`} />
                  <SubmitButton variant="ghost" className="py-1" pending="…">Cancel request</SubmitButton>
                </form>
              ) : null}
            </span>
          </div>
        );
      })}

      <ChatRoom conversationId={id} meId={me.id} members={members} initialMessages={messages} />

      {conv.kind === "direct" && other ? (
        <div className="mt-3">
          <SafetyMenu userId={other.id} name={other.name} back="/chat" />
        </div>
      ) : members.length > 1 ? (
        <details className="mt-3 rounded-xl border border-line bg-white px-4 py-2 text-sm">
          <summary className="cursor-pointer text-muted">Report or block someone in this chat</summary>
          <div className="space-y-2 py-3">
            {members
              .filter((m) => m.id !== me.id)
              .slice(0, 60)
              .map((m) => (
                <SafetyMenu key={m.id} userId={m.id} name={m.name} back={`/chat/${id}`} />
              ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
