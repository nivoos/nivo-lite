-- model-provider: forward-only; immutable once on origin/main. WRITTEN, NOT APPLIED by AI-SBX (source only): the restart owner applies it.
-- The model endpoint is a provider with an ACCOUNT (lane concept provider-sandbox, the model row; R87 lever b): a workspace may open a
-- SANDBOX model account (provider key `model`, sandbox = true, no secret) on the Sandbox page; the live account is the deployment's own
-- endpoint and has no row. public.connections_provider_check lists the provider keys literally; it is replaced by the same list plus `model`.
-- Data: none; no existing row changes (every stored key is in the new list). NOT VALID is not needed: the new list is a superset.
-- ORDER: safe on either build (a superset); the build that opens a `model` account needs it AND the connections `Provider` union with `model`.
ALTER TABLE public.connections DROP CONSTRAINT connections_provider_check;
ALTER TABLE public.connections ADD CONSTRAINT connections_provider_check CHECK (provider = ANY (ARRAY['telegram'::text, 'sepay'::text, 'zalo_oa'::text, 'payos'::text, 'casso'::text, 'webhook'::text, 'google'::text, 'smtp'::text, 'openapi'::text, 'database'::text, 'csv_import'::text, 'imap'::text, 'telegram_user'::text, 'google_drive'::text, 'meta'::text, 'inet'::text, 'tino'::text, 'elevenlabs'::text, 'veo'::text, 'misa_amis'::text, 'misa_meinvoice'::text, 'tiktok'::text, 'shotstack'::text, 'creatomate'::text, 'json2video'::text, 'model'::text]));
