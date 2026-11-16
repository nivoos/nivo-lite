// The decision of the project check `stored-graph-documents` (ext/checks/stored-graph-documents.mjs, doc ext/docs/checks/stored-graph-documents.md),
// pure: no file, no database. Concept `.starciwork/concepts/templates.md` rule 12: a wait KEY lists its verbs, and the engine reads only
// `params.on[].verbs`, so every STORED graph document must hold its waits in that shape. A migration that rewrites stored waits must reach every
// place a graph document is stored, at the path its nodes really live under (migration 000400 read `agent_graph_versions` at the wrong path).

/** The migration that moved the stored waits to `verbs` (applied, never edited), and the one that repaired its missed place. */
export const WAIT_MIGRATION_FIRST = "20261115000400"
export const WAIT_MIGRATION_REPAIR = "20261115000403"

/**
 * Every place a stored graph document lives, and the path of its flow nodes inside the column (the list a new such column must join, with a
 * migration that converts it): a frozen workflow version IS the flow (`{nodes}`); a frozen graph version and the editor's draft hold the
 * flow under `flow` (their own top-level `nodes` are the agent's nodes, never waits).
 */
export const STORED_GRAPH_DOCUMENTS = [
    { table: "agent_workflow_versions", column: "document", nodes: "nodes" },
    { table: "agent_graph_versions", column: "document", nodes: "flow,nodes" },
    { table: "agent_graphs", column: "draft", nodes: "flow,nodes" },
]

/** The names a column holding a graph document has in an entity (`document`: a frozen version, `draft`: the editor's copy). */
const GRAPH_DOCUMENT_COLUMN = /^(document|draft)$/u

/** `table.column` of every jsonb column named like a graph document in the given entity sources `[{ file, text }]`, sorted. */
export const entityGraphDocumentColumns = (entities) =>
    entities
        .flatMap(({ text }) => {
            const table = /@Entity\(\{[^}]*name:\s*"([^"]+)"/u.exec(text)?.[1]
            if (table === undefined) return []
            return [...text.matchAll(/@Column\(\{\s*name:\s*"([^"]+)",\s*type:\s*"jsonb"/gu)]
                .map((match) => match[1])
                .filter((column) => GRAPH_DOCUMENT_COLUMN.test(column))
                .map((column) => `${table}.${column}`)
        })
        .sort()

/** The migrations from the wait-shape change on that convert waits (they name `core.wait` and `verbs`): `[{ file, text }]`, in order. */
export const waitMigrationsOf = (migrations) =>
    [...migrations]
        .filter(({ file }) => file >= WAIT_MIGRATION_FIRST)
        .sort((a, b) => a.file.localeCompare(b.file))
        .filter(({ text }) => text.includes("'core.wait'") && text.includes("'verbs'"))

const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")

/** The nodes paths a migration rewrites for one place: every `UPDATE public.<table> AS <a> SET <column> = jsonb_set(<a>.<column>, '<path>'`. */
const updatedPaths = (text, { table, column }) =>
    [
        ...text.matchAll(
            new RegExp(
                `UPDATE public\\.${escaped(table)} AS \\w+\\s+SET ${escaped(column)} = jsonb_set\\(\\s+\\w+\\.${escaped(column)},\\s+'\\{([^']*)\\}'`,
                "gu",
            ),
        ),
    ].map((match) => match[1])

/**
 * The findings, `{ code, place, file?, detail }`:
 * - `STORED_DOCUMENT_UNDECLARED`: an entity holds a jsonb graph-document column the list does not (or the list names one no entity has);
 * - `STORED_DOCUMENT_UNCONVERTED`: no migration after the wait-shape change converts the place at its nodes path;
 * - `STORED_DOCUMENT_WRONG_PATH`: a migration from the repair on rewrites a place at another path than the place's.
 */
export const storedDocumentFindings = ({ declared = STORED_GRAPH_DOCUMENTS, entityColumns, migrations }) => {
    const findings = []
    const declaredNames = declared.map((place) => `${place.table}.${place.column}`).sort()
    for (const name of entityColumns)
        if (!declaredNames.includes(name))
            findings.push({
                code: "STORED_DOCUMENT_UNDECLARED",
                place: name,
                detail: "an entity holds a graph document here; add it to STORED_GRAPH_DOCUMENTS with a migration that converts its waits",
            })
    for (const name of declaredNames)
        if (!entityColumns.includes(name))
            findings.push({ code: "STORED_DOCUMENT_UNDECLARED", place: name, detail: "no entity has this jsonb column any more; remove it from STORED_GRAPH_DOCUMENTS" })
    const waitMigrations = waitMigrationsOf(migrations)
    for (const place of declared) {
        const name = `${place.table}.${place.column}`
        const converts = waitMigrations.some(({ text }) => updatedPaths(text, place).includes(place.nodes))
        if (!converts)
            findings.push({
                code: "STORED_DOCUMENT_UNCONVERTED",
                place: name,
                detail: `no migration from ${WAIT_MIGRATION_FIRST} rewrites its waits at {${place.nodes}}`,
            })
        for (const { file, text } of waitMigrations.filter((migration) => migration.file >= WAIT_MIGRATION_REPAIR))
            for (const path of updatedPaths(text, place))
                if (path !== place.nodes)
                    findings.push({
                        code: "STORED_DOCUMENT_WRONG_PATH",
                        place: name,
                        file,
                        detail: `rewrites its waits at {${path}}, its nodes live at {${place.nodes}}`,
                    })
    }
    return findings
}

/** One line per finding, in a fixed order. */
export const findingLines = (findings) =>
    [...findings]
        .sort((a, b) => [a.code, a.place, a.file ?? ""].join("\0").localeCompare([b.code, b.place, b.file ?? ""].join("\0")))
        .map((one) => `${one.code}  ${one.place}${one.file === undefined ? "" : `  ${one.file}`}  ${one.detail}`)
