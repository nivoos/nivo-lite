-- account-data-types-mail: forward-only; immutable once on origin/main. MAIL-IN: `imap.mail` version 2 (account-data rule 4: a schema change
-- bumps the type version; old rows keep version 1). The ALTERING migration of a declared type, written by hand (BE-PERSISTENCE-19, expand
-- only): the four new members' CHECKs, in the declaration's member order, appended to the type's partition block (`-- alter_partition`
-- below), which `npm run account-data:check` reads after the block that created the partition. complete: apply.
-- references (the thread's ids), autoSubmitted / precedence / returnPath (the raw headers the standards define for mail no person wrote).
-- Rows written before keep their value: every new member is optional (absent passes its CHECK). No transaction control.

-- alter_partition public.account_data_imap_mail: imap.mail version 2 (MAIL-IN)
-- add_check public.account_data_imap_mail:constraint:account_data_imap_mail_references_chk: added NOT VALID, then validated
ALTER TABLE public."account_data_imap_mail" ADD CONSTRAINT "account_data_imap_mail_references_chk" CHECK ((value->>'references') IS NULL OR (jsonb_typeof(value->'references') <> 'null')) NOT VALID;
ALTER TABLE public."account_data_imap_mail" VALIDATE CONSTRAINT "account_data_imap_mail_references_chk";
-- add_check public.account_data_imap_mail:constraint:account_data_imap_mail_auto_submitted_chk: added NOT VALID, then validated
ALTER TABLE public."account_data_imap_mail" ADD CONSTRAINT "account_data_imap_mail_auto_submitted_chk" CHECK ((value->>'autoSubmitted') IS NULL OR (jsonb_typeof(value->'autoSubmitted') = 'string' AND char_length((value->>'autoSubmitted')) <= 400)) NOT VALID;
ALTER TABLE public."account_data_imap_mail" VALIDATE CONSTRAINT "account_data_imap_mail_auto_submitted_chk";
-- add_check public.account_data_imap_mail:constraint:account_data_imap_mail_precedence_chk: added NOT VALID, then validated
ALTER TABLE public."account_data_imap_mail" ADD CONSTRAINT "account_data_imap_mail_precedence_chk" CHECK ((value->>'precedence') IS NULL OR (jsonb_typeof(value->'precedence') = 'string' AND char_length((value->>'precedence')) <= 400)) NOT VALID;
ALTER TABLE public."account_data_imap_mail" VALIDATE CONSTRAINT "account_data_imap_mail_precedence_chk";
-- add_check public.account_data_imap_mail:constraint:account_data_imap_mail_return_path_chk: added NOT VALID, then validated
ALTER TABLE public."account_data_imap_mail" ADD CONSTRAINT "account_data_imap_mail_return_path_chk" CHECK ((value->>'returnPath') IS NULL OR (jsonb_typeof(value->'returnPath') = 'string' AND char_length((value->>'returnPath')) <= 400)) NOT VALID;
ALTER TABLE public."account_data_imap_mail" VALIDATE CONSTRAINT "account_data_imap_mail_return_path_chk";
