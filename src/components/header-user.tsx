import Link from "next/link";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Avatar } from "@/components/ui";
import { mainSiteUrl } from "@/lib/supabase/env";
import { DEFAULT_SPORT } from "@/lib/sports";

function CountDot({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="absolute -top-1 -right-1 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] leading-4 font-bold text-white">
      {count > 9 ? "9+" : count}
    </span>
  );
}

export async function HeaderUser() {
  const profile = await getProfile();
  if (!profile) {
    return (
      <div className="flex items-center gap-6">
        <Link href="/auth/login" className="text-[15px] text-ink hover:text-court">
          Log in
        </Link>
        <a
          href={mainSiteUrl()}
          className="hidden h-11 items-center rounded-lg border border-ink px-4 text-[15px] text-ink hover:bg-paper sm:inline-flex"
        >
          List your venue
        </a>
      </div>
    );
  }

  const supabase = await createClient();
  const [{ count: unreadNotifications }, { data: inbox }] = await Promise.all([
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
    supabase.rpc("my_conversations"),
  ]);
  const unreadChats = ((inbox as { unread: number }[] | null) ?? []).reduce((sum, c) => sum + (c.unread ?? 0), 0);

  return (
    <div className="flex items-center gap-3">
      <Link
        href={`/${DEFAULT_SPORT}/events/new`}
        className="hidden h-10 items-center rounded-lg border border-ink px-4 text-[15px] text-ink hover:bg-paper sm:inline-flex"
      >
        Host an event
      </Link>
      <Link href="/chat" className="relative rounded-full p-1.5 text-ink hover:bg-court-50" aria-label="Messages">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" strokeLinejoin="round" />
        </svg>
        <CountDot count={unreadChats} />
      </Link>
      <Link href="/notifications" className="relative rounded-full p-1.5 text-ink hover:bg-court-50" aria-label="Notifications">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8Z" strokeLinejoin="round" />
          <path d="M10 20a2 2 0 0 0 4 0" />
        </svg>
        <CountDot count={unreadNotifications ?? 0} />
      </Link>
      <Link href="/me" aria-label="My page">
        <Avatar name={profile.display_name} url={profile.avatar_url} size={32} />
      </Link>
    </div>
  );
}
