-- mailbox-one-account: forward-only; immutable once on origin/main. MAIL-IN (ruling R92; rules MI-1 / MI-2). complete: apply.
-- Idempotent (every statement may run twice; the pair pass finds nothing left to join the second time).
-- A mail ENTRANCE is ONE provider account: a mailbox (one address) holding its inbound (IMAP) and outbound (SMTP) settings together. The
-- provider `smtp` grows the inbound half: its settings in the account's public facts (`config`, `email`, `summary`), its IMAP credential in
-- the account's READ credential slot (`connection_secrets.api_token_ciphertext`, the credential NIVO presents to read the account's data).
-- (1) public.mail_halves_join(inbound, outbound): joins an `imap` account (the inbound half standing alone) INTO an `smtp` account of the
--     same workspace and the SAME address. Refuses (raises) anything else: another workspace, other providers, a removed account, a sandbox
--     and a live one, two addresses, an `smtp` account that already holds an inbound half, a live inbound credential with no secret row on
--     the outbound account to carry it. In order, in the caller's transaction:
--       a. the inbound account's sealed credential is COPIED, unopened (AES-GCM with no associated data: a sealed text is valid on any row),
--          into the outbound account's read slot; NEVER LOST: the inbound secret row is deleted only after the copy, step e.
--       b. the outbound account's public facts take the inbound half's `config`, `email` and `summary` (the data sync's `cursor:<folder>`
--          facts are not taken: the connection poll's own cursor starts again, and the intake's key makes a mail read twice nothing).
--       c. EVERY row that references the inbound account by a foreign key into public.connections(id) (read from the catalog, so a table
--          added later is covered) is re-pointed to the outbound account, row by row; a row the outbound account already holds the same of
--          (a unique key: an agent attached to both, a trigger switch of the same name, a poll schedule row) is dropped. `account_data`
--          rows keep their type and key (the mails stay ONE `imap.mail` row each). The engine tables that name an account with no foreign
--          key (customer_routes, customer_messages `account_id`: the person's lines and the send ledger) are re-pointed too; an `smtp` account being joined holds
--          no route of the same person and channel (at this migration no `imap` account has any route: routes on a mailbox start with this
--          build; at a connect flow the `smtp` account is new), and the function refuses when one does.
--       d. the inbound account is soft-deleted (`deleted_at`, status `disconnected`), as the owner's remove does (ruling R36).
--       e. the inbound account's secret row is deleted (its credential now lives on the outbound account).
-- (2) THE PAIR PASS: for every workspace and address (lower(trim()) of imap `email` = smtp `from_email`) with EXACTLY ONE live imap and
--     EXACTLY ONE live smtp account, both live or both sandbox, the smtp account holding no inbound half yet: joined by (1). Left AS THEY
--     ARE, counted in the NOTICE: an imap account with no smtp of its address (an inbound half standing alone: it receives, never sends,
--     is no entrance), an smtp account with no imap of its address (a sender: workspace notices and invites, or a mailbox whose inbound half
--     is not set: no entrance until it is), an address with two of a kind (ambiguous: never a guess), a sandbox + live pair (mixed).
-- (3) The data sync no longer reads mailboxes (the connection poll does): every `imap` account's `cursor:<folder>` facts and its data-sync
--     schedule (`sync_every_minutes`, `next_sync_at`) are cleared; the poll enrols the account by itself.
-- Code without this file: a joined pair stays two accounts (the send refuses `entrance_incomplete` on the smtp one, the imap one's lines
-- route to it alone). This file without the code: harmless (the function is only called by the code and by this file).

CREATE OR REPLACE FUNCTION public.mail_halves_join(p_inbound uuid, p_outbound uuid) RETURNS void
    LANGUAGE plpgsql
    VOLATILE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_in public.connections%ROWTYPE;
    v_out public.connections%ROWTYPE;
    v_in_secret text;
    v_out_has_secret boolean;
    v_fk record;
    v_row record;
BEGIN
    SELECT * INTO v_in FROM public.connections WHERE id = p_inbound FOR UPDATE;
    SELECT * INTO v_out FROM public.connections WHERE id = p_outbound FOR UPDATE;
    IF v_in.id IS NULL OR v_out.id IS NULL THEN
        RAISE EXCEPTION 'mail_halves_join: no such account' USING ERRCODE = 'P0002';
    END IF;
    IF v_in.provider <> 'imap' OR v_out.provider <> 'smtp' OR v_in.workspace_id <> v_out.workspace_id
        OR v_in.deleted_at IS NOT NULL OR v_out.deleted_at IS NOT NULL OR v_in.sandbox <> v_out.sandbox
        OR lower(btrim(coalesce(v_in.public_meta ->> 'email', ''))) = ''
        OR lower(btrim(coalesce(v_in.public_meta ->> 'email', ''))) <> lower(btrim(coalesce(v_out.public_meta ->> 'from_email', '')))
        OR coalesce(v_out.public_meta ->> 'config', '') <> '' THEN
        RAISE EXCEPTION 'mail_halves_join: % and % are no pair of one mailbox', p_inbound, p_outbound USING ERRCODE = '22023';
    END IF;

    -- a. the sealed inbound credential, copied unopened into the outbound account's read slot.
    SELECT ciphertext INTO v_in_secret FROM public.connection_secrets WHERE connection_id = p_inbound;
    SELECT EXISTS (SELECT 1 FROM public.connection_secrets WHERE connection_id = p_outbound) INTO v_out_has_secret;
    IF v_in_secret IS NOT NULL THEN
        IF NOT v_out_has_secret THEN
            RAISE EXCEPTION 'mail_halves_join: % holds no secret row to carry the inbound credential', p_outbound USING ERRCODE = '22023';
        END IF;
        UPDATE public.connection_secrets SET api_token_ciphertext = v_in_secret WHERE connection_id = p_outbound;
    END IF;

    -- b. the inbound half's settings.
    UPDATE public.connections
       SET public_meta = public_meta || jsonb_strip_nulls(jsonb_build_object(
               'config', v_in.public_meta -> 'config',
               'email', v_in.public_meta -> 'email',
               'summary', v_in.public_meta -> 'summary')),
           updated_at = now()
     WHERE id = p_outbound;

    -- c. every foreign-key reference, row by row; a duplicate of what the outbound account holds is dropped.
    FOR v_fk IN
        SELECT c.conrelid::regclass AS tbl, a.attname AS col
          FROM pg_constraint c
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
         WHERE c.contype = 'f' AND c.confrelid = 'public.connections'::regclass AND array_length(c.conkey, 1) = 1
           AND c.conrelid <> 'public.connection_secrets'::regclass
           AND NOT EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhrelid = c.conrelid)
    LOOP
        FOR v_row IN EXECUTE format('SELECT ctid AS row_ctid, tableoid AS row_table FROM %s WHERE %I = $1', v_fk.tbl, v_fk.col) USING p_inbound
        LOOP
            BEGIN
                EXECUTE format('UPDATE %s SET %I = $1 WHERE ctid = $2 AND tableoid = $3', v_fk.tbl, v_fk.col)
                    USING p_outbound, v_row.row_ctid, v_row.row_table;
            EXCEPTION WHEN unique_violation THEN
                EXECUTE format('DELETE FROM %s WHERE ctid = $1 AND tableoid = $2', v_fk.tbl) USING v_row.row_ctid, v_row.row_table;
            END;
        END LOOP;
    END LOOP;

    -- c'. the engine tables that name an account without a foreign key.
    IF EXISTS (
        SELECT 1 FROM public.customer_routes r_in
          JOIN public.customer_routes r_out
            ON r_out.workspace_id = r_in.workspace_id AND r_out.contact_id = r_in.contact_id AND r_out.channel = r_in.channel
           AND r_out.account_id = p_outbound
         WHERE r_in.account_id = p_inbound) THEN
        RAISE EXCEPTION 'mail_halves_join: % already holds a route of a person % holds one of', p_outbound, p_inbound USING ERRCODE = '22023';
    END IF;
    UPDATE public.customer_routes SET account_id = p_outbound WHERE account_id = p_inbound;
    UPDATE public.customer_messages SET account_id = p_outbound WHERE account_id = p_inbound;

    -- d. the inbound account is removed (soft), e. its secret row after the copy.
    UPDATE public.connections SET deleted_at = now(), status = 'disconnected', updated_at = now() WHERE id = p_inbound;
    DELETE FROM public.connection_secrets WHERE connection_id = p_inbound;
END
$$;

REVOKE ALL ON FUNCTION public.mail_halves_join(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mail_halves_join(uuid, uuid) TO app_be;

-- (2) the pair pass, (3) the data sync's mailbox leftovers.
DO $$
DECLARE
    v_pair record;
    v_joined integer := 0;
    v_imap_alone integer;
    v_smtp_alone integer;
    v_ambiguous integer;
    v_mixed integer;
BEGIN
    CREATE TEMP TABLE mail_accounts ON COMMIT DROP AS
        SELECT id, workspace_id, provider, sandbox,
               lower(btrim(coalesce(CASE WHEN provider = 'imap' THEN public_meta ->> 'email' ELSE public_meta ->> 'from_email' END, ''))) AS address,
               coalesce(public_meta ->> 'config', '') <> '' AS has_inbound
          FROM public.connections
         WHERE provider IN ('imap', 'smtp') AND deleted_at IS NULL;

    SELECT count(*) INTO v_ambiguous FROM (
        SELECT workspace_id, address FROM mail_accounts WHERE address <> ''
         GROUP BY workspace_id, address
        HAVING count(*) FILTER (WHERE provider = 'imap') > 1 OR count(*) FILTER (WHERE provider = 'smtp') > 1) g;
    SELECT count(*) INTO v_mixed FROM (
        SELECT workspace_id, address FROM mail_accounts WHERE address <> ''
         GROUP BY workspace_id, address
        HAVING count(*) FILTER (WHERE provider = 'imap') = 1 AND count(*) FILTER (WHERE provider = 'smtp') = 1
           AND count(DISTINCT sandbox) > 1) g;

    FOR v_pair IN
        SELECT i.id AS inbound, s.id AS outbound
          FROM mail_accounts i
          JOIN mail_accounts s ON s.workspace_id = i.workspace_id AND s.address = i.address AND s.provider = 'smtp'
         WHERE i.provider = 'imap' AND i.address <> '' AND i.sandbox = s.sandbox AND NOT s.has_inbound
           AND (SELECT count(*) FROM mail_accounts x WHERE x.workspace_id = i.workspace_id AND x.address = i.address AND x.provider = 'imap') = 1
           AND (SELECT count(*) FROM mail_accounts x WHERE x.workspace_id = i.workspace_id AND x.address = i.address AND x.provider = 'smtp') = 1
    LOOP
        PERFORM public.mail_halves_join(v_pair.inbound, v_pair.outbound);
        v_joined := v_joined + 1;
    END LOOP;

    SELECT count(*) INTO v_imap_alone FROM public.connections WHERE provider = 'imap' AND deleted_at IS NULL;
    SELECT count(*) INTO v_smtp_alone FROM public.connections
     WHERE provider = 'smtp' AND deleted_at IS NULL AND coalesce(public_meta ->> 'config', '') = '';
    RAISE NOTICE 'mailbox-one-account: % pairs joined; left as they are: % imap accounts (inbound only), % smtp accounts (no inbound half), % ambiguous addresses, % sandbox+live pairs',
        v_joined, v_imap_alone, v_smtp_alone, v_ambiguous, v_mixed;

    -- (3) the data sync's cursors and schedule of a mailbox: the connection poll reads mail now.
    UPDATE public.connections
       SET public_meta = public_meta - ARRAY(SELECT k FROM jsonb_object_keys(public_meta) AS k WHERE k LIKE 'cursor:%'),
           sync_every_minutes = NULL,
           next_sync_at = NULL
     WHERE provider IN ('imap', 'smtp')
       AND (sync_every_minutes IS NOT NULL OR next_sync_at IS NOT NULL OR EXISTS (SELECT 1 FROM jsonb_object_keys(public_meta) AS k WHERE k LIKE 'cursor:%'));
END
$$;
