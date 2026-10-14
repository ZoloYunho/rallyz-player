-- P2 (find a partner), part 1. A new kind of chat for a matched group of
-- players. Kept in its own migration: Postgres can't use a new enum value in
-- the same transaction that adds it.
alter type public.conversation_kind add value if not exists 'match';
