-- account-data-fact-key: forward-only; immutable once on origin/main. TL-S5 (owner R97): the engine side of a trigger declaration's optional
-- `factKey`. Two nullable columns on the raw row itself (no new table): `fact_key` = `<verb>:<the source's own identity of the fact>` of the
-- event the row reports, and `same_fact_of` = the id of the EARLIER row of the same workspace that reported the same fact (null on the
-- first). Both are written once, by the engine's claim, under an advisory lock on (workspace, fact key); a row that is deleted by its
-- type's retention frees its key. Expand only: existing rows keep both null (no fact key). The index serves the claim's lookup.
-- complete: apply.
ALTER TABLE public.account_data ADD COLUMN fact_key text;
ALTER TABLE public.account_data ADD COLUMN same_fact_of uuid;
ALTER TABLE public.account_data ADD CONSTRAINT account_data_fact_key_check CHECK (fact_key IS NULL OR char_length(fact_key) BETWEEN 1 AND 800);
ALTER TABLE public.account_data ADD CONSTRAINT account_data_same_fact_check CHECK (same_fact_of IS NULL OR fact_key IS NOT NULL);
CREATE INDEX account_data_fact_key ON public.account_data USING btree (workspace_id, fact_key) WHERE fact_key IS NOT NULL;
