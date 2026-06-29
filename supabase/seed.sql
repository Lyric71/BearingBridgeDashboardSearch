-- Static reference data that isn't project-specific.
-- The GTM kanban columns (was the "columns" array in gtm.json).
insert into public.board_columns (id, label, sort_order) values
  ('todo',  'To Do',       0),
  ('doing', 'In Progress', 1),
  ('done',  'Done',        2)
on conflict (id) do update
  set label = excluded.label, sort_order = excluded.sort_order;
