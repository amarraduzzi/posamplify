-- =============================================================================
-- 0026 KITCHEN SCREEN
-- =============================================================================
-- A tablet or TV in the kitchen (or at the bar) shows the bons of its station;
-- the cook taps a ticket when it is ready. ready_at is per line, because one
-- order can go to the kitchen and the bar. When every line is ready, the till
-- sets the order to "ready" (the guest following a QR order sees it too).
-- =============================================================================
alter table public.order_lines add column if not exists ready_at timestamptz;
