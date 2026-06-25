-- Membership model: a user is a "member" (can write) iff they have a profile row.
-- Profiles are created ONLY by redeeming a valid access code (below). This gates writes
-- on the access code without needing a service-role edge function.

create or replace function is_member() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid());
$$;

-- Redeem an access code: validate, create the caller's profile, increment uses.
-- SECURITY DEFINER so it can touch the locked-down access_codes table and profiles.
create or replace function redeem_access_code(p_code text, p_username text)
  returns void language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from profiles where id = auth.uid()) then return; end if; -- already a member
  update access_codes set uses = uses + 1
    where code = p_code and active = true and uses < max_uses
    returning true into v_ok;
  if not coalesce(v_ok, false) then raise exception 'invalid or exhausted access code'; end if;
  insert into profiles (id, username) values (auth.uid(), trim(p_username));
end $$;

-- Tighten write policies: require membership (a redeemed code), not merely authentication.
drop policy if exists nodes_insert on nodes;
drop policy if exists nodes_update on nodes;
drop policy if exists nodes_delete on nodes;
create policy nodes_insert on nodes for insert to authenticated with check (is_member());
create policy nodes_update on nodes for update to authenticated using (is_member()) with check (is_member());
create policy nodes_delete on nodes for delete to authenticated using (is_member());

drop policy if exists links_write on links;
create policy links_write on links for all to authenticated using (is_member()) with check (is_member());

drop policy if exists nc_write on node_contributors;
create policy nc_write on node_contributors for all to authenticated using (is_member()) with check (is_member());

-- Make sure the API roles can execute the functions.
grant execute on function is_member() to anon, authenticated;
grant execute on function redeem_access_code(text, text) to authenticated;
grant execute on function search_nodes(text) to anon, authenticated;
grant execute on function save_node(uuid, text, text, text, jsonb) to authenticated;
