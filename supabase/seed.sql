-- Single starter node. Body intentionally empty — written via the editor.
-- (The access code is a write credential and is NOT seeded here: this repo is public.
--  It is inserted directly into access_codes out-of-band.)
insert into nodes (slug, title, body) values
('norms', 'Papert Lab wiki norms', '')
on conflict (slug) do nothing;
