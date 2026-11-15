-- Changes the sign-in address of ONE account in place (SEED-HOOK / OWNER-PASS, 2026-11-15): the account keeps its id and everything tied
-- to it (workspaces it owns, memberships, sessions); only the address changes. The address is given normalised (lower-cased, trimmed) like
-- every other be_auth_* function reads it. Refused (raises, nothing written) when another account already has the address, or when the
-- account does not exist. Answers true when it changed the address, false when the account already had it.
-- Expand only: a new function, nothing existing changes. Forward-only; immutable once on origin/main.
-- complete: apply.
CREATE FUNCTION public.be_auth_set_email(p_user uuid, p_email text, p_now timestamp with time zone) RETURNS boolean
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_current text;
begin
  select lower(u.email) into v_current from auth.users u where u.id = p_user and u.is_anonymous = false for update;
  if not found then
    raise exception 'BE_AUTH_ACCOUNT_MISSING' using errcode = 'P0002';
  end if;
  if v_current = p_email then
    return false;
  end if;
  if exists (select 1 from auth.users u where lower(u.email) = p_email and u.id <> p_user) then
    raise exception 'BE_AUTH_EMAIL_TAKEN' using errcode = '23505';
  end if;
  update auth.users
     set email = p_email, email_confirmed_at = coalesce(email_confirmed_at, p_now), updated_at = p_now
   where id = p_user;
  return true;
end;
$$;

REVOKE EXECUTE ON FUNCTION public.be_auth_set_email(uuid, text, timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.be_auth_set_email(uuid, text, timestamp with time zone) TO app_be;
