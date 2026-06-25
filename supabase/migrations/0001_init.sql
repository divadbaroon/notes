-- Extensions -----------------------------------------------------------
create extension if not exists pg_trgm;

-- Identity -------------------------------------------------------------
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text unique not null,
  created_at  timestamptz not null default now()
);

-- Access-code gate -----------------------------------------------------
create table access_codes (
  code        text primary key,
  label       text,
  max_uses    int  not null default 1,
  uses        int  not null default 0,
  active      bool not null default true,
  created_at  timestamptz not null default now()
);

-- Notes ("nodes") ------------------------------------------------------
create table nodes (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,
  title           text not null default '',
  body            text not null default '',
  body_text       text not null default '',
  created_by      uuid references profiles(id),
  last_edited_by  uuid references profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index nodes_title_trgm on nodes using gin (title gin_trgm_ops);
create index nodes_body_text_trgm on nodes using gin (body_text gin_trgm_ops);

-- Materialized internal links -----------------------------------------
create table links (
  id            bigint generated always as identity primary key,
  source_id     uuid not null references nodes(id) on delete cascade,
  target_id     uuid not null references nodes(id) on delete cascade,
  display_text  text,
  position      int  not null default 0
);
create index links_target on links (target_id);
create index links_source on links (source_id);

-- Author(s) ------------------------------------------------------------
create table node_contributors (
  node_id     uuid not null references nodes(id) on delete cascade,
  profile_id  uuid not null references profiles(id) on delete cascade,
  first_at    timestamptz not null default now(),
  primary key (node_id, profile_id)
);

-- Provenance trigger ---------------------------------------------------
create or replace function set_node_meta() returns trigger
  language plpgsql security definer as $$
begin
  new.updated_at := now();
  new.last_edited_by := auth.uid();
  if tg_op = 'INSERT' and new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end $$;
create trigger nodes_meta before insert or update on nodes
  for each row execute function set_node_meta();

-- RLS ------------------------------------------------------------------
alter table nodes enable row level security;
create policy nodes_read   on nodes for select using (true);
create policy nodes_insert on nodes for insert to authenticated with check (true);
create policy nodes_update on nodes for update to authenticated using (true) with check (true);
create policy nodes_delete on nodes for delete to authenticated using (true);

alter table links enable row level security;
create policy links_read  on links for select using (true);
create policy links_write on links for all to authenticated using (true) with check (true);

alter table node_contributors enable row level security;
create policy nc_read  on node_contributors for select using (true);
create policy nc_write on node_contributors for all to authenticated using (true) with check (true);

alter table profiles enable row level security;
create policy profiles_read       on profiles for select using (true);
create policy profiles_update_own on profiles for update to authenticated using (id = auth.uid());

alter table access_codes enable row level security;  -- no policies -> only service role

-- Search RPC -----------------------------------------------------------
create or replace function search_nodes(q text)
returns table(id uuid, slug text, title text) language sql stable as $$
  select id, slug, title from nodes
  where q = '' or title ilike '%' || q || '%' or title % q
  order by similarity(title, coalesce(nullif(q, ''), title)) desc, title asc
  limit 8;
$$;

-- Save RPC (used from PR4; created now) --------------------------------
create or replace function save_node(p_id uuid, p_slug text, p_title text, p_body text, p_links jsonb)
returns nodes language plpgsql security invoker as $$
declare
  v_node nodes;
  v_link jsonb;
begin
  insert into nodes (id, slug, title, body, body_text)
  values (
    coalesce(p_id, gen_random_uuid()),
    p_slug,
    coalesce(p_title, ''),
    coalesce(p_body, ''),
    regexp_replace(coalesce(p_body, ''), '[#*`>\[\]\(\)]', '', 'g')
  )
  on conflict (id) do update
    set title = excluded.title,
        body = excluded.body,
        body_text = excluded.body_text
  returning * into v_node;

  delete from links where source_id = v_node.id;
  if p_links is not null then
    for v_link in select * from jsonb_array_elements(p_links) loop
      insert into links (source_id, target_id, display_text, position)
      select v_node.id, n.id, nullif(v_link->>'display', ''), coalesce((v_link->>'position')::int, 0)
      from nodes n where n.slug = v_link->>'slug';
    end loop;
  end if;

  if auth.uid() is not null then
    insert into node_contributors (node_id, profile_id)
    values (v_node.id, auth.uid()) on conflict do nothing;
  end if;

  return v_node;
end $$;
