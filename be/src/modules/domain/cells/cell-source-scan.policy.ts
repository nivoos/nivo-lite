import ts from "typescript"

/** What the scan of one stored (compiled) source found, from its syntax tree. */
export interface SourceScan {
    /** The forbidden constructs used as code, one entry per use: `import`, `export`, `require`, `eval`, `Function`. */
    readonly forbidden: ReadonlyArray<string>
    /** The literal first arguments of every `<expr>.tool("name", ...)` call. */
    readonly toolCalls: ReadonlyArray<string>
    /** How many `.tool(...)` calls name their tool by something other than a string literal. */
    readonly dynamicToolCalls: number
    /** The names of the functions the script declares (`function run`). */
    readonly functions: ReadonlyArray<string>
    /** The syntax errors the parser found, in plain text. */
    readonly syntax: ReadonlyArray<string>
    /** Every async function and `await` (line:column): a cell source is SYNCHRONOUS (CELLS-DECISIONS C1: `tool()` returns its answer, no promise job ever runs). */
    readonly asyncCode: ReadonlyArray<string>
}

/** Whether a node is async code: an `async` function of any form, or an `await` (also `for await`). */
export const isAsyncCode = (node: ts.Node): boolean =>
    ts.isAwaitExpression(node) ||
    (ts.isForOfStatement(node) && node.awaitModifier !== undefined) ||
    ((ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node)) &&
        (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword))

/** The forbidden construct a node is, or null (D3: no import, require, dynamic import, eval or `new Function`). */
const forbiddenOf = (node: ts.Node): string | null => {
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)) return "import"
    if (ts.isExportDeclaration(node) || ts.isExportAssignment(node)) return "export"
    if (
        ts.canHaveModifiers(node) &&
        ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true
    )
        return "export"
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) return "import"
    if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) return "import"
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        if (node.expression.text === "require") return "require"
        if (node.expression.text === "eval") return "eval"
        if (node.expression.text === "Function") return "Function"
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Function")
        return "Function"
    return null
}

/** The parser's own syntax errors of a source file (the parser keeps them on the node, outside its public type). */
const syntaxOf = (file: ts.SourceFile): ReadonlyArray<string> => {
    const diagnostics = Reflect.get(file, "parseDiagnostics") as ReadonlyArray<ts.Diagnostic> | undefined
    return (diagnostics ?? []).map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, " "))
}

/**
 * Scans a compiled source by its syntax tree (JavaScript, parsed with the TypeScript parser): the forbidden constructs used as code, the
 * tools it calls by literal name and the functions it declares. A word in a string, a comment or a property name is never a use.
 */
export const scanSource = (text: string): SourceScan => {
    const file = ts.createSourceFile("source.js", text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS)
    const forbidden: Array<string> = []
    const toolCalls: Array<string> = []
    const functions: Array<string> = []
    const asyncCode: Array<string> = []
    let dynamicToolCalls = 0
    const visit = (node: ts.Node): void => {
        const found = forbiddenOf(node)
        if (found !== null) forbidden.push(found)
        if (ts.isFunctionDeclaration(node) && node.name !== undefined) functions.push(node.name.text)
        if (isAsyncCode(node)) {
            const at = file.getLineAndCharacterOfPosition(node.getStart(file))
            asyncCode.push(`${String(at.line + 1)}:${String(at.character + 1)}`)
        }
        if (
            ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            node.expression.name.text === "tool"
        ) {
            const [first] = node.arguments
            if (first !== undefined && ts.isStringLiteralLike(first) && !ts.isTemplateExpression(first))
                toolCalls.push(first.text)
            else dynamicToolCalls += 1
        }
        ts.forEachChild(node, visit)
    }
    visit(file)
    return { forbidden, toolCalls, dynamicToolCalls, functions, syntax: syntaxOf(file), asyncCode }
}
