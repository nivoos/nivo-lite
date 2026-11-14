-- cells-definitions: forward-only; immutable once on origin/main. WRITTEN, NOT APPLIED to any stack database (CELLS-PLAN 1.4, 2.1).
-- cells.definitions holds EVERY kind of cell in one table (one base shape, one immutability rule, one reader, one cache); what differs per kind is the `body`
-- jsonb, validated at seed time by the kind's JSON Schema (code, not here). A version is a row: UNIQUE (kind, key, version). Once `approved` the row is frozen
-- except review_state -> retired and deleted_at (cells.refuse_published_change); a change is a new row with version + 1. Soft delete only.
-- Needs 20261115100100_cells-packages-sources.sql.
CREATE TABLE IF NOT EXISTS cells.definitions (
    id               uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    package_id       uuid NOT NULL REFERENCES cells.packages (id),
    kind             varchar NOT NULL,
    key              text NOT NULL,
    version          integer NOT NULL,
    title            jsonb NOT NULL,
    input_schema     jsonb NOT NULL,
    output_schema    jsonb NOT NULL,
    config_schema    jsonb NOT NULL,
    semantics        jsonb NOT NULL,
    body             jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_id        uuid,
    source_sha256    varchar,
    examples         jsonb DEFAULT '[]'::jsonb NOT NULL,
    definition_hash  varchar NOT NULL,
    review_state     varchar DEFAULT 'draft' NOT NULL,
    review_ref       text,
    published_at     timestamptz,
    deleted_at       timestamptz,
    created_at       timestamptz DEFAULT now() NOT NULL,
    updated_at       timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT definitions_kind_key_version_unique UNIQUE (kind, key, version),
    CONSTRAINT definitions_kind_check CHECK (kind IN ('operation', 'tool', 'node', 'trigger', 'provider',
        'core.if', 'core.loop', 'core.wait', 'core.hand-back', 'core.call-workflow', 'core.outcome', 'core.set')),
    CONSTRAINT definitions_key_check CHECK (char_length(key) BETWEEN 1 AND 200),
    CONSTRAINT definitions_version_check CHECK (version >= 1),
    CONSTRAINT definitions_review_state_check CHECK (review_state IN ('draft', 'approved', 'retired')),
    -- A draft is not published; an approved or retired row was.
    CONSTRAINT definitions_published_at_check CHECK ((review_state = 'draft') = (published_at IS NULL)),
    CONSTRAINT definitions_hash_check CHECK (definition_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT definitions_source_pair_check CHECK ((source_id IS NULL) = (source_sha256 IS NULL)),
    CONSTRAINT definitions_source_fk FOREIGN KEY (source_id, source_sha256) REFERENCES cells.sources (id, sha256),
    CONSTRAINT definitions_json_shape_check CHECK (jsonb_typeof(title) = 'object' AND jsonb_typeof(semantics) = 'object'
        AND jsonb_typeof(body) = 'object' AND jsonb_typeof(examples) = 'array')
);
-- Listings (authoring, pages): one kind, in key order.
CREATE INDEX IF NOT EXISTS definitions_kind_key ON cells.definitions USING btree (kind, key);
CREATE INDEX IF NOT EXISTS definitions_package ON cells.definitions USING btree (package_id);

CREATE TRIGGER definitions_set_updated_at BEFORE UPDATE ON cells.definitions
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER definitions_refuse_published_change BEFORE UPDATE ON cells.definitions
    FOR EACH ROW EXECUTE FUNCTION cells.refuse_published_change('deleted_at', 'updated_at');
CREATE TRIGGER definitions_refuse_delete BEFORE DELETE ON cells.definitions
    FOR EACH ROW EXECUTE FUNCTION cells.refuse_delete();
CREATE TRIGGER definitions_refuse_truncate BEFORE TRUNCATE ON cells.definitions
    FOR EACH STATEMENT EXECUTE FUNCTION cells.refuse_delete();
GRANT SELECT, INSERT, UPDATE ON TABLE cells.definitions TO app_be;
