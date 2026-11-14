-- payment-order-codes-and-requests: forward-only; DRAFT by S5 (REFACTOR-LEAD phase 2), enters db/migrations only on the lead's "complete: apply".
-- Idempotent (every statement may run twice).
-- (1) ONE ORDER PER REQUEST. A payment-order request makes ONE order whatever number of runs the job gets: the order carries the id of the
--     request it answers, unique, so a run killed between "the order was written" and "the request was answered" writes nothing the second
--     time and answers the order the first run made. Orders made outside a request keep a null request_id.
ALTER TABLE public.payment_orders ADD COLUMN IF NOT EXISTS request_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_request_id_key ON public.payment_orders USING btree (request_id) WHERE request_id IS NOT NULL;

-- (2) AN ORDER CODE IS DRAWN IN THE INSERT STATEMENT, AND NEVER COLLIDES. The code is "NIVO" + 5 characters of the 31-letter readable alphabet
--     (31^5 = 28,629,151 codes). The next code is the next value of a sequence run through a bijection of the code space (multiplication by a
--     number coprime to 31, then a shift, modulo the space): two draws never give the same code, so the application keeps no collision loop.
--     The only loop is in SQL and runs only past a code that an order written before this file already holds (those were drawn at random).
--     The sequence ends (NO CYCLE) at the last code: a clear error, not a repeat.
CREATE SEQUENCE IF NOT EXISTS public.payment_order_code_seq AS bigint MINVALUE 0 MAXVALUE 28629150 START WITH 0 NO CYCLE;

CREATE OR REPLACE FUNCTION public.next_payment_order_code() RETURNS text
    LANGUAGE plpgsql
    VOLATILE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
    code_space constant bigint := 28629151;
    drawn bigint;
    spread bigint;
    code text;
    slot integer;
BEGIN
    LOOP
        drawn := nextval('public.payment_order_code_seq');
        spread := (drawn * 15485863 + 7919) % code_space;
        code := 'NIVO';
        FOR slot IN 1..5 LOOP
            code := code || substr(alphabet, (spread % 31)::integer + 1, 1);
            spread := spread / 31;
        END LOOP;
        EXIT WHEN NOT EXISTS (SELECT 1 FROM public.payment_orders AS o WHERE o.order_code = code);
    END LOOP;
    RETURN code;
END
$$;

REVOKE ALL ON FUNCTION public.next_payment_order_code() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_payment_order_code() TO app_be;
