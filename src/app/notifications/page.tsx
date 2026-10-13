import type { Metadata } from "next";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireProfile, getUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatRelative } from "@/lib/time";
import type { NotificationRow } from "@/lib/types";
import { SubmitButton } from "@/components/form";
import { EmptyState, PageHeader, cx } from "@/components/ui";

export const metadata: Metadata = { title: "Notifications" };

async function markAllRead() {
  "use server";
  const userId = await getUserId();
  if (!userId) return;
  const supabase = await createClient();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null).eq("user_id", userId);
  revalidatePath("/", "layout");
}

export default async function NotificationsPage() {
  await requireProfile("/notifications");
  const supabase = await createClient();
  const { data } = await supabase.from("notifications").select("id, kind, body, link, read_at, created_at").order("created_at", { ascending: false }).limit(100);
  const rows = (data ?? []) as NotificationRow[];
  const unread = rows.filter((r) => !r.read_at).length;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Notifications"
        action={
          unread ? (
            <form action={markAllRead}>
              <SubmitButton variant="secondary" pending="…">Mark all read</SubmitButton>
            </form>
          ) : null
        }
      />
      {rows.length === 0 ? (
        <EmptyState title="Nothing yet">You&apos;ll hear here when players join your events, spots open up, and more.</EmptyState>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
          {rows.map((n) => {
            const inner = (
              <div className={cx("flex gap-3 px-4 py-3", !n.read_at && "bg-court-50/60")}>
                <span aria-hidden className={cx("mt-2 h-2 w-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-court")} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{n.body}</p>
                  <p className="text-xs text-muted">{formatRelative(n.created_at)}</p>
                </div>
              </div>
            );
            return <li key={n.id}>{n.link ? <Link href={n.link} className="block hover:bg-court-50">{inner}</Link> : inner}</li>;
          })}
        </ul>
      )}
    </div>
  );
}
