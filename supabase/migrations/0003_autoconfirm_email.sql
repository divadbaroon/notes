-- Account creation without email verification.
-- (We have no dashboard / Management-API access to flip the "Confirm email" toggle, so we
--  achieve the same outcome in the database: auto-confirm every new auth user at insert.)
-- The access code remains the real gate; email confirmation was never the security boundary.
create or replace function public.auth_autoconfirm() returns trigger
  language plpgsql security definer set search_path = auth, public as $$
begin
  if new.email_confirmed_at is null then
    new.email_confirmed_at := now();
  end if;
  return new;
end $$;

drop trigger if exists autoconfirm_email on auth.users;
create trigger autoconfirm_email before insert on auth.users
  for each row execute function public.auth_autoconfirm();
