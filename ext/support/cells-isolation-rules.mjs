// The decision of the project check `cells-isolation` (ext/checks/cells-isolation.mjs), pure: a file's repo-relative path and its text in, the
// findings out. The four gates are CELLS-PLAN 7.2 (A to D). No file, no build, no package loaded. This file is no check: it lives in
// ext/support/ because the harness's R103 refuses a file of ext/checks/ that ext/manifest.json `checks` does not declare. Concept:
// .starciwork/concepts/layers.md (the engine holds no business), doc ext/docs/checks/cells-isolation.md.
//
// Imports and calls are read with the TypeScript compiler API, so a comment or a string that only MENTIONS a module is no import. Every
// module reference form counts: `import`, `import type`, `import x = require()`, `export ... from`, `import("x")` (also as a type),
// `require("x")` and the jest calls that name a module (`jest.mock("x")`).
import { builtinModules } from "node:module"
import { posix } from "node:path"
import ts from "typescript"

/** The gates, as the plan names them. */
export const GATES = ["A", "B", "C", "D"]

/** The folder of the cells capability. */
export const CELLS_DIR = "be/src/modules/domain/cells"
/** The import specifier of the capability (the alias `@modules/*` is `be/src/modules/*`). */
export const CELLS_SPECIFIER = "@modules/domain/cells"
/** The folder of the isolated runner package; the only home of QuickJS evaluation (gate D). */
export const RUNNER_DIR = "packages/cell-runner"
/** The folder of the authoring package. */
export const AUTHOR_DIR = "packages/cells-author"

/**
 * Gate A, the platform pieces `cells` may import (CELLS-PLAN 7.2) and the three the slice-0 skeleton needs on top of the plan's list: the
 * injector helper of BE-INJECTION-2 (`composition`), the message text of a code (`i18n`) and the module definition builder
 * (`@starci/nest-kit`). Each is a platform piece, never another capability.
 */
const PLATFORM_ALLOWED = ["database", "clock", "errors", "logging", "primitives", "config", "composition", "i18n"]
/** Gate A, the packages `cells` may import. */
const PACKAGES_ALLOWED = ["@nestjs/", "typeorm", "ajv", "yaml", "@starci/common", "@starci/nest-kit"]
/** Gate A, what a spec file of cells also reaches: the test kit, the doubles and builders, the one stated agent-sdk entry (the expression parity spec). */
const SPEC_ALLOWED = ["@starci/jest-preset", "@tests/", "@nivo-lite/agent-sdk/template"]
/** Gate A, the two files that may import a `node:` module, and which. */
const NODE_MODULE_HOMES = {
    "node:crypto": `${CELLS_DIR}/cell-hash.policy.ts`,
    "node:child_process": `${CELLS_DIR}/cell-runner.client.ts`,
}

/** Gate B, who may import `@modules/domain/cells`: the folders and the one registry file (CELLS-PLAN 7.2 B), and the doubles of the kit (BE-TEST-4, a builder named `cells*.builder.ts`). */
const IMPORTER_FOLDERS = [`${CELLS_DIR}/`, "be/src/features/cli/cells-seed/", "be/src/tests/fixtures/cells/"]
const IMPORTER_FILES = ["be/src/modules/platform/database/entities.ts"]
const BUILDER_FILE = /^be\/src\/tests\/fixtures\/builders\/cells(?:-[a-z0-9-]+)?\.builder(?:\.spec)?\.ts$/u

/** Gate C, the modules that evaluate code. */
const EVAL_MODULES = new Set(["vm", "node:vm", "vm2", "isolated-vm"])
/** Gate C, the receivers whose `.eval` is the global one. */
const GLOBAL_RECEIVERS = new Set(["globalThis", "global", "window", "self"])

/** Gate D, the package of the QuickJS interpreter and the two evaluation calls. */
const QUICKJS = "quickjs-emscripten"
const QUICKJS_CALLS = new Set(["evalCode", "evalCodeAsync"])

const CODE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/u
const SPEC_FILE = /\.spec\.[cm]?[jt]sx?$/u

/** A path as git writes it: forward slashes, no leading `./`. */
export const normalizePath = (file) => file.replace(/\\/gu, "/").replace(/^(?:\.\/)+/u, "")

const startsWithFolder = (file, folder) => file.startsWith(`${folder}/`)
const isIn = (file, folder) => file === folder || startsWithFolder(file, folder)

/** A relative specifier as the repo path it names (null for a bare or aliased one). */
const resolveRelative = (file, specifier) => (/^\.\.?(?:\/|$)/u.test(specifier) ? posix.join(posix.dirname(file), specifier) : null)

/** The repo path an import reaches: a relative one resolved, an `@modules/*` alias mapped to `be/src/modules/*`, else null. */
const repoPathOf = (file, specifier) => {
    const relative = resolveRelative(file, specifier)
    if (relative !== null) return relative
    if (specifier.startsWith("@modules/")) return `be/src/modules/${specifier.slice("@modules/".length)}`
    return null
}

const isBuiltin = (specifier) => specifier.startsWith("node:") || builtinModules.includes(specifier)

const isTypeOnlyImport = (node) => {
    const clause = node.importClause
    if (clause === undefined) return false
    if (clause.isTypeOnly) return true
    const bindings = clause.namedBindings
    return clause.name === undefined && bindings !== undefined && ts.isNamedImports(bindings) && bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly)
}

const isTypeOnlyExport = (node) => {
    if (node.isTypeOnly) return true
    const clause = node.exportClause
    return clause !== undefined && ts.isNamedExports(clause) && clause.elements.length > 0 && clause.elements.every((element) => element.isTypeOnly)
}

const isStringLiteral = (node) => node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
const JEST_MODULE_CALLS = new Set(["mock", "doMock", "unmock", "dontMock", "requireActual", "requireMock", "setMock", "createMockFromModule", "unstable_mockModule"])

const sourceOf = (file, text) => {
    const kind = /\.[jt]sx$/u.test(file) ? ts.ScriptKind.TSX : /\.[cm]?js$/u.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS
    return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
}

/**
 * Every module reference of a source file: `{ specifier, line, typeOnly }` in source order. A reference is type-only when it is an
 * `import type`, an `export type ... from`, an import whose every name is `type`, or an `import("x")` in a type position.
 */
export const references = (file, text) => {
    const source = sourceOf(file, text)
    const found = []
    const add = (node, typeOnly) => {
        if (!isStringLiteral(node)) return
        found.push({ specifier: node.text, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, typeOnly })
    }
    const visit = (node) => {
        if (ts.isImportDeclaration(node)) add(node.moduleSpecifier, isTypeOnlyImport(node))
        else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) add(node.moduleSpecifier, isTypeOnlyExport(node))
        else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) add(node.moduleReference.expression, node.isTypeOnly)
        else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) add(node.argument.literal, true)
        else if (ts.isCallExpression(node) && node.arguments.length > 0) {
            const callee = node.expression
            const isImportCall = callee.kind === ts.SyntaxKind.ImportKeyword
            const isRequire = ts.isIdentifier(callee) && callee.text === "require"
            const isJestModule =
                ts.isPropertyAccessExpression(callee) &&
                ts.isIdentifier(callee.expression) &&
                callee.expression.text === "jest" &&
                JEST_MODULE_CALLS.has(callee.name.text)
            if (isJestModule || isImportCall || isRequire) add(node.arguments[0], false)
        }
        ts.forEachChild(node, visit)
    }
    visit(source)
    return found
}

/** The calls of a source file that gate C and gate D read: `{ kind, name, line }`. */
const calls = (file, text) => {
    const source = sourceOf(file, text)
    const found = []
    const lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
    const memberName = (callee) => {
        if (ts.isPropertyAccessExpression(callee)) return callee.name.text
        if (ts.isElementAccessExpression(callee) && isStringLiteral(callee.argumentExpression)) return callee.argumentExpression.text
        return null
    }
    const visit = (node) => {
        if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Function") {
            found.push({ kind: "function-constructor", name: "new Function", line: lineOf(node) })
        } else if (ts.isCallExpression(node)) {
            const callee = node.expression
            if (ts.isIdentifier(callee) && callee.text === "eval") found.push({ kind: "global-eval", name: "eval", line: lineOf(node) })
            else if (ts.isIdentifier(callee) && callee.text === "Function") found.push({ kind: "function-constructor", name: "Function", line: lineOf(node) })
            else if (ts.isIdentifier(callee) && QUICKJS_CALLS.has(callee.text)) found.push({ kind: "quickjs-call", name: callee.text, line: lineOf(node) })
            else {
                const member = memberName(callee)
                const receiver = ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee) ? callee.expression : null
                if (member === "eval" && receiver !== null && ts.isIdentifier(receiver) && GLOBAL_RECEIVERS.has(receiver.text)) {
                    found.push({ kind: "global-eval", name: `${receiver.text}.eval`, line: lineOf(node) })
                } else if (member !== null && QUICKJS_CALLS.has(member)) {
                    found.push({ kind: "quickjs-call", name: member, line: lineOf(node) })
                }
            }
        }
        ts.forEachChild(node, visit)
    }
    visit(source)
    return found
}

const finding = (gate, file, line, what) => ({ gate, file, line, what })

/** Gate A: what `cells` imports. */
const gateA = (file, refs) => {
    const findings = []
    const isSpec = SPEC_FILE.test(file)
    for (const { specifier, line } of refs) {
        if (isBuiltin(specifier)) {
            const home = NODE_MODULE_HOMES[specifier.startsWith("node:") ? specifier : `node:${specifier}`]
            if (home !== file) findings.push(finding("A", file, line, `${specifier}: a node module only where the plan names its home`))
            continue
        }
        const relative = resolveRelative(file, specifier)
        if (relative !== null) {
            if (!isIn(relative, CELLS_DIR)) findings.push(finding("A", file, line, `${specifier}: a relative path out of the cells folder`))
            continue
        }
        if (specifier === CELLS_SPECIFIER || specifier.startsWith(`${CELLS_SPECIFIER}/`)) continue
        if (specifier.startsWith("@modules/")) {
            const piece = /^@modules\/platform\/([^/]+)/u.exec(specifier)
            if (piece === null || !PLATFORM_ALLOWED.includes(piece[1])) findings.push(finding("A", file, line, `${specifier}: a module outside the allowed platform pieces`))
            continue
        }
        if (specifier === "@nivo-lite/agent-sdk" || specifier.startsWith("@nivo-lite/agent-sdk/")) {
            if (!(isSpec && SPEC_ALLOWED.some((entry) => specifier === entry))) findings.push(finding("A", file, line, `${specifier}: V2 stands alone, no agent-sdk (a spec may reach agent-sdk/template only)`))
            continue
        }
        const packageOk = PACKAGES_ALLOWED.some((entry) => (entry.endsWith("/") ? specifier.startsWith(entry) : specifier === entry || specifier.startsWith(`${entry}/`)))
        const specOk = isSpec && SPEC_ALLOWED.some((entry) => (entry.endsWith("/") ? specifier.startsWith(entry) : specifier === entry))
        if (!packageOk && !specOk) findings.push(finding("A", file, line, `${specifier}: not on the list of what cells imports`))
    }
    return findings
}

/** Gate B: who imports `cells`. */
const gateB = (file, refs) => {
    if (IMPORTER_FOLDERS.some((folder) => file.startsWith(folder)) || IMPORTER_FILES.includes(file) || BUILDER_FILE.test(file)) return []
    return refs.flatMap(({ specifier, line, typeOnly }) => {
        // The runner reads the protocol types of cells (gate D states it), type-only.
        if (typeOnly && startsWithFolder(file, `${RUNNER_DIR}/src`)) return []
        const reached = repoPathOf(file, specifier)
        const names = specifier === CELLS_SPECIFIER || specifier.startsWith(`${CELLS_SPECIFIER}/`) || (reached !== null && isIn(reached, CELLS_DIR))
        return names ? [finding("B", file, line, `${specifier}: nothing outside the cells folders imports cells`)] : []
    })
}

/** Gate C: no code evaluation in the repository. */
const gateC = (file, refs, callList) => [
    ...refs.filter(({ specifier }) => EVAL_MODULES.has(specifier)).map(({ specifier, line }) => finding("C", file, line, `${specifier}: no code evaluation module`)),
    ...callList.filter(({ kind }) => kind === "global-eval" || kind === "function-constructor").map(({ name, line }) => finding("C", file, line, `${name}: no code evaluation`)),
]

/** Gate D: the runner is the only evaluator, and the two packages stay apart from `be`. */
const gateD = (file, refs, callList) => {
    const findings = []
    const inRunnerSrc = startsWithFolder(file, `${RUNNER_DIR}/src`)
    if (!inRunnerSrc) {
        for (const { specifier, line } of refs) {
            if (specifier === QUICKJS || specifier.startsWith(`${QUICKJS}/`)) findings.push(finding("D", file, line, `${specifier}: QuickJS only under ${RUNNER_DIR}/src`))
        }
        for (const { kind, name, line } of callList) if (kind === "quickjs-call") findings.push(finding("D", file, line, `${name}: QuickJS evaluation only under ${RUNNER_DIR}/src`))
    }
    if (inRunnerSrc && !SPEC_FILE.test(file)) {
        for (const { specifier, line, typeOnly } of refs) {
            const relative = resolveRelative(file, specifier)
            if (relative !== null && isIn(relative, RUNNER_DIR)) continue
            if (specifier === QUICKJS || specifier.startsWith(`${QUICKJS}/`)) continue
            const reached = repoPathOf(file, specifier)
            const isCells = specifier === CELLS_SPECIFIER || specifier.startsWith(`${CELLS_SPECIFIER}/`) || (reached !== null && isIn(reached, CELLS_DIR))
            if (isCells && typeOnly) continue
            findings.push(finding("D", file, line, `${specifier}: the runner imports only ${QUICKJS} and type-only cells protocol types`))
        }
    }
    if (isIn(file, AUTHOR_DIR)) {
        for (const { specifier, line } of refs) {
            const reached = repoPathOf(file, specifier)
            const intoBe = /^@(?:modules|features|tests|config)\//u.test(specifier) || specifier === "be" || specifier.startsWith("be/") || (reached !== null && isIn(reached, "be"))
            if (intoBe) findings.push(finding("D", file, line, `${specifier}: the authoring package imports no be path`))
        }
    }
    if (isIn(file, "be") || isIn(file, "fe")) {
        for (const { specifier, line } of refs) {
            const reached = resolveRelative(file, specifier)
            const author = specifier === "@nivo-lite/cells-author" || specifier.startsWith("@nivo-lite/cells-author/") || (reached !== null && isIn(reached, AUTHOR_DIR))
            const runner = specifier === "@nivo-lite/cell-runner" || specifier.startsWith("@nivo-lite/cell-runner/") || (reached !== null && isIn(reached, RUNNER_DIR))
            if (author) findings.push(finding("D", file, line, `${specifier}: the engine imports no cells-author`))
            if (runner) findings.push(finding("D", file, line, `${specifier}: the engine imports no cell-runner internals`))
        }
    }
    return findings
}

/** Which gates read a file: false outside every scope. */
const scopeOf = (file) => ({
    a: isIn(file, CELLS_DIR),
    b: isIn(file, "be") || isIn(file, "fe") || isIn(file, "packages"),
    c: (startsWithFolder(file, "be/src") || /^packages\/[^/]+\/src\//u.test(file) || isIn(file, "fe")),
    d: isIn(file, "be") || isIn(file, "fe") || isIn(file, "packages"),
})

/** The findings of one file: `{ gate, file, line, what }` in gate then source order. */
export const cellsIsolationFindings = (rawFile, text) => {
    const file = normalizePath(rawFile)
    if (!CODE_FILE.test(file)) return []
    const scope = scopeOf(file)
    if (!scope.a && !scope.b && !scope.c && !scope.d) return []
    const refs = references(file, text)
    const callList = calls(file, text)
    const byLine = (left, right) => left.line - right.line
    return [
        ...(scope.a ? gateA(file, refs) : []).sort(byLine),
        ...(scope.b ? gateB(file, refs) : []).sort(byLine),
        ...(scope.c ? gateC(file, refs, callList) : []).sort(byLine),
        ...(scope.d ? gateD(file, refs, callList) : []).sort(byLine),
    ]
}

/** One line per finding: `file:line  gate what`. */
export const findingLine = (found) => `${found.file}:${found.line}  ${found.gate} ${found.what}`

/** The count of findings per gate, for the closing summary. */
export const countsByGate = (findings) => {
    const counts = Object.fromEntries(GATES.map((gate) => [gate, 0]))
    for (const found of findings) counts[found.gate] += 1
    return counts
}
