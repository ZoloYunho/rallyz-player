import type { Metadata } from "next";
import { getProfile, safeNext } from "@/lib/auth";
import { SubmitButton } from "@/components/form";
import { ButtonLink, Card, Notice, PageHeader } from "@/components/ui";
import { acceptSafety } from "../actions";

export const metadata: Metadata = { title: "Playing safely" };

const TIPS = [
  { title: "Meet at the court", text: "Meet at a public club or park court, not at someone's home or car. Pick courts with staff or other players around." },
  { title: "Keep chat on Rallyz", text: "Use Rallyz chat until you've played together. Don't share your address, ID, or bank details." },
  { title: "Tell someone", text: "Let a friend know where you're playing and when you expect to be done." },
  { title: "Split costs fairly", text: "Agree on court and ball costs before you play. Never pay a deposit to someone you haven't met." },
  { title: "Trust your instincts", text: "If something feels off, leave. You don't owe anyone a game." },
  { title: "Report and block", text: "Every post and chat has Report or block. Reports go to the Rallyz team; blocking hides you from each other straight away." },
];

export default async function SafetyPage(props: PageProps<"/partner/safety">) {
  const sp = await props.searchParams;
  const next = safeNext(typeof sp.next === "string" ? sp.next : undefined, "/partner");
  const profile = await getProfile();

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Playing safely" subtitle="Most games are great. These habits keep it that way." />
      <ol className="space-y-3">
        {TIPS.map((t, i) => (
          <li key={t.title} className="flex gap-4 rounded-2xl border border-line bg-white p-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-court-50 font-mono text-sm font-bold text-court">{i + 1}</span>
            <div>
              <p className="font-semibold">{t.title}</p>
              <p className="mt-1 text-sm text-muted">{t.text}</p>
            </div>
          </li>
        ))}
      </ol>
      <Card className="mt-6">
        {!profile ? (
          <ButtonLink href={`/auth/login?next=${encodeURIComponent(`/partner/safety?next=${next}`)}`}>Log in to continue</ButtonLink>
        ) : profile.safety_ack_at ? (
          <div className="space-y-3">
            <Notice>You&apos;ve read these. Have a good game!</Notice>
            <ButtonLink href={next}>Continue</ButtonLink>
          </div>
        ) : (
          <form action={acceptSafety} className="space-y-3">
            <input type="hidden" name="next" value={next} />
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" required className="mt-1 accent-[var(--color-court)]" />
              I&apos;ve read these tips and will meet other players in public places.
            </label>
            <SubmitButton pending="Saving…">Continue</SubmitButton>
          </form>
        )}
      </Card>
    </div>
  );
}
