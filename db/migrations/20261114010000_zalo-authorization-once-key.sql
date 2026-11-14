-- S4 (REFACTOR phase 2, F25): the once key of the complete-zalo-authorization job is declared in TypeScript
-- (`COMPLETE_ZALO_AUTHORIZATION_JOB.onceKey`, be/src/modules/queues/zalo-authorization) as
-- `zalo-authorization:<connection>:<sha-256 hex of the state>`. The database function that produces the job wrote an md5 digest of the same
-- state; this brings the producer to the declared key (J-1: the producer writes the declaration's key). The state holds a one-time nonce, so
-- only its digest travels in the key. Same arguments, same checks, same grants (CREATE OR REPLACE keeps the ACL).
--
-- STATUS: DRAFT. Enters db/migrations only when the lead posts "complete: apply". Code without it: the job runs as before (the key is the
-- dedupe key of the outbox row only; no consumer reads it). The migration without the code is harmless.

CREATE OR REPLACE FUNCTION public.zalo_authorization_return(p_state text, p_code text, p_oa_id text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
    v_connection uuid;
    v_workspace uuid;
begin
    begin
        v_connection := split_part(p_state, '.', 1)::uuid;
    exception when invalid_text_representation then
        raise exception 'the Zalo authorization state is not valid' using errcode = '23514';
    end;
    select workspace_id into v_workspace from public.connections where id = v_connection and provider = 'zalo_oa' and deleted_at is null;
    if v_workspace is null or not public.is_manager(v_workspace) then
        raise exception 'only an owner or manager of the workspace connects a channel' using errcode = '42501';
    end if;
    perform public.job_enqueue(
        v_workspace,
        'zalo_authorization',
        'complete-zalo-authorization',
        jsonb_build_object('workspaceId', v_workspace, 'state', p_state, 'code', p_code, 'oaId', p_oa_id),
        'zalo-authorization:' || v_connection || ':' || encode(sha256(convert_to(p_state, 'UTF8')), 'hex')
    );
    return v_connection;
end $$;
