import type { Metadata } from "next";
import Link from "next/link";
import { requireOnboarded } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { todayInBangkok } from "@/lib/time";
import { Notice, PageHeader } from "@/components/ui";
import { EventForm } from "../event-form";

export const metadata: Metadata = { title: "Host an event" };

export default async function NewEventPage() {
  const profile = await requireOnboarded("/events/new");
  const supabase = await createClient();
  const { data: settings } = await supabase.from("organizer_settings").select("promptpay_id").eq("user_id", profile.id).maybeSingle();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Host an event" subtitle="Publish it here, then share the link in your Facebook or LINE group." />
      {!settings?.promptpay_id ? (
        <div className="mb-5">
          <Notice>
            Charging a fee? <Link href="/me#payments" className="font-semibold underline">Add your PromptPay</Link> so confirmed
            players get a QR code and can mark themselves as paid.
          </Notice>
        </div>
      ) : null}
      <EventForm mode="create" minDate={todayInBangkok()} values={{ level_min: profile.level ? Math.max(1, profile.level - 1) : 3, level_max: profile.level ? Math.min(9, profile.level + 1) : 6, area: profile.areas[0] }} />
    </div>
  );
}
