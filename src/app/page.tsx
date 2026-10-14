import Link from "next/link";
import { listEvents } from "@/lib/events";
import { DEFAULT_SPORT } from "@/lib/sports";
import { EventRow } from "@/components/event-row";
import { ButtonLink, EmptyState } from "@/components/ui";

const ORGANIZER_POINTS = [
  { title: "No more counting comments", text: "A live list of who's in, with a cap. When it's full, a waitlist fills spots automatically." },
  { title: "Get paid without chasing", text: "Confirmed players get your PromptPay QR with the fee filled in, and you tick off who paid." },
  { title: "Right-level games", text: "Set a level range so everyone gets a good game. Approve players yourself if you like." },
  { title: "Keep your group", text: "Post the Rallyz link in your Facebook or LINE group. It shows date, level, price and spots left." },
];

export default async function HomePage() {
  const events = await listEvents({ limit: 6, sport: DEFAULT_SPORT });

  return (
    <div className="space-y-14">
      <section className="overflow-hidden rounded-xl bg-court px-6 py-12 text-white sm:px-12 sm:py-16">
        <p className="text-sm font-semibold tracking-wide text-ball uppercase">Tennis in Bangkok</p>
        <h1 className="mt-3 max-w-2xl text-4xl leading-tight font-extrabold tracking-tight sm:text-5xl">
          Find a game at your level. Tonight.
        </h1>
        <p className="mt-4 max-w-xl text-white/80">
          Practice sessions, match play and group lessons with price and open spots shown up front. Join in one tap, chat with the group, pay by PromptPay.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href={`/${DEFAULT_SPORT}/events`} variant="accent" className="px-6 py-3 text-base">Find a game</ButtonLink>
          <ButtonLink href={`/${DEFAULT_SPORT}/instructors`} className="border border-white/30 bg-transparent px-6 py-3 text-base hover:bg-white/10">Find an instructor</ButtonLink>
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-end justify-between">
          <h2 className="text-xl font-bold">Coming up</h2>
          <Link href={`/${DEFAULT_SPORT}/events`} className="text-sm text-court underline">All events</Link>
        </div>
        {events.length ? (
          <div className="space-y-2">{events.map((e) => <EventRow key={e.id} event={e} />)}</div>
        ) : (
          <EmptyState title="No events yet">Host the first one and share it with your group.</EmptyState>
        )}
      </section>

      <section className="rounded-xl border border-line bg-white p-6 sm:p-10">
        <h2 className="text-xl font-bold">Run sessions in a Facebook group? Rallyz does the admin.</h2>
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          {ORGANIZER_POINTS.map((p) => (
            <div key={p.title} className="flex gap-3">
              <span aria-hidden className="mt-1 h-3 w-3 shrink-0 rounded-full bg-ball ring-2 ring-court" />
              <div>
                <p className="font-semibold">{p.title}</p>
                <p className="text-sm text-muted">{p.text}</p>
              </div>
            </div>
          ))}
        </div>
        <ButtonLink href={`/${DEFAULT_SPORT}/events/new`} className="mt-8">Host your first event</ButtonLink>
      </section>
    </div>
  );
}
