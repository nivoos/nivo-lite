-- wait-keys-list-verbs-graph-documents: forward-only; immutable once on origin/main. Written by MIG-FIX (RESTART-R9 follow-up).
-- `20261115000400_wait-keys-list-verbs.sql` (applied, never edited) moved each `core.wait` key `{ key, verb }` to `{ key, verbs: [verb] }`
-- (concept `templates.md` rule 12) but read the nodes of the stored documents at `document -> 'nodes'`. That path is right for
-- `agent_workflow_versions.document` (the document IS the flow) and wrong for `agent_graph_versions.document` and `agent_graphs.draft`,
-- whose flow lives at `document -> 'flow' -> 'nodes'` (their top-level `nodes` are the agent's own nodes, never waits): on dev four graph
-- versions and one draft kept `verb`, and a run on them stops `GRAPH_WAIT_UNREADABLE` at its wait (the NIVO workspace's active sales graph
-- among them). The engine reads only `verbs` (no legacy reader), so the stored documents must all be in the one shape.
--
-- THE PLACES A STORED WAIT LIVES (the list the project check `stored-graph-documents` (ext/checks) keeps equal to the entities and to the migrations):
--   public.agent_workflow_versions.document   nodes at {nodes}        (000400 did this one; repeated here, idempotent)
--   public.agent_graph_versions.document      nodes at {flow,nodes}
--   public.agent_graphs.draft                 nodes at {flow,nodes}   (the editor's draft; publishing freezes it into a version)
-- NOT converted, on purpose: a wait PARK in a checkpoint (`agent_checkpoints` / `agent_checkpoint_blobs` / `agent_checkpoint_writes`:
-- `WaitPark.on[].key / .verb` is the park's own, already-resolved shape, read by the park reader, not the graph document), and stop details
-- / chat refs that only name a wait step.
--
-- Idempotent: an entry that has no `verb` is left as it is; an entry holding both `verb` and `verbs` keeps its list and gains the verb once.
-- A version's `document_hash` is NOT recomputed (it names the template document the version was made from, never read back against the
-- stored document; see 000400). Plain statements, no DO block (the harness reads every statement of a migration). Verification query,
-- run by MIG-FIX on a throwaway database (the check reads the files, never a database):
--   SELECT count(*) FROM <table>, jsonb_array_elements(<column> #> <nodes path>) n, jsonb_array_elements(n -> 'params' -> 'on') o
--   WHERE n ->> 'step' = 'core.wait' AND jsonb_typeof(o) = 'object' AND o ? 'verb'   -- must be 0 for every place above
-- Expected rows on dev: 4 graph versions + 1 draft (the workflow versions are already converted).
-- complete: apply.
UPDATE public.agent_workflow_versions AS t
SET document = jsonb_set(
    t.document,
    '{nodes}',
    (
        SELECT jsonb_agg(
            CASE
                WHEN n ->> 'step' = 'core.wait' AND jsonb_typeof(n -> 'params' -> 'on') = 'array' THEN jsonb_set(
                    n,
                    '{params,on}',
                    (
                        SELECT jsonb_agg(
                            CASE
                                WHEN jsonb_typeof(o) = 'object' AND o ? 'verb' THEN (o - 'verb') || jsonb_build_object(
                                    'verbs',
                                    CASE
                                        WHEN jsonb_typeof(o -> 'verbs') = 'array' AND o -> 'verbs' @> jsonb_build_array(o -> 'verb') THEN o -> 'verbs'
                                        WHEN jsonb_typeof(o -> 'verbs') = 'array' THEN (o -> 'verbs') || jsonb_build_array(o -> 'verb')
                                        ELSE jsonb_build_array(o -> 'verb')
                                    END
                                )
                                ELSE o
                            END
                            ORDER BY oi
                        )
                        FROM jsonb_array_elements(n -> 'params' -> 'on') WITH ORDINALITY AS e (o, oi)
                    )
                )
                ELSE n
            END
            ORDER BY ni
        )
        FROM jsonb_array_elements(t.document #> '{nodes}') WITH ORDINALITY AS x (n, ni)
    )
)
WHERE jsonb_typeof(t.document #> '{nodes}') = 'array'
  AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(t.document #> '{nodes}') AS n
      WHERE n ->> 'step' = 'core.wait'
        AND jsonb_typeof(n -> 'params' -> 'on') = 'array'
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(n -> 'params' -> 'on') AS o WHERE jsonb_typeof(o) = 'object' AND o ? 'verb')
  );

UPDATE public.agent_graph_versions AS t
SET document = jsonb_set(
    t.document,
    '{flow,nodes}',
    (
        SELECT jsonb_agg(
            CASE
                WHEN n ->> 'step' = 'core.wait' AND jsonb_typeof(n -> 'params' -> 'on') = 'array' THEN jsonb_set(
                    n,
                    '{params,on}',
                    (
                        SELECT jsonb_agg(
                            CASE
                                WHEN jsonb_typeof(o) = 'object' AND o ? 'verb' THEN (o - 'verb') || jsonb_build_object(
                                    'verbs',
                                    CASE
                                        WHEN jsonb_typeof(o -> 'verbs') = 'array' AND o -> 'verbs' @> jsonb_build_array(o -> 'verb') THEN o -> 'verbs'
                                        WHEN jsonb_typeof(o -> 'verbs') = 'array' THEN (o -> 'verbs') || jsonb_build_array(o -> 'verb')
                                        ELSE jsonb_build_array(o -> 'verb')
                                    END
                                )
                                ELSE o
                            END
                            ORDER BY oi
                        )
                        FROM jsonb_array_elements(n -> 'params' -> 'on') WITH ORDINALITY AS e (o, oi)
                    )
                )
                ELSE n
            END
            ORDER BY ni
        )
        FROM jsonb_array_elements(t.document #> '{flow,nodes}') WITH ORDINALITY AS x (n, ni)
    )
)
WHERE jsonb_typeof(t.document #> '{flow,nodes}') = 'array'
  AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(t.document #> '{flow,nodes}') AS n
      WHERE n ->> 'step' = 'core.wait'
        AND jsonb_typeof(n -> 'params' -> 'on') = 'array'
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(n -> 'params' -> 'on') AS o WHERE jsonb_typeof(o) = 'object' AND o ? 'verb')
  );

UPDATE public.agent_graphs AS t
SET draft = jsonb_set(
    t.draft,
    '{flow,nodes}',
    (
        SELECT jsonb_agg(
            CASE
                WHEN n ->> 'step' = 'core.wait' AND jsonb_typeof(n -> 'params' -> 'on') = 'array' THEN jsonb_set(
                    n,
                    '{params,on}',
                    (
                        SELECT jsonb_agg(
                            CASE
                                WHEN jsonb_typeof(o) = 'object' AND o ? 'verb' THEN (o - 'verb') || jsonb_build_object(
                                    'verbs',
                                    CASE
                                        WHEN jsonb_typeof(o -> 'verbs') = 'array' AND o -> 'verbs' @> jsonb_build_array(o -> 'verb') THEN o -> 'verbs'
                                        WHEN jsonb_typeof(o -> 'verbs') = 'array' THEN (o -> 'verbs') || jsonb_build_array(o -> 'verb')
                                        ELSE jsonb_build_array(o -> 'verb')
                                    END
                                )
                                ELSE o
                            END
                            ORDER BY oi
                        )
                        FROM jsonb_array_elements(n -> 'params' -> 'on') WITH ORDINALITY AS e (o, oi)
                    )
                )
                ELSE n
            END
            ORDER BY ni
        )
        FROM jsonb_array_elements(t.draft #> '{flow,nodes}') WITH ORDINALITY AS x (n, ni)
    )
)
WHERE jsonb_typeof(t.draft #> '{flow,nodes}') = 'array'
  AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(t.draft #> '{flow,nodes}') AS n
      WHERE n ->> 'step' = 'core.wait'
        AND jsonb_typeof(n -> 'params' -> 'on') = 'array'
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(n -> 'params' -> 'on') AS o WHERE jsonb_typeof(o) = 'object' AND o ? 'verb')
  );
