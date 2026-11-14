-- cells-graphs: forward-only; immutable once on origin/main. WRITTEN, NOT APPLIED to any stack database (CELLS-PLAN 2.1, CELLS-DECISIONS D1).
-- cells.graphs: what V1 calls a template graph version. `document` is V1's stored GraphSpec shape with every node step naming an EXACT cell version, and it
-- carries the graph's `vars` declaration (workflow variables with a JSON Schema each, D1); `triggers` is the document's trigger list, kept as its own column
-- for the trigger registry to read. A run pins ONE graph row, so it pins every cell it names transitively. UNIQUE (key, version); frozen once approved
-- like cells.definitions (same trigger function); soft delete only.
-- Needs 20261115100100_cells-packages-sources.sql.
CREATE TABLE IF NOT EXISTS cells.graphs (
    id             uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    package_id     uuid NOT NULL REFERENCES cells.packages (id),
    key            text NOT NULL,
    version        integer NOT NULL,
    document       jsonb NOT NULL,
    triggers       jsonb DEFAULT '[]'::jsonb NOT NULL,
    document_hash  varchar NOT NULL,
    review_state   varchar DEFAULT 'draft' NOT NULL,
    review_ref     text,
    published_at   timestamptz,
    deleted_at     timestamptz,
    created_at     timestamptz DEFAULT now() NOT NULL,
    updated_at     timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT graphs_key_version_unique UNIQUE (key, version),
    CONSTRAINT graphs_key_check CHECK (char_length(key) BETWEEN 1 AND 200),
    CONSTRAINT graphs_version_check CHECK (version >= 1),
    CONSTRAINT graphs_review_state_check CHECK (review_state IN ('draft', 'approved', 'retired')),
    CONSTRAINT graphs_published_at_check CHECK ((review_state = 'draft') = (published_at IS NULL)),
    CONSTRAINT graphs_hash_check CHECK (document_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT graphs_json_shape_check CHECK (jsonb_typeof(document) = 'object' AND jsonb_typeof(triggers) = 'array')
);
CREATE INDEX IF NOT EXISTS graphs_package ON cells.graphs USING btree (package_id);

CREATE TRIGGER graphs_set_updated_at BEFORE UPDATE ON cells.graphs
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER graphs_refuse_published_change BEFORE UPDATE ON cells.graphs
    FOR EACH ROW EXECUTE FUNCTION cells.refuse_published_change('deleted_at', 'updated_at');
CREATE TRIGGER graphs_refuse_delete BEFORE DELETE ON cells.graphs
    FOR EACH ROW EXECUTE FUNCTION cells.refuse_delete();
CREATE TRIGGER graphs_refuse_truncate BEFORE TRUNCATE ON cells.graphs
    FOR EACH STATEMENT EXECUTE FUNCTION cells.refuse_delete();
GRANT SELECT, INSERT, UPDATE ON TABLE cells.graphs TO app_be;
