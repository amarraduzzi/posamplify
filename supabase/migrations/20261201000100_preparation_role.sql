-- Ingredients page in three lists: what is bought, what is made to go into something else (icing, dough),
-- and what is made to be sold as it is (croissant, cinnamon roll).
-- prep_role: null = automatic (a preparation used directly in a dish of the menu is a finished product,
-- otherwise an intermediate one); 'intermediate' or 'final' when the owner chose.
set lock_timeout = '10s';
alter table public.ingredients add column if not exists prep_role text;
alter table public.ingredients drop constraint if exists ingredients_prep_role_check;
alter table public.ingredients add constraint ingredients_prep_role_check
  check (prep_role is null or (prep_role in ('intermediate', 'final') and is_preparation));
notify pgrst, 'reload schema';
