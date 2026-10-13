"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RealtimePostgresInsertPayload } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { formatDay, formatTime } from "@/lib/time";
import type { Message } from "@/lib/types";
import { Avatar, btn, cx, field } from "@/components/ui";

export type Member = { id: string; name: string; avatarUrl: string | null };

type Pending = Message & { pending?: boolean; failed?: boolean };

export function ChatRoom({
  conversationId,
  meId,
  members,
  initialMessages,
}: {
  conversationId: string;
  meId: string;
  members: Member[];
  initialMessages: Message[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [messages, setMessages] = useState<Pending[]>(initialMessages);
  const [body, setBody] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  // Live updates and read receipts.
  useEffect(() => {
    const markRead = () =>
      supabase
        .from("conversation_members")
        .update({ last_read_at: new Date().toISOString() })
        .eq("conversation_id", conversationId)
        .eq("user_id", meId)
        .then(() => undefined);
    markRead();

    const channel = supabase
      .channel(`conversation:${conversationId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        (payload: RealtimePostgresInsertPayload<Message>) => {
          const msg = payload.new;
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            // Replace our optimistic copy if this is our own message.
            const i = prev.findIndex((m) => m.pending && m.sender_id === msg.sender_id && m.body === msg.body);
            if (i >= 0) return [...prev.slice(0, i), msg, ...prev.slice(i + 1)];
            return [...prev, msg];
          });
          if (msg.sender_id !== meId) markRead();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, conversationId, meId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setBody("");
    const tempId = -Date.now();
    setMessages((prev) => [
      ...prev,
      { id: tempId, conversation_id: conversationId, sender_id: meId, body: text, created_at: new Date().toISOString(), pending: true },
    ]);
    const { data, error } = await supabase.from("messages").insert({ conversation_id: conversationId, body: text }).select("*").single();
    setMessages((prev) => {
      if (error || !data) return prev.map((m) => (m.id === tempId ? { ...m, pending: false, failed: true } : m));
      const real = data as Message;
      const withoutTemp = prev.filter((m) => m.id !== tempId);
      return withoutTemp.some((m) => m.id === real.id) ? withoutTemp : [...withoutTemp, real];
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-white">
      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {messages.length === 0 ? <p className="py-10 text-center text-sm text-muted">Say hello 👋</p> : null}
        {messages.map((m, i) => {
          const mine = m.sender_id === meId;
          const sender = byId.get(m.sender_id);
          const day = formatDay(m.created_at);
          const showDay = i === 0 || formatDay(messages[i - 1].created_at) !== day;
          return (
            <div key={m.id}>
              {showDay ? <p className="my-3 text-center text-xs text-muted">{day}</p> : null}
              <div className={cx("flex items-end gap-2", mine && "flex-row-reverse")}>
                {!mine ? <Avatar name={sender?.name ?? "Player"} url={sender?.avatarUrl} size={28} /> : null}
                <div className={cx("max-w-[78%] rounded-2xl px-3 py-2", mine ? "bg-court text-white" : "bg-paper")}>
                  {!mine && members.length > 2 ? <p className="text-xs font-semibold text-court">{sender?.name ?? "Player"}</p> : null}
                  <p className="text-sm break-words whitespace-pre-line">{m.body}</p>
                  <p className={cx("mt-0.5 text-[10px]", mine ? "text-white/70" : "text-muted")}>
                    {m.failed ? "Not sent" : m.pending ? "Sending…" : formatTime(m.created_at)}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>
      <form onSubmit={send} className="flex gap-2 border-t border-line p-3">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          rows={1}
          maxLength={2000}
          placeholder="Write a message"
          className={cx(field, "resize-none")}
          aria-label="Message"
        />
        <button type="submit" disabled={!body.trim()} className={cx(btn.base, btn.primary)}>Send</button>
      </form>
    </div>
  );
}
