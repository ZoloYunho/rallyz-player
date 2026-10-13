-- Rallyz server functions. Each public function checks who is calling;
-- internal helpers (prefixed with _) cannot be called by clients.

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

create function public._notify(
  p_user uuid, p_kind text, p_body text,
  p_event uuid default null, p_actor uuid default null, p_link text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_user = p_actor then
    return;
  end if;
  insert into public.notifications (user_id, kind, body, event_id, actor_id, link)
  values (p_user, p_kind, p_body, p_event, p_actor, coalesce(p_link, case when p_event is not null then '/events/' || p_event end));
end;
$$;

create function public._display_name(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(display_name, ''), 'A player') from public.profiles where id = p_user;
$$;

create function public._recount(p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.events e set
    confirmed_count = (select count(*) from public.event_participants p where p.event_id = e.id and p.status = 'confirmed'),
    waitlist_count  = (select count(*) from public.event_participants p where p.event_id = e.id and p.status = 'waitlisted'),
    pending_count   = (select count(*) from public.event_participants p where p.event_id = e.id and p.status = 'pending')
  where e.id = p_event;
end;
$$;

-- Keep the event's group chat membership in step with confirmed players.
create function public._sync_event_chat(p_event uuid, p_user uuid, p_member boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_conv uuid;
begin
  select id into v_conv from public.conversations where event_id = p_event;
  if v_conv is null then
    return;
  end if;
  if p_member then
    insert into public.conversation_members (conversation_id, user_id) values (v_conv, p_user)
    on conflict do nothing;
  else
    delete from public.conversation_members where conversation_id = v_conv and user_id = p_user;
  end if;
end;
$$;

-- Fill open spots from the waitlist, oldest first. Caller holds the event lock.
create function public._promote_waitlist(p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_event public.events;
  v_open int;
  v_next record;
begin
  select * into v_event from public.events where id = p_event;
  if v_event.cancelled_at is not null or v_event.starts_at <= now() then
    return;
  end if;
  v_open := v_event.capacity - (select count(*) from public.event_participants where event_id = p_event and status = 'confirmed');
  for v_next in
    select user_id from public.event_participants
    where event_id = p_event and status = 'waitlisted'
    order by queued_at, created_at
    limit greatest(v_open, 0)
  loop
    update public.event_participants set status = 'confirmed', updated_at = now()
      where event_id = p_event and user_id = v_next.user_id;
    perform public._sync_event_chat(p_event, v_next.user_id, true);
    perform public._notify(v_next.user_id, 'promoted',
      'A spot opened up. You are now confirmed for "' || v_event.title || '".', p_event, null);
  end loop;
  perform public._recount(p_event);
end;
$$;

-- Every new event gets a group chat with the organizer in it.
create function public.rallyz_handle_new_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_conv uuid;
begin
  insert into public.conversations (kind, event_id) values ('event', new.id) returning id into v_conv;
  insert into public.conversation_members (conversation_id, user_id) values (v_conv, new.organizer_id);
  insert into public.event_private_notes (event_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger on_event_created
  after insert on public.events
  for each row execute function public.rallyz_handle_new_event();

-- When an organizer raises capacity or switches to instant entry, waitlisted
-- players move up. Lowering capacity never removes confirmed players.
create function public.rallyz_handle_event_updated() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.capacity > old.capacity then
    perform public._promote_waitlist(new.id);
  end if;
  return new;
end;
$$;

create trigger on_event_updated
  after update of capacity on public.events
  for each row execute function public.rallyz_handle_event_updated();

-- Creates the caller's profile if it is missing (e.g. the sign-up trigger
-- failed). Safe to call any time.
create function public.rallyz_ensure_profile() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return;
  end if;
  insert into public.profiles (id, display_name, avatar_url)
  select u.id,
    left(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', split_part(coalesce(u.email, ''), '@', 1), ''), 60),
    case when (u.raw_user_meta_data ->> 'avatar_url') ~ '^https://' then left(u.raw_user_meta_data ->> 'avatar_url', 500) end
  from auth.users u where u.id = v_uid
  on conflict (id) do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- Joining and leaving events
-- ---------------------------------------------------------------------------

-- Returns the caller's resulting status: confirmed, waitlisted or pending.
create function public.join_event(p_event uuid) returns public.participant_status
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_event public.events;
  v_existing public.event_participants;
  v_status public.participant_status;
  v_confirmed int;
begin
  if v_uid is null then
    raise exception 'Sign in to join events' using errcode = '28000';
  end if;

  select * into v_event from public.events where id = p_event for update;
  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;
  if v_event.cancelled_at is not null then
    raise exception 'This event was cancelled' using errcode = 'P0001';
  end if;
  if v_event.starts_at <= now() then
    raise exception 'This event has already started' using errcode = 'P0001';
  end if;
  if v_event.organizer_id = v_uid then
    raise exception 'You are organizing this event' using errcode = 'P0001';
  end if;

  select * into v_existing from public.event_participants where event_id = p_event and user_id = v_uid;
  if found then
    if v_existing.status in ('confirmed', 'waitlisted', 'pending') then
      return v_existing.status;
    end if;
    if v_existing.status = 'declined' then
      raise exception 'The organizer declined your request for this event' using errcode = 'P0001';
    end if;
  end if;

  v_confirmed := (select count(*) from public.event_participants where event_id = p_event and status = 'confirmed');

  if v_event.entry_mode = 'approval' then
    v_status := 'pending';
  elsif v_confirmed < v_event.capacity then
    v_status := 'confirmed';
  else
    v_status := 'waitlisted';
  end if;

  insert into public.event_participants (event_id, user_id, status, queued_at, cancelled_late, payment_status)
  values (p_event, v_uid, v_status, now(), false, 'unpaid')
  on conflict (event_id, user_id) do update
    set status = excluded.status, queued_at = excluded.queued_at, cancelled_late = false,
        payment_status = 'unpaid', updated_at = now();

  if v_status = 'confirmed' then
    perform public._sync_event_chat(p_event, v_uid, true);
  end if;
  perform public._recount(p_event);

  perform public._notify(
    v_event.organizer_id,
    case v_status when 'pending' then 'join_request' when 'waitlisted' then 'waitlisted_join' else 'joined' end,
    public._display_name(v_uid) || case v_status
      when 'pending' then ' asked to join "'
      when 'waitlisted' then ' joined the waitlist for "'
      else ' joined "' end || v_event.title || '".',
    p_event, v_uid);

  return v_status;
end;
$$;

-- Leave an event or withdraw a request. Returns true if it was after the
-- cancellation deadline.
create function public.leave_event(p_event uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_event public.events;
  v_entry public.event_participants;
  v_late boolean := false;
begin
  if v_uid is null then
    raise exception 'Sign in first' using errcode = '28000';
  end if;
  select * into v_event from public.events where id = p_event for update;
  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;
  select * into v_entry from public.event_participants where event_id = p_event and user_id = v_uid;
  if not found or v_entry.status not in ('confirmed', 'waitlisted', 'pending') then
    raise exception 'You are not in this event' using errcode = 'P0001';
  end if;
  if v_event.starts_at <= now() then
    raise exception 'This event has already started' using errcode = 'P0001';
  end if;

  v_late := v_entry.status = 'confirmed'
    and now() > v_event.starts_at - make_interval(hours => v_event.cancel_deadline_hours);

  update public.event_participants
    set status = 'cancelled', cancelled_late = v_late, updated_at = now()
    where event_id = p_event and user_id = v_uid;

  perform public._sync_event_chat(p_event, v_uid, false);

  if v_entry.status = 'confirmed' then
    perform public._notify(v_event.organizer_id, 'left',
      public._display_name(v_uid) || ' left "' || v_event.title || '"' ||
      case when v_late then ' after the cancellation deadline.' else '.' end,
      p_event, v_uid);
    perform public._promote_waitlist(p_event);
  end if;
  perform public._recount(p_event);
  return v_late;
end;
$$;

-- Organizer approves or declines a request, or removes a player.
create function public.decide_participant(p_event uuid, p_user uuid, p_approve boolean)
returns public.participant_status
language plpgsql security definer set search_path = public as $$
declare
  v_event public.events;
  v_entry public.event_participants;
  v_status public.participant_status;
  v_confirmed int;
begin
  select * into v_event from public.events where id = p_event for update;
  if not found or v_event.organizer_id is distinct from auth.uid() then
    raise exception 'Only the organizer can do that' using errcode = '42501';
  end if;
  select * into v_entry from public.event_participants where event_id = p_event and user_id = p_user;
  if not found then
    raise exception 'Player not found in this event' using errcode = 'P0002';
  end if;

  if p_approve then
    if v_entry.status <> 'pending' then
      return v_entry.status;
    end if;
    v_confirmed := (select count(*) from public.event_participants where event_id = p_event and status = 'confirmed');
    v_status := case when v_confirmed < v_event.capacity then 'confirmed' else 'waitlisted' end;
    update public.event_participants set status = v_status, queued_at = now(), updated_at = now()
      where event_id = p_event and user_id = p_user;
    if v_status = 'confirmed' then
      perform public._sync_event_chat(p_event, p_user, true);
      perform public._notify(p_user, 'approved', 'You are confirmed for "' || v_event.title || '".', p_event, auth.uid());
    else
      perform public._notify(p_user, 'waitlisted',
        'Your request was approved, but "' || v_event.title || '" is full. You are on the waitlist.', p_event, auth.uid());
    end if;
  else
    if v_entry.status not in ('pending', 'confirmed', 'waitlisted') then
      return v_entry.status;
    end if;
    v_status := 'declined';
    update public.event_participants set status = 'declined', updated_at = now()
      where event_id = p_event and user_id = p_user;
    perform public._sync_event_chat(p_event, p_user, false);
    perform public._notify(p_user, 'declined',
      case when v_entry.status = 'confirmed'
        then 'The organizer removed you from "' || v_event.title || '".'
        else 'The organizer could not accept your request for "' || v_event.title || '".' end,
      p_event, auth.uid());
    if v_entry.status = 'confirmed' then
      perform public._promote_waitlist(p_event);
    end if;
  end if;

  perform public._recount(p_event);
  return v_status;
end;
$$;

create function public.cancel_event(p_event uuid, p_reason text default '') returns void
language plpgsql security definer set search_path = public as $$
declare
  v_event public.events;
  v_p record;
begin
  select * into v_event from public.events where id = p_event for update;
  if not found or v_event.organizer_id is distinct from auth.uid() then
    raise exception 'Only the organizer can cancel this event' using errcode = '42501';
  end if;
  if v_event.cancelled_at is not null then
    return;
  end if;
  update public.events set cancelled_at = now() where id = p_event;
  for v_p in
    select user_id from public.event_participants
    where event_id = p_event and status in ('confirmed', 'waitlisted', 'pending')
  loop
    perform public._notify(v_p.user_id, 'event_cancelled',
      '"' || v_event.title || '" was cancelled by the organizer.' ||
      case when coalesce(btrim(p_reason), '') <> '' then ' Reason: ' || left(btrim(p_reason), 300) else '' end,
      p_event, auth.uid());
  end loop;
end;
$$;

-- Public roster: confirmed players and the waitlist, without payment details.
create function public.get_roster(p_event uuid)
returns table (user_id uuid, display_name text, avatar_url text, level smallint,
               status public.participant_status, queued_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.user_id, pr.display_name, pr.avatar_url, pr.level, p.status, p.queued_at
  from public.event_participants p
  join public.profiles pr on pr.id = p.user_id
  where p.event_id = p_event and p.status in ('confirmed', 'waitlisted')
  order by p.status, p.queued_at;
$$;

-- ---------------------------------------------------------------------------
-- Payments (PromptPay, confirmed by hand)
-- ---------------------------------------------------------------------------

-- Players mark "I've paid"; organizers mark paid or unpaid.
create function public.set_payment_status(p_event uuid, p_user uuid, p_status public.payment_status) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_event public.events;
  v_entry public.event_participants;
begin
  select * into v_event from public.events where id = p_event;
  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;
  select * into v_entry from public.event_participants where event_id = p_event and user_id = p_user;
  if not found or v_entry.status <> 'confirmed' then
    raise exception 'Only confirmed players have payments' using errcode = 'P0001';
  end if;

  if v_uid = v_event.organizer_id then
    update public.event_participants set payment_status = p_status, updated_at = now()
      where event_id = p_event and user_id = p_user;
    if p_status = 'paid' then
      perform public._notify(p_user, 'payment_confirmed',
        'The organizer confirmed your payment for "' || v_event.title || '".', p_event, v_uid);
    end if;
  elsif v_uid = p_user and p_status in ('claimed', 'unpaid') and v_entry.payment_status <> 'paid' then
    update public.event_participants set payment_status = p_status, updated_at = now()
      where event_id = p_event and user_id = p_user;
    if p_status = 'claimed' then
      perform public._notify(v_event.organizer_id, 'payment_claimed',
        public._display_name(v_uid) || ' says they paid for "' || v_event.title || '".', p_event, v_uid);
    end if;
  else
    raise exception 'You cannot change this payment' using errcode = '42501';
  end if;
end;
$$;

create function public.get_payment_info(p_event uuid)
returns table (fee_thb integer, promptpay_id text, organizer_name text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if not exists (
    select 1 from public.events e where e.id = p_event and e.organizer_id = v_uid
  ) and not exists (
    select 1 from public.event_participants p where p.event_id = p_event and p.user_id = v_uid and p.status = 'confirmed'
  ) then
    return;
  end if;
  return query
    select e.fee_thb, s.promptpay_id, pr.display_name
    from public.events e
    join public.profiles pr on pr.id = e.organizer_id
    left join public.organizer_settings s on s.user_id = e.organizer_id
    where e.id = p_event;
end;
$$;

-- ---------------------------------------------------------------------------
-- Chat
-- ---------------------------------------------------------------------------

create function public.get_or_create_direct(p_other uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_key text;
  v_conv uuid;
begin
  if v_uid is null then
    raise exception 'Sign in first' using errcode = '28000';
  end if;
  if p_other is null or p_other = v_uid or not exists (select 1 from public.profiles where id = p_other) then
    raise exception 'Cannot start that conversation' using errcode = 'P0001';
  end if;
  v_key := least(v_uid::text, p_other::text) || ':' || greatest(v_uid::text, p_other::text);
  select id into v_conv from public.conversations where direct_key = v_key;
  if v_conv is null then
    insert into public.conversations (kind, direct_key) values ('direct', v_key)
      on conflict (direct_key) do nothing
      returning id into v_conv;
    if v_conv is null then
      select id into v_conv from public.conversations where direct_key = v_key;
    end if;
    insert into public.conversation_members (conversation_id, user_id)
      values (v_conv, v_uid), (v_conv, p_other)
      on conflict do nothing;
  end if;
  return v_conv;
end;
$$;

-- Conversations for the inbox, newest first, with unread counts.
create function public.my_conversations()
returns table (conversation_id uuid, kind public.conversation_kind, event_id uuid, title text,
               other_user_id uuid, other_avatar_url text, last_message text, last_message_at timestamptz,
               unread integer)
language sql stable security definer set search_path = public as $$
  select c.id, c.kind, c.event_id,
    case when c.kind = 'event' then e.title else coalesce(nullif(op.display_name, ''), 'Player') end,
    o.user_id, op.avatar_url,
    lm.body, c.last_message_at,
    (select count(*)::int from public.messages m2
      where m2.conversation_id = c.id and m2.created_at > me.last_read_at and m2.sender_id <> me.user_id)
  from public.conversation_members me
  join public.conversations c on c.id = me.conversation_id
  left join public.events e on e.id = c.event_id
  left join lateral (
    select m.user_id from public.conversation_members m
    where m.conversation_id = c.id and m.user_id <> me.user_id and c.kind = 'direct' limit 1
  ) o on true
  left join public.profiles op on op.id = o.user_id
  left join lateral (
    select body from public.messages m where m.conversation_id = c.id order by m.created_at desc limit 1
  ) lm on true
  where me.user_id = auth.uid()
  order by c.last_message_at desc;
$$;

-- ---------------------------------------------------------------------------
-- Instructors and lessons
-- ---------------------------------------------------------------------------

create function public.review_coach(p_user uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.rallyz_is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  update public.coach_profiles
    set status = case when p_approve then 'approved'::public.coach_status else 'rejected'::public.coach_status end,
        review_note = p_note, reviewed_at = now()
    where user_id = p_user;
  if not found then
    raise exception 'Instructor profile not found' using errcode = 'P0002';
  end if;
  perform public._notify(p_user,
    case when p_approve then 'coach_approved' else 'coach_rejected' end,
    case when p_approve then 'Your instructor profile is live.'
         else 'Your instructor profile needs changes.' ||
              case when coalesce(p_note, '') <> '' then ' ' || left(p_note, 300) else '' end end,
    null, auth.uid(), '/instructors/apply');
end;
$$;

-- Creates the request, opens a chat with the instructor and posts the
-- request there. Returns the conversation id.
create function public.request_lesson(
  p_coach uuid, p_kind public.lesson_kind, p_players smallint, p_preferred_at timestamptz, p_note text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_conv uuid;
  v_req uuid;
begin
  if v_uid is null then
    raise exception 'Sign in first' using errcode = '28000';
  end if;
  if p_coach = v_uid then
    raise exception 'You cannot book yourself' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.coach_profiles where user_id = p_coach and status = 'approved') then
    raise exception 'This instructor is not available' using errcode = 'P0001';
  end if;
  if p_preferred_at <= now() then
    raise exception 'Pick a time in the future' using errcode = 'P0001';
  end if;
  if (select count(*) from public.lesson_requests
      where player_id = v_uid and status = 'pending' and created_at > now() - interval '1 day') >= 10 then
    raise exception 'Too many open requests. Wait for instructors to reply.' using errcode = 'P0001';
  end if;

  v_conv := public.get_or_create_direct(p_coach);

  insert into public.lesson_requests (coach_id, player_id, kind, players, preferred_at, note, conversation_id)
  values (p_coach, v_uid, p_kind, greatest(1, least(coalesce(p_players, 1), 12)), p_preferred_at,
          left(coalesce(p_note, ''), 1000), v_conv)
  returning id into v_req;

  insert into public.messages (conversation_id, sender_id, body)
  values (v_conv, v_uid,
    'Lesson request: ' || p_kind::text || ' lesson for ' || greatest(1, least(coalesce(p_players, 1), 12)) ||
    case when greatest(1, least(coalesce(p_players, 1), 12)) = 1 then ' player' else ' players' end ||
    ' on ' || to_char(p_preferred_at at time zone 'Asia/Bangkok', 'Dy DD Mon, HH24:MI') || ' (Bangkok time).' ||
    case when coalesce(btrim(p_note), '') <> '' then E'\n' || left(btrim(p_note), 1000) else '' end);

  perform public._notify(p_coach, 'lesson_request',
    public._display_name(v_uid) || ' sent you a lesson request.', null, v_uid, '/chat/' || v_conv);
  return v_conv;
end;
$$;

create function public.respond_lesson_request(p_request uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_req public.lesson_requests;
begin
  select * into v_req from public.lesson_requests where id = p_request for update;
  if not found or v_req.coach_id is distinct from auth.uid() then
    raise exception 'Only the instructor can answer this request' using errcode = '42501';
  end if;
  if v_req.status <> 'pending' then
    return;
  end if;
  update public.lesson_requests
    set status = case when p_accept then 'accepted'::public.lesson_request_status else 'declined'::public.lesson_request_status end,
        responded_at = now()
    where id = p_request;
  if v_req.conversation_id is not null then
    insert into public.messages (conversation_id, sender_id, body)
    values (v_req.conversation_id, v_req.coach_id,
      case when p_accept then 'I accepted your lesson request. See you on court!'
           else 'Sorry, I cannot take this lesson request.' end);
  end if;
  perform public._notify(v_req.player_id,
    case when p_accept then 'lesson_accepted' else 'lesson_declined' end,
    public._display_name(v_req.coach_id) ||
      case when p_accept then ' accepted your lesson request.' else ' declined your lesson request.' end,
    null, v_req.coach_id, case when v_req.conversation_id is not null then '/chat/' || v_req.conversation_id end);
end;
$$;

create function public.cancel_lesson_request(p_request uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_req public.lesson_requests;
begin
  select * into v_req from public.lesson_requests where id = p_request for update;
  if not found or v_req.player_id is distinct from auth.uid() then
    raise exception 'Only the player can cancel this request' using errcode = '42501';
  end if;
  if v_req.status not in ('pending', 'accepted') then
    return;
  end if;
  update public.lesson_requests set status = 'cancelled', responded_at = now() where id = p_request;
  perform public._notify(v_req.coach_id, 'lesson_cancelled',
    public._display_name(v_req.player_id) || ' cancelled a lesson request.', null, v_req.player_id,
    case when v_req.conversation_id is not null then '/chat/' || v_req.conversation_id end);
end;
$$;

create function public.admin_set_founding_organizer(p_user uuid, p_value boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.rallyz_is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  update public.profiles set is_founding_organizer = p_value where id = p_user;
  if p_value then
    perform public._notify(p_user, 'founding_organizer',
      'You are now a Rallyz Founding Organizer. Thank you for hosting!', null, auth.uid(), '/me');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reminders and metrics
-- ---------------------------------------------------------------------------

-- Run hourly (see the cron migration). Reminds confirmed players and the
-- organizer about events starting in the next 24 hours.
create function public.send_event_reminders() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_event record;
  v_p record;
  v_count integer := 0;
begin
  for v_event in
    select * from public.events
    where cancelled_at is null and reminder_sent_at is null
      and starts_at > now() and starts_at <= now() + interval '24 hours'
    for update skip locked
  loop
    for v_p in
      select user_id from public.event_participants where event_id = v_event.id and status = 'confirmed'
      union select v_event.organizer_id
    loop
      perform public._notify(v_p.user_id, 'reminder',
        'Reminder: "' || v_event.title || '" starts ' ||
        to_char(v_event.starts_at at time zone 'Asia/Bangkok', 'Dy DD Mon "at" HH24:MI') || ' at ' || v_event.venue_name || '.',
        v_event.id, null);
      v_count := v_count + 1;
    end loop;
    update public.events set reminder_sent_at = now() where id = v_event.id;
  end loop;
  return v_count;
end;
$$;

-- Weekly numbers for the admin page (weeks start Monday, Bangkok time).
create function public.admin_weekly_metrics(p_weeks integer default 12)
returns table (week_start date, new_players bigint, events_posted bigint, joins bigint,
               lesson_requests bigint, messages_sent bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.rallyz_is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  return query
  with weeks as (
    select (date_trunc('week', now() at time zone 'Asia/Bangkok') - make_interval(weeks => g))::date as ws
    from generate_series(0, greatest(1, least(p_weeks, 52)) - 1) g
  )
  select w.ws,
    (select count(*) from public.profiles x where (x.created_at at time zone 'Asia/Bangkok')::date >= w.ws and (x.created_at at time zone 'Asia/Bangkok')::date < w.ws + 7),
    (select count(*) from public.events x where (x.created_at at time zone 'Asia/Bangkok')::date >= w.ws and (x.created_at at time zone 'Asia/Bangkok')::date < w.ws + 7),
    (select count(*) from public.event_participants x where (x.created_at at time zone 'Asia/Bangkok')::date >= w.ws and (x.created_at at time zone 'Asia/Bangkok')::date < w.ws + 7),
    (select count(*) from public.lesson_requests x where (x.created_at at time zone 'Asia/Bangkok')::date >= w.ws and (x.created_at at time zone 'Asia/Bangkok')::date < w.ws + 7),
    (select count(*) from public.messages x where (x.created_at at time zone 'Asia/Bangkok')::date >= w.ws and (x.created_at at time zone 'Asia/Bangkok')::date < w.ws + 7)
  from weeks w
  order by w.ws desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------

-- Only Rallyz's own functions: the project also serves the main site,
-- so never change permissions on functions we didn't create.
revoke execute on function public.rallyz_handle_new_user() from public, anon, authenticated;
revoke execute on function public.rallyz_is_admin(uuid) from public, anon, authenticated;
revoke execute on function public.is_conversation_member(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.rallyz_touch_conversation() from public, anon, authenticated;
revoke execute on function public.coach_profile_touch() from public, anon, authenticated;
revoke execute on function public._notify(uuid, text, text, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public._display_name(uuid) from public, anon, authenticated;
revoke execute on function public._recount(uuid) from public, anon, authenticated;
revoke execute on function public._sync_event_chat(uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function public._promote_waitlist(uuid) from public, anon, authenticated;
revoke execute on function public.rallyz_handle_new_event() from public, anon, authenticated;
revoke execute on function public.rallyz_handle_event_updated() from public, anon, authenticated;
revoke execute on function public.join_event(uuid) from public, anon, authenticated;
revoke execute on function public.leave_event(uuid) from public, anon, authenticated;
revoke execute on function public.decide_participant(uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.cancel_event(uuid, text) from public, anon, authenticated;
revoke execute on function public.get_roster(uuid) from public, anon, authenticated;
revoke execute on function public.set_payment_status(uuid, uuid, public.payment_status) from public, anon, authenticated;
revoke execute on function public.get_payment_info(uuid) from public, anon, authenticated;
revoke execute on function public.get_or_create_direct(uuid) from public, anon, authenticated;
revoke execute on function public.my_conversations() from public, anon, authenticated;
revoke execute on function public.review_coach(uuid, boolean, text) from public, anon, authenticated;
revoke execute on function public.request_lesson(uuid, public.lesson_kind, smallint, timestamptz, text) from public, anon, authenticated;
revoke execute on function public.respond_lesson_request(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.cancel_lesson_request(uuid) from public, anon, authenticated;
revoke execute on function public.admin_set_founding_organizer(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.send_event_reminders() from public, anon, authenticated;
revoke execute on function public.admin_weekly_metrics(integer) from public, anon, authenticated;
revoke execute on function public.rallyz_ensure_profile() from public, anon, authenticated;

grant execute on function public.rallyz_is_admin(uuid) to anon, authenticated;
grant execute on function public.is_conversation_member(uuid, uuid) to authenticated;
grant execute on function public.get_roster(uuid) to anon, authenticated;
grant execute on function public.rallyz_ensure_profile() to authenticated;
grant execute on function public.join_event(uuid) to authenticated;
grant execute on function public.leave_event(uuid) to authenticated;
grant execute on function public.decide_participant(uuid, uuid, boolean) to authenticated;
grant execute on function public.cancel_event(uuid, text) to authenticated;
grant execute on function public.set_payment_status(uuid, uuid, public.payment_status) to authenticated;
grant execute on function public.get_payment_info(uuid) to authenticated;
grant execute on function public.get_or_create_direct(uuid) to authenticated;
grant execute on function public.my_conversations() to authenticated;
grant execute on function public.review_coach(uuid, boolean, text) to authenticated;
grant execute on function public.request_lesson(uuid, public.lesson_kind, smallint, timestamptz, text) to authenticated;
grant execute on function public.respond_lesson_request(uuid, boolean) to authenticated;
grant execute on function public.cancel_lesson_request(uuid) to authenticated;
grant execute on function public.admin_weekly_metrics(integer) to authenticated;
grant execute on function public.admin_set_founding_organizer(uuid, boolean) to authenticated;

-- Realtime for chat and the notification badge.
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.notifications;
