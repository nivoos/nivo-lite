-- account-data-types-payos-request-ref: forward-only; immutable once on origin/main. PAY-REQ (owner ruling R111): `payos.transaction`
-- version 2 (account-data rule 4: a schema change bumps the type version; old rows keep version 1). The ALTERING migration of a declared
-- type, written by hand (BE-PERSISTENCE-19, expand only): the one new member's CHECK, folded into the type's partition block after its last
-- CHECK (`-- alter_partition` below), which `npm run account-data:check` reads after the block that created the partition. complete: apply.
-- requestRef: the order code of the paid payOS link (the payment request's own reference), so a request's paid event is matched by it,
-- never by the transfer's words. Rows written before keep their value: the member is optional (absent passes its CHECK). No transaction
-- control.

-- alter_partition public.account_data_payos_transaction: payos.transaction version 2 (PAY-REQ, R111)
-- add_check public.account_data_payos_transaction:constraint:account_data_payos_transaction_request_ref_chk: added NOT VALID, then validated
ALTER TABLE public."account_data_payos_transaction" ADD CONSTRAINT "account_data_payos_transaction_request_ref_chk" CHECK ((value->>'requestRef') IS NULL OR (jsonb_typeof(value->'requestRef') = 'string' AND char_length((value->>'requestRef')) <= 100)) NOT VALID;
ALTER TABLE public."account_data_payos_transaction" VALIDATE CONSTRAINT "account_data_payos_transaction_request_ref_chk";
