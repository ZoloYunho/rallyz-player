import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireOnboarded } from "@/lib/auth";
import { listVenueOptions } from "@/lib/events";
import { todayInBangkok } from "@/lib/time";
import { PageHeader } from "@/components/ui";
import { PostForm } from "./post-form";

export const metadata: Metadata = { title: "Post a game" };

export default async function NewPostPage() {
  const profile = await requireOnboarded("/partner/new");
  if (!profile.safety_ack_at) redirect("/partner/safety?next=/partner/new");
  const venues = await listVenueOptions();
  const lv = profile.level ?? 4;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Post a game" subtitle="Say when and where you'd like to play. Players at your level can ask to join." />
      <PostForm
        venues={venues}
        minDate={todayInBangkok()}
        defaults={{
          level_min: Math.max(1, lv - 1),
          level_max: Math.min(9, lv + 1),
          area: profile.areas[0],
          format: profile.formats[0] ?? "singles",
        }}
      />
    </div>
  );
}
