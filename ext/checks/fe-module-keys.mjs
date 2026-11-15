#!/usr/bin/env node
// ext/manifest.json check `fe-module-keys` (doc ext/docs/checks/fe-module-keys.md): the front end holds no package's module or agent key.
// The keys come from the installed plugins (the generated plugin registry's `installed`), never from a list here; every fe source file
// (`fe/apps/web/src`, `fe/packages/*/src`, not specs, fixtures or generated files) is read with the TypeScript AST and a literal that names
// one of them where code names a type is a finding. It BUILDS FIRST (`npm run build:modules`, turbo-cached): the keys are read from the
// built registry. One line per finding `file:line  "key"  role`, then the count; exit 1 on any finding.
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join, resolve } from "node:path"
import { findingLine, isFeSource, keysOfInstallation, moduleKeyFindings } from "../support/fe-module-keys-rules.mjs"
import { ROOT, buildModules } from "../support/program.mjs"

const built = buildModules()
if (built !== 0) {
    console.error("fe module keys: the packages do not build, so the installed keys cannot be read (see the build output above)")
    process.exit(built)
}

const require = createRequire(join(ROOT, "package.json"))
const keys = keysOfInstallation(require("@nivo-lite/plugin-registry").installed)
if (keys.size === 0) {
    console.error("fe module keys: the installation declares no module, so nothing can be checked")
    process.exit(1)
}

const gitList = (args) =>
    spawnSync("git", ["ls-files", "-z", ...args, "--", "fe"], { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
        .stdout.split("\0")
        .filter((file) => file !== "")
// Tracked files and the untracked ones git does not ignore (a lane is uncommitted); a file git lists but that is gone is skipped.
const files = [...new Set([...gitList([]), ...gitList(["--others", "--exclude-standard"])])].filter(isFeSource).sort()

const findings = files.flatMap((file) => {
    let text
    try {
        text = readFileSync(resolve(ROOT, file), "utf8")
    } catch {
        return []
    }
    return moduleKeyFindings(file, text, keys)
})

for (const finding of findings) console.error(findingLine(finding))
console.log(`fe module keys: ${findings.length} finding(s) in ${files.length} files (${keys.size} keys of the installed plugins)`)
process.exit(findings.length > 0 ? 1 : 0)
