-- =============================================================================
-- AMPLIFY AGENDA (salon 11): asking for a review after the visit
--
-- After paying, the client gets a link (<slug>?avis=<ticket token>) on the WhatsApp ticket, or the
-- salon sends it later with one tap from "Avis clients". She gives stars and a word: the salon reads
-- it (per person who did the prestation), and every client, whatever the stars, is then invited to
-- post on Google (asking only the happy ones is forbidden by Google, so nobody is filtered).
-- =============================================================================
set lock_timeout = '10s';

alter table public.agenda_sales add column if not exists review_asked_at timestamptz;

create table if not exists public.agenda_feedback (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  sale_id        uuid not null,
  rating         smallint not null check (rating between 1 and 5),
  comment        text check (length(comment) <= 500),
  staff_ids      uuid[] not null default '{}',
  name           text check (length(name) <= 60),
  phone          text,
  google_at      timestamptz,
  created_at     timestamptz not null default now(),
  unique (restaurant_id, id),
  unique (sale_id),
  foreign key (restaurant_id, sale_id) references public.agenda_sales (restaurant_id, id) on delete cascade
);
create index if not exists agenda_feedback_idx on public.agenda_feedback (restaurant_id, created_at desc);
drop trigger if exists agenda_feedback_same_tenant on public.agenda_feedback;
create trigger agenda_feedback_same_tenant before update on public.agenda_feedback for each row execute function app.forbid_restaurant_change();
alter table public.agenda_feedback enable row level security;
revoke all on public.agenda_feedback from anon, authenticated;
grant select on public.agenda_feedback to authenticated;
drop policy if exists agenda_feedback_select on public.agenda_feedback;
create policy agenda_feedback_select on public.agenda_feedback for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('manager'))::uuid[]));

create or replace function app.salon_review_url(r public.restaurants)
returns text language sql immutable set search_path = '' as $$
  select case when r.branding ->> 'review_url' ~ '^https://\S{4,}$' and length(r.branding ->> 'review_url') <= 500 then r.branding ->> 'review_url' end
$$;

-- Public: the review page of a ticket (30 days)
create or replace function public.salon_feedback_info(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.agenda_sales; r public.restaurants; f public.agenda_feedback;
begin
  select * into s from public.agenda_sales where share_token = p_token and cancelled_at is null and created_at > now() - interval '30 days';
  if s.id is null then return null; end if;
  select * into r from public.restaurants where id = s.restaurant_id and status <> 'cancelled';
  if r.id is null then return null; end if;
  select * into f from public.agenda_feedback where sale_id = s.id;
  return jsonb_build_object(
    'salon', jsonb_build_object('name', r.name, 'slug', r.slug, 'languages', r.languages, 'branding', r.branding - 'guest_actions', 'handle', app.salon_handle(r)),
    'review_url', app.salon_review_url(r), 'at', s.created_at, 'name', s.name,
    'services', coalesce((select jsonb_agg(l.name order by l.sort) from public.agenda_sale_lines l where l.sale_id = s.id and l.kind = 'service'), '[]'::jsonb),
    'staff', coalesce((select jsonb_agg(distinct st.name) from public.agenda_sale_lines l join public.staff st on st.id = l.staff_id
                        where l.sale_id = s.id and l.kind = 'service'), '[]'::jsonb),
    'done', case when f.id is not null then jsonb_build_object('rating', f.rating, 'comment', f.comment) end);
end $$;

-- Public: the client's stars and word (once per ticket; she can change them the same day)
create or replace function public.salon_feedback(p_token text, p_rating int, p_comment text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare s public.agenda_sales; r public.restaurants; f public.agenda_feedback;
begin
  if p_rating is null or p_rating not between 1 and 5 then perform app.fail('invalid_request', 'rating'); end if;
  select * into s from public.agenda_sales where share_token = p_token and cancelled_at is null and created_at > now() - interval '30 days';
  if s.id is null then perform app.fail('not_found'); end if;
  select * into r from public.restaurants where id = s.restaurant_id;
  select * into f from public.agenda_feedback where sale_id = s.id for update;
  if f.id is not null then
    if f.created_at < now() - interval '1 day' then perform app.fail('already_done'); end if;
    update public.agenda_feedback set rating = p_rating, comment = nullif(left(btrim(p_comment), 500), '') where id = f.id;
  else
    insert into public.agenda_feedback (restaurant_id, sale_id, rating, comment, staff_ids, name, phone)
    values (s.restaurant_id, s.id, p_rating, nullif(left(btrim(p_comment), 500), ''),
            coalesce((select array_agg(distinct l.staff_id) from public.agenda_sale_lines l where l.sale_id = s.id and l.kind = 'service' and l.staff_id is not null), '{}'),
            s.name, s.phone);
  end if;
  return jsonb_build_object('ok', true, 'review_url', app.salon_review_url(r));
end $$;

-- Public: the client went on to Google
create or replace function public.salon_feedback_google(p_token text)
returns jsonb language sql volatile security definer set search_path = '' as $$
  update public.agenda_feedback f set google_at = coalesce(f.google_at, now())
    from public.agenda_sales s where s.share_token = p_token and f.sale_id = s.id;
  select jsonb_build_object('ok', true);
$$;
revoke all on function public.salon_feedback_info(text) from public;
revoke all on function public.salon_feedback(text, int, text) from public;
revoke all on function public.salon_feedback_google(text) from public;
grant execute on function public.salon_feedback_info(text) to anon, authenticated;
grant execute on function public.salon_feedback(text, int, text) to anon, authenticated;
grant execute on function public.salon_feedback_google(text) to anon, authenticated;

-- the salon: who to ask (paid in the last 3 days, a number, not asked, no answer yet), what clients
-- said, and the stars per person
create or replace function public.agenda_reviews(p_restaurant_id uuid, p_days int default 90)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; d int := least(365, greatest(7, coalesce(p_days, 90)));
begin
  r := app.require_role(p_restaurant_id, 'manager', false);
  return jsonb_build_object(
    'review_url', app.salon_review_url(r),
    'todo', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'at', s.created_at, 'name', s.name, 'phone', s.phone, 'token', s.share_token,
               'lang', (select a.lang from public.agenda_appointments a where a.id = s.appointment_id),
               'services', (select jsonb_agg(l.name order by l.sort) from public.agenda_sale_lines l where l.sale_id = s.id and l.kind = 'service'),
               'staff', (select jsonb_agg(distinct l.staff_id) from public.agenda_sale_lines l where l.sale_id = s.id and l.kind = 'service' and l.staff_id is not null))
               order by s.created_at desc)
       from public.agenda_sales s
      where s.restaurant_id = r.id and s.cancelled_at is null and s.phone is not null and s.review_asked_at is null
        and s.created_at > now() - interval '3 days'
        and exists (select 1 from public.agenda_sale_lines l where l.sale_id = s.id and l.kind = 'service')
        and not exists (select 1 from public.agenda_feedback f where f.sale_id = s.id)
        -- one ask per client: not again if she was asked or answered in the last 60 days
        and not exists (select 1 from public.agenda_sales o where o.restaurant_id = r.id and o.phone = s.phone and o.id <> s.id
                          and o.created_at > now() - interval '60 days'
                          and (o.review_asked_at is not null or exists (select 1 from public.agenda_feedback f where f.sale_id = o.id)))), '[]'::jsonb),
    'feedback', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'at', f.created_at, 'rating', f.rating, 'comment', f.comment, 'name', f.name,
               'phone', f.phone, 'staff', f.staff_ids, 'google', f.google_at is not null) order by f.created_at desc)
       from public.agenda_feedback f where f.restaurant_id = r.id and f.created_at > now() - make_interval(days => d)), '[]'::jsonb),
    'stats', (select jsonb_build_object('count', count(*), 'avg', round(avg(rating)::numeric, 2), 'google', count(*) filter (where google_at is not null),
               'asked', (select count(*) from public.agenda_sales s where s.restaurant_id = r.id and s.review_asked_at > now() - make_interval(days => d)))
       from public.agenda_feedback where restaurant_id = r.id and created_at > now() - make_interval(days => d)),
    'staff', coalesce((select jsonb_agg(jsonb_build_object('staff_id', x.sid, 'count', x.n, 'avg', x.a) order by x.a desc)
       from (select u.sid, count(*) n, round(avg(f.rating)::numeric, 2) a from public.agenda_feedback f, unnest(f.staff_ids) u(sid)
              where f.restaurant_id = r.id and f.created_at > now() - make_interval(days => d) group by u.sid) x), '[]'::jsonb));
end $$;

create or replace function public.agenda_review_asked(p_restaurant_id uuid, p_sale uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare r public.restaurants;
begin
  r := app.require_role(p_restaurant_id, 'device', true);
  update public.agenda_sales set review_asked_at = coalesce(review_asked_at, now()) where id = p_sale and restaurant_id = r.id;
  if not found then perform app.fail('not_found'); end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.agenda_reviews(uuid, int) from public, anon;
revoke all on function public.agenda_review_asked(uuid, uuid) from public, anon;
grant execute on function public.agenda_reviews(uuid, int) to authenticated;
grant execute on function public.agenda_review_asked(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
