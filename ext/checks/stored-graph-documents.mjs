#!/usr/bin/env node
// ext/manifest.json check `stored-graph-documents` (doc ext/docs/checks/stored-graph-documents.md): every place a graph document is stored
// (the jsonb `document` / `draft` columns of the entities) is declared, and a migration after the wait-shape change converts its waits at the
// path its nodes live under. No build, no database, no arguments; one line per finding, then the count; exit 1 on any finding.
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { ROOT } from "../support/program.mjs"
import { entityGraphDocumentColumns, findingLines, storedDocumentFindings } from "../support/stored-graph-documents-rules.mjs"

const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        if (entry.isDirectory()) return entry.name === "node_modules" || entry.name === "dist" ? [] : walk(join(dir, entry.name))
        return entry.name.endsWith(".entity.ts") ? [join(dir, entry.name)] : []
    })
const entities = walk(join(ROOT, "be/src")).map((file) => ({ file, text: readFileSync(file, "utf8") }))
const migrationsDir = join(ROOT, "db/migrations")
const migrations = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => ({ file, text: readFileSync(join(migrationsDir, file), "utf8") }))

const findings = storedDocumentFindings({ entityColumns: entityGraphDocumentColumns(entities), migrations })
for (const line of findingLines(findings)) console.error(line)
console.log(`stored graph documents: ${findings.length} finding(s) in ${entities.length} entities and ${migrations.length} migrations`)
process.exit(findings.length > 0 ? 1 : 0)
