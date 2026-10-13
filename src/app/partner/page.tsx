import type { Metadata } from "next";
import { ButtonLink, Card } from "@/components/ui";

export const metadata: Metadata = { title: "Find a partner" };

/** Partner matching is the next phase (P2). Until then, point people to events. */
export default function PartnerPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <Card className="space-y-4 p-8 text-center">
        <p className="text-sm font-semibold tracking-wide text-court uppercase">Coming soon</p>
        <h1 className="text-2xl font-bold">Find a hitting partner at your level</h1>
        <p className="text-muted">
          Post when and where you want to play, and get matched with players at your level nearby. Until then, the quickest way to
          meet players is to join an event.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <ButtonLink href="/events">Browse events</ButtonLink>
          <ButtonLink href="/events/new" variant="secondary">Host a session</ButtonLink>
        </div>
      </Card>
    </div>
  );
}
