import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireProfile, safeNext } from "@/lib/auth";
import { AREAS } from "@/lib/constants";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Welcome" };

export default async function OnboardingPage(props: PageProps<"/onboarding">) {
  const sp = await props.searchParams;
  const next = safeNext(typeof sp.next === "string" ? sp.next : undefined);
  const profile = await requireProfile("/onboarding");
  if (profile.onboarded) redirect(next);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-3xl font-bold tracking-tight">Welcome to Rallyz</h1>
      <p className="mt-2 text-muted">
        A few quick things so organizers and players know who they&apos;re playing with. You can change these any time.
      </p>
      <OnboardingForm next={next} name={profile.display_name} areas={AREAS} />
    </div>
  );
}
