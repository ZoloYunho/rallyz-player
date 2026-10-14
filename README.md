# Rallyz: events, instructors and chat (P0 + P1)

Tennis-first community features for rallyz.club: players find and join games at their level, organizers run sessions without the Facebook-comment admin, and freelance instructors get structured profiles and lesson requests.

Built with Next.js 16 (App Router), Tailwind CSS 4 and Supabase (Postgres, Auth, Realtime). Times are Bangkok time throughout.

## What's included

**P0: launch**
- Sign-in with Google or an email link, then onboarding: name, level self-rating, home areas
- One 9-step level scale (`/levels`) used by every filter, badge and form
- Events (`/events`): list grouped by day with level, price and spots left on every row; filters for date, area, level, type, open spots and keyword
- Host an event: type, format, time, venue (picked from the main site's `venues`, or typed in), area, level range, fee, capacity, instant or approval entry, cancellation deadline, a note only confirmed players see, and weekly repeats (up to 12 weeks in one go)
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

**P2: find a partner**
- "Looking to play" posts (`/partner/new`): date and time window, area, court (from your venues, typed, or undecided), whether a court is booked, singles or doubles, players needed, level range, note
- Feed (`/partner`) of open posts, showing posts that include your level by default, with filters for date, area, format and level; visible to signed-in players only
- Ask to play: opens a direct chat with the author and posts the request there. The author accepts or declines; accepted players share a match chat. The post closes when enough players are in and reopens if someone drops out, and players turned away are told
- Profiles gain usual play times and preferred formats (also asked, optionally, at onboarding)
- Safety: tips to accept before the first post or ask (`/partner/safety`); report or block from any post or chat; blocking hides posts, stops direct messages, hides each other's messages in group chats, drops the blocked person from your matches and removes the chat from both inboxes; reports go to the admin page; limits on open posts, asks and re-asks
- Signed-out visitors see only names, photos and levels, never play times or areas

## Set up (shared with the main rallyz.club Supabase project)

This app uses the **same Supabase project as rallyz.club** and deploys as its own Vercel project at `play.rallyz.club`. The main site links to it; it links back with **Courts** in its header.

### 1. Check for name clashes (read-only)
In the Supabase **SQL Editor**, run `supabase/preflight.sql`. It changes nothing; it lists any existing tables, types or functions with the names Rallyz would create.
- **No rows:** safe to continue.
- **Any rows** (most likely `profiles`): stop and send the list over, so the migrations can be adapted to reuse or sit alongside what's there.

### 2. Create the Rallyz tables
Run the eight files in `supabase/migrations/` in order (SQL Editor, or `npx supabase db push` if this repo is linked to the project). What they do to the shared project:
- add new tables, types and functions only; Rallyz's own trigger and helper names start with `rallyz_`
- keep players in a new `player_profiles` table (name, photo, level, areas). Your `profiles` table, with phone numbers, is never touched or exposed
- link events to your existing `venues` table, which must exist before you run them
- create `app_admins` and add the current admin (the email in your claims/venues policies); Rallyz's admin page uses it
- change permissions only on Rallyz's own functions, never the main site's
- give every existing account a player profile, named from `profiles.full_name`; people set their level the first time they open Rallyz
- add one trigger on new sign-ups that creates a profile. It is fail-safe: if it ever errors, the sign-up still goes through and the profile is created on first visit.

The third migration schedules reminders with `pg_cron`. The fourth adds a chat type on its own because Postgres needs that committed before the fifth uses it; run them as separate queries in the SQL Editor. Enable **pg_cron** under Database > Extensions first, or skip that file and call `select public.send_event_reminders();` hourly from another scheduler.

The last three: `0600` keeps player profiles private until someone takes part in Rallyz; `0700` gives the website's roles access to the Rallyz tables (newer Supabase projects don't do this automatically); `0800` stores a sport on every event, partner post and instructor.

### Sports
The site is split by sport in the address: `/tennis/events`, `/tennis/partner`, `/tennis/instructors`, `/tennis/levels`. Only tennis is live (see `src/lib/sports.ts`). Old addresses without a sport (`/events/<id>`, links in older notifications) forward to the record's own sport. To add a sport: add it to `SPORTS`, give it a level scale, and its pages exist straight away; no database change is needed.

### 3. Auth settings
In Supabase **Authentication > URL Configuration**:
- **Leave Site URL as it is** (the main site).
- **Add redirect URLs:** `https://play.rallyz.club/auth/callback` and `http://localhost:3000/auth/callback`.

Google sign-in uses the provider you already have; nothing changes in Google Cloud.

### 4. Run locally
```bash
cp .env.example .env.local   # Supabase URL and publishable key; leave COOKIE_DOMAIN empty
npm install
npm run dev                  # http://localhost:3000
```

### 5. Deploy to play.rallyz.club
1. In Vercel, create a **new project** from this repo.
2. Add the domain `play.rallyz.club`, and the DNS record Vercel shows you.
3. Set these environment variables:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | same as the main site |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | same as the main site |
| `NEXT_PUBLIC_SITE_URL` | `https://play.rallyz.club` |
| `NEXT_PUBLIC_COOKIE_DOMAIN` | `.rallyz.club` |
| `NEXT_PUBLIC_MAIN_SITE_URL` | `https://rallyz.club` |

4. On the main site, point **Events**, **Instructors** and **Find partner** to `https://play.rallyz.club/events`, `/instructors` and `/partner`.

### 6. One login for both sites
Both sites read the same Supabase sign-in cookie only if both write it for `.rallyz.club`. This app does that via `NEXT_PUBLIC_COOKIE_DOMAIN`. **The main site needs the same one-line change** wherever it creates its Supabase client (server, browser and middleware):
```ts
createServerClient(url, key, { cookieOptions: { domain: ".rallyz.club" }, cookies: { ... } })
createBrowserClient(url, key, { cookieOptions: { domain: ".rallyz.club" } })
```
After that deploys, people already signed in on the main site sign in once more; from then on one sign-in covers both. Without this change everything still works, but players sign in separately on each site.

### 7. Admins
The migration adds your existing admin account to `app_admins`. To add another:
```sql
insert into public.app_admins (user_id) select id from auth.users where email = 'someone@example.com';
```
Admins see an **Admin** button on My page.

### 8. Main-site security fixes (separate from Rallyz)
`supabase/main-site-security-fixes.sql` closes the holes found in the main site's policies (public booking data, open coach edits, self-service plan upgrades, open holds and notifications). It is **not** a Rallyz migration and needs small main-site code changes, each marked `APP CHANGE` in the file. Follow the rollout in the *Rallyz Supabase Security Review* doc: run it on a branch first. `npm run test:fixes` replays your current policies, shows each hole, applies the fixes and checks the booking flow still works.

### Later: move under rallyz.club
When the sprint proves out, serve these pages from `rallyz.club/events` either with Vercel rewrites from the main project to this one (Next.js multi-zones) or by merging the code. The database stays as is.

## How it's built

```
supabase/migrations/   schema, row-level security, server functions
supabase/tests/        Rallyz flow tests (npm run test:db, npm run test:partner) and main-site fix tests (npm run test:fixes)
supabase/preflight.sql read-only name-clash check
supabase/main-site-security-fixes.sql  fixes for the main site (see section 8)
src/proxy.ts           refreshes the Supabase session on each request
src/lib/               Supabase clients, auth helpers, levels/areas, Bangkok time, PromptPay
src/app/               pages and server actions
src/components/        shared UI
```

**Security model.** Every table has row-level security. Anything that changes participation, waitlist order, counters, payments, instructor approval or badges goes through Postgres functions that check who is calling. The browser can't write those columns directly. PromptPay numbers and meeting-point notes are visible only to the organizer and confirmed players.

**Checks run before handover:**
- `npm run test:db` (74 checks) runs against stand-ins for your `profiles` and `venues` tables. It covers shared-project safety (existing users get profiles, the main site's functions keep working, sign-up can't be blocked), plus: joining, waitlist promotion, approvals, late cancellation, payments, private notes, chat privacy, instructor review, lesson requests, reminders, admin rights, and attempts to bypass each rule
- `npm run test:partner` (59 checks) covers posts, asks, matches, blocking, reports, limits and privacy
- `npm run test:fixes` (50 checks) covers the main-site security fixes
- `npm run typecheck`, `npm run lint` and `npm run build` all pass
- the PromptPay QR payload matches the widely used `promptpay-qr` library byte for byte
- the public pages were rendered in Chromium on desktop and phone sizes

Not yet exercised against a live Supabase project: the Google and email sign-in round trip, and realtime chat delivery. Those are the first things to click through after setup.

## Not included yet
- **LINE Login.** Supabase has no built-in LINE provider. Options: add it through a custom OIDC provider if your Supabase plan supports one, or use a small LINE Login bridge. Google and email cover sign-in meanwhile.
- **Automatic payment confirmation.** PromptPay is player-marked and organizer-confirmed. Verifying transfers automatically needs a payment provider (for example Opn/Omise or 2C2P).
- **Push or email notifications.** Notifications are in-app only. Reminders are created hourly but not emailed.
- **Open matches on real courts** (JAM!-style): sell seats on a court slot from `bk_courts`, hold it in `bk_bookings`, confirm when enough players pay. A natural next step, but it touches the live booking system, so it should follow the main-site security fixes.
- **Suggested partners and post-game ratings** (P3).
