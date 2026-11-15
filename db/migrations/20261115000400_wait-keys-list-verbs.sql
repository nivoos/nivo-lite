-- wait-keys-list-verbs: forward-only; immutable once on origin/main. WRITTEN, NOT APPLIED by S7-WAIT (source only): the restart owner
-- applies it with the build (R110: one build), after 20261115000300_stream-cursors.sql. Concept `.starciwork/concepts/templates.md` rule 12
-- (decided 2026-11-15): a wait KEY is ONE meaning listing the verbs that bring it. The stored graph documents move to that shape: in every
-- `core.wait` step of a stored version, each `params.on[]` entry `{ key, verb, ... }` becomes `{ key, verbs: [verb], ... }` (the same
-- meaning, one verb; no member renamed or dropped otherwise). The engine reads only `verbs` (no legacy reader): without this file a run
-- pinned to a version written before (the five runs parked before R9 on consult v30 / front-desk v27 among them) stops `WAIT_UNREADABLE`
-- when its wait is visited again, and its agent no longer hears the verbs those waits list (`waitVerbsOf`). A version's `document_hash`
-- is NOT recomputed: it names the template document the version was made from (compared with a template's own hash), never read back
-- against the stored document. Code without this file: old versions' waits unreadable (above). This file without the code: the old
-- reader finds no `verb` and the same stop happens, so they ship together. Idempotent: an entry that has no `verb` is left as it is.
-- Expected rows: every stored version (workflow and agent graph) that holds a wait.
-- complete: apply.
UPDATE public.agent_workflow_versions AS v
SET document = jsonb_set(
    v.document,
    '{nodes}',
    (
        SELECT jsonb_agg(
            CASE
                WHEN n ->> 'step' = 'core.wait' AND jsonb_typeof(n -> 'params' -> 'on') = 'array' THEN jsonb_set(
                    n,
                    '{params,on}',
                    (
                        SELECT jsonb_agg(
                            CASE WHEN o ? 'verb' THEN (o - 'verb') || jsonb_build_object('verbs', jsonb_build_array(o -> 'verb')) ELSE o END
                            ORDER BY oi
                        )
                        FROM jsonb_array_elements(n -> 'params' -> 'on') WITH ORDINALITY AS e (o, oi)
                    )
                )
                ELSE n
            END
            ORDER BY ni
        )
        FROM jsonb_array_elements(v.document -> 'nodes') WITH ORDINALITY AS x (n, ni)
    )
)
WHERE jsonb_typeof(v.document -> 'nodes') = 'array'
  AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v.document -> 'nodes') AS n
      WHERE n ->> 'step' = 'core.wait'
        AND jsonb_typeof(n -> 'params' -> 'on') = 'array'
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(n -> 'params' -> 'on') AS o WHERE o ? 'verb')
  );

UPDATE public.agent_graph_versions AS v
SET document = jsonb_set(
    v.document,
    '{nodes}',
    (
        SELECT jsonb_agg(
            CASE
                WHEN n ->> 'step' = 'core.wait' AND jsonb_typeof(n -> 'params' -> 'on') = 'array' THEN jsonb_set(
                    n,
                    '{params,on}',
                    (
                        SELECT jsonb_agg(
                            CASE WHEN o ? 'verb' THEN (o - 'verb') || jsonb_build_object('verbs', jsonb_build_array(o -> 'verb')) ELSE o END
                            ORDER BY oi
                        )
                        FROM jsonb_array_elements(n -> 'params' -> 'on') WITH ORDINALITY AS e (o, oi)
                    )
                )
                ELSE n
            END
            ORDER BY ni
        )
        FROM jsonb_array_elements(v.document -> 'nodes') WITH ORDINALITY AS x (n, ni)
    )
)
WHERE jsonb_typeof(v.document -> 'nodes') = 'array'
  AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v.document -> 'nodes') AS n
      WHERE n ->> 'step' = 'core.wait'
        AND jsonb_typeof(n -> 'params' -> 'on') = 'array'
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(n -> 'params' -> 'on') AS o WHERE o ? 'verb')
  );
