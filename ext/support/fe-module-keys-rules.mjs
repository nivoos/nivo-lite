// The decision of the project check `fe-module-keys` (ext/checks/fe-module-keys.mjs), pure: a file's repo-relative path, its text and the
// module/agent keys of the installed plugins in; the places where front-end source names one of those keys as a literal out. No file, no
// build, no package loaded. This file is no check: it lives in ext/support/ because the harness's R103 refuses a file of ext/checks/ that
// ext/manifest.json `checks` does not declare. Concept: .starciwork/concepts/layers.md rules 6 and 11 (a host app holds no package's
// key: what exists is read from the installation, what a workspace sees is what the api serves it), doc ext/docs/checks/fe-module-keys.md.
//
// A key is never a word list of this file: the caller reads the keys from the installed plugins at check time. A literal is read with
// the TypeScript compiler API, so a comment or the text of a message never counts; only a string literal that stands where code NAMES a
// type does: a comparison, a `case`, an array element, a literal type, an index, a quoted property name, an initialiser or default,
// a fallback (`??`, `||`, a conditional branch), a returned value, or an argument of a call that is not a message-catalogue lookup.
import ts from "typescript"

/** The code extensions read. */
const CODE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/u

/** Files that are not the app's own code: generated output, type declarations, specs and their fixtures. */
const NOT_APP_CODE = /(?:^|\/)(?:__generated__|__fixtures__|node_modules|\.next)\/|\.d\.ts$|\.(?:spec|test)\.[cm]?[jt]sx?$/u

/** A path as git writes it: forward slashes, no leading `./`. */
export const normalizePath = (file) => file.replace(/\\/gu, "/").replace(/^(?:\.\/)+/u, "")

/**
 * Whether the law reaches a file: the source of the web app (`fe/apps/web/src`, the host app that lists modules and agents) and of the
 * front-end packages (`fe/packages/<package>/src`). The admin and landing apps have no module concept; a word there is a message key.
 */
export const isFeSource = (file) => {
    const path = normalizePath(file)
    return CODE_FILE.test(path) && /^fe\/(?:apps\/web|packages\/[^/]+)\/src\//u.test(path) && !NOT_APP_CODE.test(path)
}

const isStringLiteral = (node) => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)

/** The functions whose result is the translator of a message catalogue. */
const TRANSLATOR_FACTORIES = new Set(["useTranslations", "getTranslations", "createTranslator"])

/** Peels `await` and parentheses off an expression. */
const unwrap = (node) => {
    let current = node
    while (ts.isAwaitExpression(current) || ts.isParenthesizedExpression(current)) current = current.expression
    return current
}

/** The names a file binds to a message translator (`const t = useTranslations("ns")`, `const t = await getTranslations()`). */
const translatorNames = (source) => {
    const names = new Set()
    const visit = (node) => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
            const call = unwrap(node.initializer)
            if (ts.isCallExpression(call) && ts.isIdentifier(call.expression) && TRANSLATOR_FACTORIES.has(call.expression.text)) names.add(node.name.text)
        }
        ts.forEachChild(node, visit)
    }
    visit(source)
    return names
}

/** Whether a call looks a message up in a catalogue (its argument is a message key, never a package's key): `t(...)`, `x.t(...)`, a bound translator. */
const isTranslatorCall = (call, names) => {
    const callee = call.expression
    if (ts.isIdentifier(callee)) return callee.text === "t" || names.has(callee.text)
    return ts.isPropertyAccessExpression(callee) && (callee.name.text === "t" || (ts.isIdentifier(callee.expression) && names.has(callee.expression.text)))
}

const COMPARISONS = new Set([
    ts.SyntaxKind.EqualsEqualsToken,
    ts.SyntaxKind.EqualsEqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsToken,
    ts.SyntaxKind.ExclamationEqualsEqualsToken,
    ts.SyntaxKind.QuestionQuestionToken,
    ts.SyntaxKind.BarBarToken,
])

/** What the literal stands as, or null when it stands where a key is not named (a JSX attribute, a property value, a message key...). */
const roleOf = (node, names) => {
    const parent = node.parent
    if (ts.isBinaryExpression(parent) && COMPARISONS.has(parent.operatorToken.kind)) return "comparison or fallback"
    if (ts.isCaseClause(parent)) return "case"
    if (ts.isArrayLiteralExpression(parent)) return "array element"
    if (ts.isLiteralTypeNode(parent)) return "literal type"
    if (ts.isElementAccessExpression(parent) && parent.argumentExpression === node) return "index"
    if (ts.isPropertyAssignment(parent) && parent.name === node) return "property name"
    if ((ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isPropertyDeclaration(parent)) && parent.initializer === node) return "initialiser or default"
    if (ts.isConditionalExpression(parent) && parent.condition !== node) return "conditional branch"
    if (ts.isReturnStatement(parent)) return "returned value"
    if (ts.isArrowFunction(parent) && parent.body === node) return "returned value"
    if (ts.isCallExpression(parent) && parent.arguments.includes(node) && !isTranslatorCall(parent, names)) return "call argument"
    if (ts.isNewExpression(parent) && parent.arguments !== undefined && parent.arguments.includes(node)) return "call argument"
    return null
}

/** Every literal of a file that names one of the `keys`, as `{ file, line, key, role }`, in source order. */
export const moduleKeyFindings = (file, text, keys) => {
    const path = normalizePath(file)
    if (!isFeSource(path) || keys.size === 0) return []
    const kind = /\.[jt]sx$/u.test(path) ? ts.ScriptKind.TSX : /\.[cm]?js$/u.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind)
    const names = translatorNames(source)
    const found = []
    const visit = (node) => {
        if (isStringLiteral(node) && keys.has(node.text)) {
            const role = roleOf(node, names)
            if (role !== null) found.push({ file: path, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, key: node.text, role })
        }
        ts.forEachChild(node, visit)
    }
    visit(source)
    return found
}

/** The keys an installation declares: every plugin's module keys, every installed module's key and every template agent's key. */
export const keysOfInstallation = (installed) =>
    new Set([
        ...installed.plugins.flatMap((plugin) => plugin.modules),
        ...installed.modules.map((module) => module.key),
        ...installed.templateAgents.map((agent) => agent.key),
    ])

/** One line per finding: `file:line  "key"  role`. */
export const findingLine = (finding) => `${finding.file}:${finding.line}  "${finding.key}"  ${finding.role}`
