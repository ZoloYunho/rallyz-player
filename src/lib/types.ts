// Row shapes for the tables in supabase/migrations. Regenerate with
// `npx supabase gen types typescript` once the project is linked, if you
// prefer generated types.

export type ParticipantStatus = "pending" | "confirmed" | "waitlisted" | "declined" | "cancelled";
export type PaymentStatus = "unpaid" | "claimed" | "paid";
export type EntryMode = "instant" | "approval";

export type Profile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  level: number | null;
  areas: string[];
  bio: string;
  onboarded: boolean;
  is_founding_organizer: boolean;
  is_admin: boolean;
  play_times: string[];
  formats: string[];
  safety_ack_at: string | null;
  created_at: string;
};

export type PublicProfile = Pick<Profile, "id" | "display_name" | "avatar_url" | "level" | "is_founding_organizer">;

export type EventRow = {
  id: string;
  organizer_id: string;
  sport: string;
  type: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string;
  venue_id: string | null;
  venue_name: string;
  area: string;
  address: string | null;
  courts: number | null;
  level_min: number;
  level_max: number;
  fee_thb: number;
  capacity: number;
  format: string;
  entry_mode: EntryMode;
  cancel_deadline_hours: number;
  cancellation_policy: string;
  series_id: string | null;
  confirmed_count: number;
  waitlist_count: number;
  pending_count: number;
  spots_left: number;
  cancelled_at: string | null;
  created_at: string;
};

/** A venue from the main site's venues table. */
export type Venue = {
  id: string;
  name: string;
  district: string;
  address: string;
  google_maps_url: string | null;
  photos: string[] | null;
};

export type EventWithOrganizer = EventRow & {
  organizer: PublicProfile | null;
  venue?: Pick<Venue, "id" | "name" | "district" | "address" | "google_maps_url" | "photos"> | null;
};

export type RosterEntry = {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  level: number | null;
  status: ParticipantStatus;
  queued_at: string;
};

export type CoachProfile = {
  user_id: string;
  headline: string;
  bio: string;
  rate_private_thb: number;
  rate_group_thb: number | null;
  areas: string[];
  venues: string;
  level_min: number;
  level_max: number;
  languages: string[];
  years_coaching: number | null;
  certifications: string;
  trial_offer: string;
  status: "pending" | "approved" | "rejected";
  review_note: string | null;
  created_at: string;
  updated_at: string;
};

export type CoachWithProfile = CoachProfile & { profile: PublicProfile | null };

export type LessonRequest = {
  id: string;
  coach_id: string;
  player_id: string;
  kind: "private" | "group";
  players: number;
  preferred_at: string;
  note: string;
  status: "pending" | "accepted" | "declined" | "cancelled";
  conversation_id: string | null;
  created_at: string;
};

export type InboxRow = {
  conversation_id: string;
  kind: "direct" | "event" | "match";
  event_id: string | null;
  title: string;
  other_user_id: string | null;
  other_avatar_url: string | null;
  last_message: string | null;
  last_message_at: string;
  unread: number;
};

export type Message = {
  id: number;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

export type NotificationRow = {
  id: number;
  kind: string;
  body: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

/** Shape returned by server actions used with useActionState. */
export type ActionState = { error?: string; ok?: string } | undefined;

export type PlayRequestStatus = "open" | "filled" | "cancelled";
export type PlayAskStatus = "pending" | "accepted" | "declined" | "withdrawn";

export type PlayRequest = {
  id: string;
  author_id: string;
  starts_at: string;
  ends_at: string;
  area: string;
  venue_id: string | null;
  venue_name: string | null;
  court_booked: boolean;
  format: string;
  players_needed: number;
  level_min: number;
  level_max: number;
  note: string;
  status: PlayRequestStatus;
  accepted_count: number;
  pending_count: number;
  created_at: string;
  author: PublicProfile | null;
  venue?: { id: string; name: string; district: string; google_maps_url: string | null } | null;
};

export type PlayAsk = {
  request_id: string;
  user_id: string;
  message: string;
  status: PlayAskStatus;
  conversation_id: string | null;
  closed_by_fill: boolean;
  times_withdrawn: number;
  created_at: string;
};
