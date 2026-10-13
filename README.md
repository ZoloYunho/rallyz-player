# Rallyz: events, instructors and chat (P0 + P1)

Tennis-first community features for rallyz.club: players find and join games at their level, organizers run sessions without the Facebook-comment admin, and freelance instructors get structured profiles and lesson requests.

Built with Next.js 16 (App Router), Tailwind CSS 4 and Supabase (Postgres, Auth, Realtime). Times are Bangkok time throughout.

## What's included

**P0: launch**
- Sign-in with Google or an email link, then onboarding: name, level self-rating, home areas
- One 9-step level scale (`/levels`) used by every filter, badge and form
- Events (`/events`): list grouped by day with level, price and spots left on every row; filters for date, area, level, type, open spots and keyword
- Host an event: type, format, time, venue, area, level range, fee, capacity, instant or approval entry, cancellation deadline, a note only confirmed players see, and weekly repeats (up to 12 weeks in one go)
- Event page: join, request to join, or join the waitlist; leave with late-cancellation flagging; roster; share button; Google Maps link
- Share preview: posting an event link in Facebook or LINE shows a card with the date, level, price and spots left
- PromptPay: organizers add their PromptPay number once; confirmed players see a QR code with the fee filled in and tap "I've paid"; organizers confirm on the Manage page
- Manage page for organizers: approve/decline requests, remove players, waitlist order, payment tracking, participant note, cancel event (notifies everyone)
- In-app notifications, with an unread badge
- Founding Organizer badge, granted by admins

**P1: instructors and stronger events**
- Instructor profiles with structured fields: private and group rate (฿/hour), areas, usual courts, levels taught, languages, years, certifications, trial offer
- Admin review before a profile goes live; edits to a rejected profile send it back to review
- Instructor list (`/instructors`) filtered by area, level taught, max price and language
- Lesson requests: pick a time, and the request opens a chat with the instructor, who accepts or declines there
- Instructors post group lessons as events (type "Group lesson")
- Waitlist that fills spots automatically when someone leaves or the organizer adds spots
- A group chat per event (organizer and confirmed players) and one-to-one chat, both realtime
- Event reminders 24 hours before start (hourly job)
- Admin page (`/admin`): instructor reviews, weekly numbers (new players, events posted, joins, lesson requests, messages), most active organizers

`/partner` is a "coming soon" page for P2 (find a partner).

## Set up

### 1. Create a Supabase project
Create a project at supabase.com. The Singapore region is closest to Bangkok.

### 2. Create the database
Run the three files in `supabase/migrations/` in order. Either:
- paste each into the Supabase **SQL Editor** and run it, or
- use the CLI: `npx supabase link --project-ref <ref>` then `npx supabase db push`.

The third file schedules reminders with `pg_cron`. Enable **pg_cron** under Database > Extensions first, or skip that file and call `select public.send_event_reminders();` hourly from another scheduler.

### 3. Turn on sign-in
In Supabase, go to **Authentication**:
- **URL Configuration:** set Site URL to `https://rallyz.club` (or your domain). Add these redirect URLs: `http://localhost:3000/auth/callback` and `https://rallyz.club/auth/callback`.
- **Providers > Google:** enable it with a Google Cloud OAuth client. In Google Cloud, the authorized redirect URI is `https://<project-ref>.supabase.co/auth/v1/callback`.
- **Email:** works out of the box for testing, but Supabase's built-in email is rate-limited. Add your own SMTP (Authentication > Emails) before launch.

### 4. Run it
```bash
cp .env.example .env.local   # fill in the Supabase URL and publishable key
npm install
npm run dev                  # http://localhost:3000
```

### 5. Make yourself admin
Sign in once, then in the SQL Editor:
```sql
update public.profiles set is_admin = true
where id = (select id from auth.users where email = 'you@example.com');
```
You'll see an **Admin** button on My page.

### 6. Deploy
Vercel works with no extra config. Set the same three environment variables, with `NEXT_PUBLIC_SITE_URL=https://rallyz.club`.

## Fitting it into the existing rallyz.club

Routes match your current navigation: `/events`, `/instructors`, `/partner`, plus `/auth/login`. You can:
- deploy this as the site and move the court search and venue pages into it, or
- copy `src/app/events`, `src/app/instructors`, `src/app/chat`, `src/lib` and `src/components` into your existing Next.js app, using the same Supabase project.

The colours live in `src/app/globals.css` (`--color-court`, `--color-ball`). Change them to match your current brand.

## How it's built

```
supabase/migrations/   schema, row-level security, server functions
supabase/tests/        database flow tests (npm run test:db)
src/proxy.ts           refreshes the Supabase session on each request
src/lib/               Supabase clients, auth helpers, levels/areas, Bangkok time, PromptPay
src/app/               pages and server actions
src/components/        shared UI
```

**Security model.** Every table has row-level security. Anything that changes participation, waitlist order, counters, payments, instructor approval or badges goes through Postgres functions that check who is calling. The browser can't write those columns directly. PromptPay numbers and meeting-point notes are visible only to the organizer and confirmed players.

**Checks run before handover:**
- `npm run test:db` covers about 60 flows: joining, waitlist promotion, approvals, late cancellation, payments, private notes, chat privacy, instructor review, lesson requests, reminders, admin rights, and attempts to bypass each rule
- `npm run typecheck`, `npm run lint` and `npm run build` all pass
- the PromptPay QR payload matches the widely used `promptpay-qr` library byte for byte
- the public pages were rendered in Chromium on desktop and phone sizes

Not yet exercised against a live Supabase project: the Google and email sign-in round trip, and realtime chat delivery. Those are the first things to click through after setup.

## Not included yet
- **LINE Login.** Supabase has no built-in LINE provider. Options: add it through a custom OIDC provider if your Supabase plan supports one, or use a small LINE Login bridge. Google and email cover sign-in meanwhile.
- **Automatic payment confirmation.** PromptPay is player-marked and organizer-confirmed. Verifying transfers automatically needs a payment provider (for example Opn/Omise or 2C2P).
- **Push or email notifications.** Notifications are in-app only. Reminders are created hourly but not emailed.
- **Report and block** ship with P2 (find a partner).
