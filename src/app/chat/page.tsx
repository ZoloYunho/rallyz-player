import type { Metadata } from "next";
import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatRelative } from "@/lib/time";
import type { InboxRow } from "@/lib/types";
import { Avatar, EmptyState, Notice, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Messages" };

export default async function InboxPage(props: PageProps<"/chat">) {
  const sp = await props.searchParams;
  await requireProfile("/chat");
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_conversations");
  const rows = ((data ?? []) as InboxRow[]).filter((r) => r.kind === "event" || r.last_message);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Messages" subtitle="Event group chats and conversations with organizers, instructors and players." />
      {typeof sp.error === "string" ? <div className="mb-4"><Notice tone="danger">{sp.error}</Notice></div> : null}
      {rows.length === 0 ? (
        <EmptyState title="No messages yet">Join an event to get its group chat, or message an organizer from their event.</EmptyState>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
          {rows.map((r) => (
            <li key={r.conversation_id}>
              <Link href={`/chat/${r.conversation_id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-court-50">
                {r.kind === "event" ? (
                  <span aria-hidden className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-court text-sm font-bold text-ball">
                    #
                  </span>
                ) : (
                  <Avatar name={r.title} url={r.other_avatar_url} size={40} />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className={`truncate ${r.unread ? "font-bold" : "font-medium"}`}>{r.title}</p>
                    <span className="shrink-0 text-xs text-muted">{formatRelative(r.last_message_at)}</span>
                  </div>
                  <p className={`truncate text-sm ${r.unread ? "text-ink" : "text-muted"}`}>{r.last_message ?? "No messages yet"}</p>
                </div>
                {r.unread ? (
                  <span className="min-w-5 rounded-full bg-court px-1.5 text-center text-xs leading-5 font-bold text-white">{r.unread}</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
