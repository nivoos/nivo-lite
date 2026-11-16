// The decision of the project check `fe-module-keys` (ext/support/fe-module-keys-rules.mjs) on fixtures. The keys are INVENTED here: the
// rule reads whatever keys it is handed, it holds none of its own.
import { strict as assert } from "node:assert"
import { test } from "node:test"
import { findingLine, isFeSource, keysOfInstallation, moduleKeyFindings } from "../support/fe-module-keys-rules.mjs"

const KEYS = new Set(["alpha", "beta_desk", "content"])
const FILE = "fe/apps/web/src/hooks/installations/useThing.ts"
const found = (text, file = FILE) => moduleKeyFindings(file, text, KEYS).map((finding) => `${finding.line}:${finding.key}:${finding.role}`)

test("a key named where code names a type is a finding, with its line and its role", () => {
    const text = [
        `const a = x === "alpha"`,
        `const b = ["alpha", "beta_desk"]`,
        `const c = value ?? "beta_desk"`,
        `type D = "alpha" | "beta_desk"`,
        `const e = TABLE["alpha"]`,
        `const f = { "alpha": 1 }`,
        `const G = "alpha"`,
        `switch (k) { case "beta_desk": break }`,
        `const h = ok ? "alpha" : null`,
        `const i = () => "alpha"`,
        `agentHref("alpha", id)`,
        `new Set(["alpha"])`,
    ].join("\n")
    assert.deepEqual(found(text), [
        "1:alpha:comparison or fallback",
        "2:alpha:array element",
        "2:beta_desk:array element",
        "3:beta_desk:comparison or fallback",
        "4:alpha:literal type",
        "4:beta_desk:literal type",
        "5:alpha:index",
        "6:alpha:property name",
        "7:alpha:initialiser or default",
        "8:beta_desk:case",
        "9:alpha:conditional branch",
        "10:alpha:returned value",
        "11:alpha:call argument",
        "12:alpha:array element",
    ])
})

test("a word that is also a key but stands as a message key, a JSX attribute, a property value or in a comment is no finding", () => {
    const text = [
        `const t = useTranslations("ns")`,
        `const label = t("content")`,
        `const other = props.t("content")`,
        `const x = <Field name="content" />`,
        `const y = { id: "content" }`,
        `// "alpha" in a comment, and "beta_desk" in a /* comment */`,
        "const z = `alpha ${1}`",
        `import { q } from "alpha"`,
    ].join("\n")
    assert.deepEqual(found(text, "fe/apps/web/src/components/blocks/Pay/index.tsx"), [])
})

test("a translator bound by getTranslations (awaited) is read as a catalogue lookup", () => {
    assert.deepEqual(found(`const tr = await getTranslations("ns")\nconst a = tr("content")`), [])
    assert.deepEqual(found(`const tr = somethingElse("ns")\nconst a = tr("content")`), ["2:content:call argument"])
})

test("the law reaches the web app and the front-end packages, not specs, fixtures, generated files, declarations or the other apps", () => {
    assert.equal(isFeSource("fe/apps/web/src/hooks/a.ts"), true)
    assert.equal(isFeSource("fe/packages/i18n/src/a.tsx"), true)
    assert.equal(isFeSource("fe/apps/web/src/hooks/a.spec.ts"), false)
    assert.equal(isFeSource("fe/apps/web/src/modules/api/graphql/__generated__/graphql.ts"), false)
    assert.equal(isFeSource("fe/apps/web/src/modules/workflowSteps/__fixtures__/a.ts"), false)
    assert.equal(isFeSource("fe/apps/web/src/types.d.ts"), false)
    assert.equal(isFeSource("fe/apps/admin/src/hooks/a.ts"), false)
    assert.equal(isFeSource("fe/apps/web/src/messages/en.json"), false)
    assert.deepEqual(found(`const a = x === "alpha"`, "be/src/a.ts"), [])
})

test("an empty key set finds nothing, and the keys of an installation are every plugin's modules, every module and every template agent", () => {
    assert.deepEqual(moduleKeyFindings(FILE, `const a = x === "alpha"`, new Set()), [])
    const keys = keysOfInstallation({
        plugins: [{ modules: ["m1", "m2"] }, { modules: ["m3"] }],
        modules: [{ key: "m1" }, { key: "m4" }],
        templateAgents: [{ key: "m5" }],
    })
    assert.deepEqual([...keys].sort(), ["m1", "m2", "m3", "m4", "m5"])
})

test("the line of a finding names the file, the line, the key and the role", () => {
    const [finding] = moduleKeyFindings(FILE, `const a = x === "alpha"`, KEYS)
    assert.equal(findingLine(finding), `${FILE}:1  "alpha"  comparison or fallback`)
})
