-- Member-gated hard delete. Deleting a node cascades to `links`
-- (both endpoints) and `node_contributors` via their ON DELETE CASCADE FKs.
-- Inbound [[slug]] markdown in other notes survives as a dangling link.

create or replace function public.delete_node(p_slug text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_member() then
    raise exception 'not authorized';
  end if;
  delete from public.nodes where slug = p_slug;
end $$;

grant execute on function public.delete_node(text) to authenticated;
