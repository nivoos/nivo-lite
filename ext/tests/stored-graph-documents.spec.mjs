// The decision of the project check `stored-graph-documents` (ext/support/stored-graph-documents-rules.mjs) on fixtures.
import { strict as assert } from "node:assert"
import { test } from "node:test"
import { STORED_GRAPH_DOCUMENTS, entityGraphDocumentColumns, findingLines, storedDocumentFindings } from "../support/stored-graph-documents-rules.mjs"

const update = (table, column, path) =>
    `UPDATE public.${table} AS t\nSET ${column} = jsonb_set(\n    t.${column},\n    '{${path}}',\n    (SELECT 1)\n) -- 'core.wait' 'verbs'`
const migration = (file, ...updates) => ({ file, text: updates.join("\n") })
const ALL = STORED_GRAPH_DOCUMENTS.map((place) => `${place.table}.${place.column}`).sort()
const entity = (table, ...columns) => ({
    file: `${table}.entity.ts`,
    text: `@Entity({ schema: "public", name: "${table}" })\nclass X {\n${columns.map((c) => `  @Column({ name: "${c}", type: "jsonb" })\n  ${c}!: object`).join("\n")}\n}`,
})
const first = migration("20261115000400_a.sql", update("agent_workflow_versions", "document", "nodes"), update("agent_graph_versions", "document", "nodes"))
const repair = migration(
    "20261115000403_b.sql",
    update("agent_workflow_versions", "document", "nodes"),
    update("agent_graph_versions", "document", "flow,nodes"),
    update("agent_graphs", "draft", "flow,nodes"),
)
const named = (findings) => findings.map((one) => `${one.code} ${one.place}`).sort()

test("the jsonb document and draft columns of the entities are read, any other column is not", () => {
    assert.deepEqual(
        entityGraphDocumentColumns([entity("agent_graphs", "draft", "other"), entity("agent_graph_versions", "document"), { file: "x.entity.ts", text: "no entity" }]),
        ["agent_graph_versions.document", "agent_graphs.draft"],
    )
})

test("every place converted at its own path: no finding", () => {
    assert.deepEqual(storedDocumentFindings({ entityColumns: ALL, migrations: [first, repair] }), [])
})

test("the missed places of 000400 alone are unconverted (graph versions read at {nodes}, the draft not at all)", () => {
    assert.deepEqual(named(storedDocumentFindings({ entityColumns: ALL, migrations: [first] })), [
        "STORED_DOCUMENT_UNCONVERTED agent_graph_versions.document",
        "STORED_DOCUMENT_UNCONVERTED agent_graphs.draft",
    ])
})

test("a conversion from the repair on at another path than the place's is a finding", () => {
    const wrong = migration(
        "20261115000403_b.sql",
        update("agent_workflow_versions", "document", "nodes"),
        update("agent_graph_versions", "document", "flow,nodes"),
        update("agent_graphs", "draft", "nodes"),
    )
    assert.deepEqual(named(storedDocumentFindings({ entityColumns: ALL, migrations: [first, wrong] })), [
        "STORED_DOCUMENT_UNCONVERTED agent_graphs.draft",
        "STORED_DOCUMENT_WRONG_PATH agent_graphs.draft",
    ])
})

test("a new jsonb document column no list names is a finding, and so is a listed place no entity has", () => {
    assert.deepEqual(named(storedDocumentFindings({ entityColumns: [...ALL, "agent_templates.document"].sort(), migrations: [first, repair] })), [
        "STORED_DOCUMENT_UNDECLARED agent_templates.document",
    ])
    assert.deepEqual(named(storedDocumentFindings({ entityColumns: ALL.filter((name) => name !== "agent_graphs.draft"), migrations: [first, repair] })), [
        "STORED_DOCUMENT_UNDECLARED agent_graphs.draft",
    ])
})

test("findings print in a fixed order, one line each", () => {
    assert.deepEqual(
        findingLines([
            { code: "B", place: "t.c", detail: "d" },
            { code: "A", place: "t.c", file: "f.sql", detail: "d" },
        ]),
        ["A  t.c  f.sql  d", "B  t.c  d"],
    )
})
