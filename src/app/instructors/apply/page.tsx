import type { Metadata } from "next";
import Link from "next/link";
import { requireOnboarded } from "@/lib/auth";
import { AREAS, LANGUAGES } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";
import type { CoachProfile } from "@/lib/types";
import { Notice, PageHeader } from "@/components/ui";
import { CoachForm } from "./coach-form";

export const metadata: Metadata = { title: "List yourself as an instructor" };

export default async function ApplyPage() {
  const profile = await requireOnboarded("/instructors/apply");
  const supabase = await createClient();
  const { data } = await supabase.from("coach_profiles").select("*").eq("user_id", profile.id).maybeSingle();
  const coach = data as CoachProfile | null;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={coach ? "Your instructor profile" : "List yourself as an instructor"}
        subtitle="Free for coaches. Players find you by area, level, price and language, then send lesson requests to your chat."
      />
      {coach?.status === "pending" ? (
        <div className="mb-5"><Notice tone="warn">In review. We check new instructor profiles before they go live, usually within a day.</Notice></div>
      ) : null}
      {coach?.status === "rejected" ? (
        <div className="mb-5">
          <Notice tone="danger">
            Needs changes{coach.review_note ? `: ${coach.review_note}` : "."} Save your edits to send it back for review.
          </Notice>
        </div>
      ) : null}
      {coach?.status === "approved" ? (
        <div className="mb-5">
          <Notice>
            Your profile is live. <Link href={`/instructors/${profile.id}`} className="font-semibold underline">View it</Link>
          </Notice>
        </div>
      ) : null}
      <CoachForm coach={coach} areas={AREAS} languages={LANGUAGES} />
    </div>
  );
}
