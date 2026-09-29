-- =============================================================================
-- 0008 MOROCCO TIME: fixed UTC instead of 'Africa/Casablanca'
-- =============================================================================
-- Morocco has been on permanent UTC+0 since 20-09-2026 (decree). Many browsers
-- and servers still ship time zone data with the old rules for
-- 'Africa/Casablanca' and show times one hour off. The legacy Dom's Café till
-- used a fixed 'UTC' for the same reason. If Morocco changes its time again,
-- update the timezone of the restaurants here, nothing else.
-- =============================================================================
alter table public.restaurants alter column timezone set default 'UTC';
update public.restaurants set timezone = 'UTC' where timezone = 'Africa/Casablanca';
