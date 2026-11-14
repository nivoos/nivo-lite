#!/usr/bin/env node
// ext/manifest.json check `cells-isolation` (doc ext/docs/checks/cells-isolation.md): the four isolation gates of the cells capability
// (CELLS-PLAN 7.2). A: what `be/src/modules/domain/cells` imports. B: who imports it. C: no code evaluation in the repository. D: the isolated
// runner is the only evaluator, and the authoring package stands apart from `be`. No build and no argument for the harness; `--root <dir>` points
// the same check at another tree (its own spec plants violations there), reading the files by walking it instead of asking git.
// One line per finding `file:line  gate what`, then the count; exit 1 on any finding.
import { spawnSync } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { cellsIsolationFindings, countsByGate, findingLine } from "../support/cells-isolation-rules.mjs"
import { ROOT } from "../support/program.mjs"

const SCOPE = ["be", "fe", "packages"]
const rootFlag = process.argv.indexOf("--root")
const root = rootFlag === -1 ? ROOT : resolve(process.argv[rootFlag + 1])

const gitList = (args) =>
    spawnSync("git", ["ls-files", "-z", ...args, "--", ...SCOPE], { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
        .stdout.split("\0")
        .filter((file) => file !== "")
const SKIPPED_FOLDERS = new Set(["node_modules", ".git", "dist", ".next", "coverage"])
const walk = (folder) =>
    readdirSync(resolve(root, folder), { withFileTypes: true }).flatMap((entry) => {
        const path = `${folder}/${entry.name}`
        if (entry.isDirectory()) return SKIPPED_FOLDERS.has(entry.name) ? [] : walk(path)
        return [path]
    })
const walked = () =>
    SCOPE.flatMap((folder) => {
        try {
            return walk(folder)
        } catch {
            return []
        }
    })

// Tracked files and the untracked ones git does not ignore (a lane is uncommitted); a file git lists but that is gone is skipped.
const files =
    rootFlag === -1 ? [...new Set([...gitList([]), ...gitList(["--others", "--exclude-standard"])])].sort() : walked().sort()

const findings = files.flatMap((file) => {
    let text
    try {
        text = readFileSync(resolve(root, file), "utf8")
    } catch {
        return []
    }
    return cellsIsolationFindings(file, text)
})

for (const found of findings) console.error(findingLine(found))
const counts = countsByGate(findings)
console.log(
    `cells isolation: ${findings.length} finding(s) in ${files.length} files (A ${counts.A}, B ${counts.B}, C ${counts.C}, D ${counts.D})`,
)
process.exit(findings.length > 0 ? 1 : 0)
