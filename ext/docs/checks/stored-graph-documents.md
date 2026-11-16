---
check: stored-graph-documents
concept:
  - .starciwork/concepts/templates.md
---

# Project check `stored-graph-documents`

Program `ext/checks/stored-graph-documents.mjs`: no arguments, no build, no database, exit 0 is green. Run by the `checks` step of `starci app check`
(`HFS_PROJECT_CHECK_FAILED` when red) and by `npm run ext:check`. Its decision is the pure function `storedDocumentFindings` of
`ext/support/stored-graph-documents-rules.mjs`; its spec is `ext/tests/stored-graph-documents.spec.mjs`.

## The law

A wait KEY lists its verbs ([templates](../../../.starciwork/concepts/templates.md) rule 12) and the engine reads only `params.on[].verbs`, so every
STORED graph document holds its waits in that shape. A graph document is stored in more than one place, with its flow nodes at a different path in
each; a migration that rewrites stored waits must reach every place, at its own path. The list is ONE constant, `STORED_GRAPH_DOCUMENTS`:

| table.column | nodes path |
|---|---|
| `agent_workflow_versions.document` | `{nodes}` (the document is the flow) |
| `agent_graph_versions.document` | `{flow,nodes}` (the top-level `nodes` are the agent's own) |
| `agent_graphs.draft` | `{flow,nodes}` (the editor's draft, frozen into a version on publish) |

Findings:

- `STORED_DOCUMENT_UNDECLARED`: an entity declares a jsonb column named `document` or `draft` the list does not hold (a new place a stored wait
  could hide in), or the list names a column no entity has.
- `STORED_DOCUMENT_UNCONVERTED`: no migration from `20261115000400` on (one that names `core.wait` and `verbs`) rewrites the place at its path.
- `STORED_DOCUMENT_WRONG_PATH`: a migration from `20261115000403` on rewrites a place at another path than the place's. (`000400` is applied and
  never edited: it read `agent_graph_versions` at `{nodes}`, which `000403` repaired; the check judges `000400` only for the place it did right.)

A wait PARK in a checkpoint (`WaitPark.on[].key / .verb`) is the park's own, already resolved shape and is not a stored graph document.

## Why

Migration `000400` converted `agent_workflow_versions` and read `agent_graph_versions` at the workflow path: four graph versions (the NIVO
workspace's active sales graph among them) kept `verb` and a run on them stopped `GRAPH_WAIT_UNREADABLE`. Nothing checked that every stored place
was reached. The conversion's idempotence and its zero-remaining verification query are proven on a throwaway database when it is written.

## Concept

[templates](../../../.starciwork/concepts/templates.md) rule 12 · [fixing](../../../.starciwork/concepts/fixing.md) rule 9 (add the gate).
