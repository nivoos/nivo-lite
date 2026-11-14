import { posix } from "node:path"
import ts from "typescript"

/** A source that cannot be compiled into the one text a cell stores; `message` names the file and the reason. */
export class CompileError extends Error {}

/** Reads a project file by its posix path relative to the project root; null when there is none. */
export type ReadText = (path: string) => string | null

const OPTIONS: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    newLine: ts.NewLineKind.LineFeed,
    removeComments: false,
    importHelpers: false,
    sourceMap: false,
}

/** Identifiers a stored source never references: the module system and the host (the runner removes them, and a compiled text must not rely on them). */
const FORBIDDEN_NAMES = new Set(["require", "module", "exports", "process", "globalThis", "window", "self", "eval", "Function", "fetch"])

const fail = (path: string, reason: string): never => {
    throw new CompileError(`${path}: ${reason}`)
}

/** `export` modifiers removed, imports and re-exports dropped: what is left of a local module is plain script text. */
const stripModuleSyntax: ts.TransformerFactory<ts.SourceFile> = () => (source) => {
    const statements = source.statements.flatMap((statement): ReadonlyArray<ts.Statement> => {
        if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) return []
        const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined
        if (modifiers === undefined || !modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) return [statement]
        const kept = modifiers.filter((modifier) => modifier.kind !== ts.SyntaxKind.ExportKeyword)
        return [ts.factory.replaceModifiers(statement as ts.HasModifiers, kept) as ts.Statement]
    })
    return ts.factory.updateSourceFile(source, statements)
}

const isRelative = (specifier: string): boolean => /^\.\.?\//u.test(specifier)

const topLevelNames = (source: ts.SourceFile): ReadonlyArray<string> =>
    source.statements.flatMap((statement): ReadonlyArray<string> => {
        if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name !== undefined) return [statement.name.text]
        if (ts.isVariableStatement(statement)) {
            return statement.declarationList.declarations.flatMap((declaration) => (ts.isIdentifier(declaration.name) ? [declaration.name.text] : []))
        }
        return []
    })

/** The local modules a file imports (in order), after checking that it imports nothing else and exports nothing but plain declarations. */
const localImportsOf = (path: string, source: ts.SourceFile): ReadonlyArray<string> => {
    const found: Array<string> = []
    for (const statement of source.statements) {
        if (ts.isImportDeclaration(statement)) {
            const clause = statement.importClause
            const specifier = (statement.moduleSpecifier as ts.StringLiteral).text
            const bindings = clause?.namedBindings
            const typeOnly =
                clause !== undefined &&
                (clause.isTypeOnly ||
                    (clause.name === undefined &&
                        bindings !== undefined &&
                        ts.isNamedImports(bindings) &&
                        bindings.elements.length > 0 &&
                        bindings.elements.every((element) => element.isTypeOnly)))
            if (typeOnly) continue
            if (!isRelative(specifier)) fail(path, `imports "${specifier}": a cell source imports nothing but its own local helpers`)
            if (clause === undefined || clause.name !== undefined || bindings === undefined || !ts.isNamedImports(bindings)) {
                fail(path, `import of "${specifier}" must be \`import { name } from\``)
            } else if (bindings.elements.some((element) => element.propertyName !== undefined)) {
                fail(path, `import of "${specifier}" renames a name: helpers are bundled into one scope, keep their names`)
            }
            found.push(posix.join(posix.dirname(path), specifier.endsWith(".ts") ? specifier : `${specifier}.ts`))
        } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined) {
            fail(path, "re-exports are not supported in a cell source")
        } else if (ts.isExportAssignment(statement) || (ts.canHaveModifiers(statement) && (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword))) {
            fail(path, "`export default` and `export =` are not supported in a cell source")
        }
    }
    return found
}

interface BundledModule {
    readonly path: string
    readonly text: string
    readonly source: ts.SourceFile
}

/** The helpers first (depth first, each once), then the entry. */
const bundleOrder = (entry: string, read: ReadText): ReadonlyArray<BundledModule> => {
    const order: Array<BundledModule> = []
    const seen = new Set<string>()
    const visit = (path: string, trail: ReadonlyArray<string>): void => {
        if (trail.includes(path)) fail(path, `import cycle ${[...trail, path].join(" -> ")}`)
        if (seen.has(path)) return
        const text = read(path)
        if (text === null) return fail(path, "no such file")
        const source = ts.createSourceFile(path, text, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS)
        for (const dependency of localImportsOf(path, source)) visit(dependency, [...trail, path])
        seen.add(path)
        order.push({ path, text, source })
    }
    visit(entry, [])
    return order
}

/** True for the name part of `a.name` and of `{ name: x }`: a member name, not a reference. */
const isMemberName = (node: ts.Identifier): boolean => {
    const parent = node.parent
    return (ts.isPropertyAccessExpression(parent) && parent.name === node) || (ts.isPropertyAssignment(parent) && parent.name === node)
}

/** Parses the compiled text as a script and refuses what the runner forbids: module syntax, dynamic import, the host and the module system. */
const checkCompiled = (entry: string, text: string): void => {
    const source = ts.createSourceFile(entry, text, ts.ScriptTarget.ES2020, true, ts.ScriptKind.JS)
    const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isExportAssignment(node)) fail(entry, "the compiled text has module syntax")
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) fail(entry, "dynamic import is not allowed in a cell source")
        if (ts.isMetaProperty(node)) fail(entry, "`import.meta` is not allowed in a cell source")
        if (ts.isIdentifier(node) && FORBIDDEN_NAMES.has(node.text) && !isMemberName(node)) fail(entry, `\`${node.text}\` is not available to a cell source`)
        ts.forEachChild(node, visit)
    }
    visit(source)
}

/**
 * Compiles the TypeScript origin `entry` into ONE self-contained JavaScript text (CELLS-DECISIONS D3): types erased, the local helper files it imports
 * bundled in front of it into one scope (their `export` removed), target ES2022, LF line ends, one trailing newline; no import, no require. The same
 * input gives the same bytes. A source that imports a package, renames an imported helper, re-exports, shares a top-level name between two files,
 * or reaches the module system, the host or dynamic import is refused with a `CompileError`.
 */
export const compileSource = (entry: string, read: ReadText): string => {
    const modules = bundleOrder(entry, read)
    const owners = new Map<string, string>()
    for (const { path, source } of modules) {
        for (const name of topLevelNames(source)) {
            const owner = owners.get(name)
            if (owner !== undefined) fail(path, `\`${name}\` is also declared in ${owner}: bundled helpers share one scope`)
            owners.set(name, path)
        }
    }
    const parts = modules.map(({ path, text }) => {
        const result = ts.transpileModule(text, { fileName: path, compilerOptions: OPTIONS, reportDiagnostics: true, transformers: { before: [stripModuleSyntax] } })
        const problem = (result.diagnostics ?? []).find((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
        if (problem !== undefined) fail(path, ts.flattenDiagnosticMessageText(problem.messageText, "\n"))
        return result.outputText.replace(/\r\n/gu, "\n").replace(/^export \{\};?\n?/gmu, "").trim()
    })
    const text = `${parts.join("\n\n")}\n`
    checkCompiled(entry, text)
    return text
}
