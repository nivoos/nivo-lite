-- contact-consent: forward-only; immutable once on origin/main. WRITTEN, NOT APPLIED by the GRAPH-CLEAN worker: the restart owner applies
-- it WITH the code of the same tree (owner ruling R67: "do not contact" is a CONSENT FLAG of the contact, enforced at the customer send for
-- every agent; the sales package's `careOptOut` fact and its door go away).
-- Rule (GRAPH-CLEAN, engine words): one fact on the contact: may the shop write to this person on its OWN initiative (yes / no, when set,
-- by whom, why). A message that ANSWERS the person on the route they wrote on is always allowed; a message the shop STARTS is refused
-- `customer_opted_out` when the fact says no. Set by a person on the contact page, or by a node step's call of `nivo.tool.contact.update`
-- (`doNotContact`) when the person asked to stop; cleared only by a person.

-- 1. The columns: the fact and who changed it last (the actor columns mirror `contact_events`: a step names its agent; a member names
--    themselves in `decided_by`; a step's approver too). A clear (false after a change) is a member's only.
ALTER TABLE public.contacts
    ADD COLUMN do_not_contact boolean DEFAULT false NOT NULL,
    ADD COLUMN do_not_contact_at timestamptz,
    ADD COLUMN do_not_contact_actor text,
    ADD COLUMN do_not_contact_decided_by text,
    ADD COLUMN do_not_contact_agent_id uuid,
    ADD COLUMN do_not_contact_step_key text,
    ADD COLUMN do_not_contact_reason text,
    ADD CONSTRAINT contacts_do_not_contact_actor_check CHECK ((do_not_contact_actor IS NULL OR do_not_contact_actor = ANY (ARRAY['member'::text, 'step'::text]))),
    ADD CONSTRAINT contacts_do_not_contact_changed_check CHECK (((do_not_contact_at IS NULL) = (do_not_contact_actor IS NULL))),
    ADD CONSTRAINT contacts_do_not_contact_never_set_check CHECK ((do_not_contact_at IS NOT NULL OR NOT do_not_contact)),
    ADD CONSTRAINT contacts_do_not_contact_step_check CHECK (((do_not_contact_actor = 'step'::text) = (do_not_contact_agent_id IS NOT NULL))),
    ADD CONSTRAINT contacts_do_not_contact_member_check CHECK ((do_not_contact_actor IS DISTINCT FROM 'member'::text OR do_not_contact_decided_by IS NOT NULL)),
    ADD CONSTRAINT contacts_do_not_contact_cleared_check CHECK ((do_not_contact OR do_not_contact_actor IS DISTINCT FROM 'step'::text)),
    ADD CONSTRAINT contacts_do_not_contact_decided_by_check CHECK ((do_not_contact_decided_by IS NULL OR char_length(do_not_contact_decided_by) BETWEEN 1 AND 200)),
    ADD CONSTRAINT contacts_do_not_contact_step_key_check CHECK ((do_not_contact_step_key IS NULL OR char_length(do_not_contact_step_key) BETWEEN 1 AND 400)),
    ADD CONSTRAINT contacts_do_not_contact_reason_check CHECK ((do_not_contact_reason IS NULL OR char_length(do_not_contact_reason) BETWEEN 1 AND 500));

COMMENT ON COLUMN public.contacts.do_not_contact IS 'The consent fact: true when the shop may not write to this person first (an answer on their own route still goes).';

-- 2. The audit action of a change.
ALTER TABLE public.contact_events DROP CONSTRAINT IF EXISTS contact_events_action_check;
ALTER TABLE public.contact_events ADD CONSTRAINT contact_events_action_check CHECK ((action = ANY (ARRAY['identity_linked'::text, 'identity_unlinked'::text, 'merged'::text, 'updated'::text, 'memory_forgotten'::text, 'erased'::text, 'consent_changed'::text])));

-- 3. The old mechanism's TRUE facts move onto the contact: `careOptOut` in the facts entry of the customer's memory (`$lead|$facts`). The
--    entry names its contact (`contact_id`), else the subject `lead:<id>` whose id is a contact of the workspace; the agent that wrote it
--    is the step actor. A true fact that names no contact or no agent would be lost: the file REFUSES (rolls back) while one exists, so the
--    restart owner sets it by hand on the contact page first. From code reading (no database read): dev is expected to hold none (the
--    baseline's read of 2026-11-11 found none on the sales records; the door had no fe caller).
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.contact_memory m
        LEFT JOIN public.contacts c
            ON c.workspace_id = m.workspace_id
           AND c.id = COALESCE(m.contact_id, CASE WHEN m.subject_key ~ '^lead:[0-9a-f-]{36}$' THEN substr(m.subject_key, 6)::uuid END)
        WHERE m.namespace = '$lead' AND m.node_key = '$facts' AND m.kind = 'facts'
          AND m.output->'value'->>'careOptOut' = 'true'
          AND (c.id IS NULL OR m.agent_id IS NULL)
    ) THEN
        RAISE EXCEPTION 'contact-consent: a careOptOut fact names no contact or no agent; set "do not contact" on that contact by hand first';
    END IF;
END
$$;

UPDATE public.contacts c
SET do_not_contact = true,
    do_not_contact_at = m.written_at,
    do_not_contact_actor = 'step',
    do_not_contact_agent_id = m.agent_id,
    do_not_contact_reason = 'careOptOut (moved from the customer memory)'
FROM public.contact_memory m
WHERE m.namespace = '$lead' AND m.node_key = '$facts' AND m.kind = 'facts'
  AND m.output->'value'->>'careOptOut' = 'true'
  AND m.agent_id IS NOT NULL
  AND c.workspace_id = m.workspace_id
  AND c.id = COALESCE(m.contact_id, CASE WHEN m.subject_key ~ '^lead:[0-9a-f-]{36}$' THEN substr(m.subject_key, 6)::uuid END)
  AND NOT c.do_not_contact;

-- 4. The shop's care opt-out door is deleted (`careOptOut` / `setCareOptOut`): its presses become the contact's consent history. Each
--    press becomes a `consent_changed` event of its contact (the press subject is the contact id) with the member who pressed; then the
--    door leaves the presses' CHECK. A press whose subject is no contact of its workspace would be lost: the file refuses while one exists.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.agent_door_presses p
        WHERE p.door = 'care.opt_out'
          AND NOT EXISTS (
              SELECT 1 FROM public.contacts c
              WHERE c.workspace_id = p.workspace_id AND p.subject ~ '^[0-9a-f-]{36}$' AND c.id::text = p.subject
          )
    ) THEN
        RAISE EXCEPTION 'contact-consent: a care.opt_out press names no contact; read it and decide by hand first';
    END IF;
END
$$;

INSERT INTO public.contact_events (workspace_id, contact_id, action, detail, actor_kind, decided_by, created_at)
SELECT p.workspace_id, p.subject::uuid, 'consent_changed',
       jsonb_build_object('doNotContact', COALESCE((p.detail->>'optOut')::boolean, false), 'reason', false, 'movedFrom', 'care.opt_out'),
       'member', p.member_id, p.pressed_at
FROM public.agent_door_presses p
WHERE p.door = 'care.opt_out';

DELETE FROM public.agent_door_presses WHERE door = 'care.opt_out';
ALTER TABLE public.agent_door_presses DROP CONSTRAINT IF EXISTS agent_door_presses_door_check;
ALTER TABLE public.agent_door_presses ADD CONSTRAINT agent_door_presses_door_check CHECK ((door = ANY (ARRAY['schedule.run_now'::text, 'conversation.release'::text])));
