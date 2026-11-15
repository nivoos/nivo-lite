// The decision of the project check `cells-isolation` (ext/support/cells-isolation-rules.mjs) on fixtures: one positive and one negative per
// gate A to D, then the check program itself on a scratch tree with one planted violation per gate.
import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { test } from "node:test"
import { cellsIsolationFindings, countsByGate, findingLine, references } from "../support/cells-isolation-rules.mjs"
import { ROOT } from "../support/program.mjs"

const CELLS = "be/src/modules/domain/cells"
const SERVICE = `${CELLS}/cell-reader.service.ts`
const gatesOf = (file, text) => cellsIsolationFindings(file, text).map((found) => `${found.gate}:${found.line}`)

// ---- the reader of imports --------------------------------------------------------------------------------------------------

test("every module reference form is read, with its line and whether it is type-only", () => {
    const text = [
        `import { a } from "m1"`,
        `import type { b } from "m2"`,
        `import { type c, type d } from "m3"`,
        `import { type e, f } from "m4"`,
        `export { g } from "m5"`,
        `export type { h } from "m6"`,
        `import i = require("m7")`,
        `const j = await import("m8")`,
        `const k = require("m9")`,
        `type L = import("m10").L`,
        `jest.mock("m11")`,
        `import "m12"`,
    ].join("\n")
    assert.deepEqual(
        references("a.ts", text).map((ref) => `${ref.line}:${ref.specifier}:${ref.typeOnly}`),
        [
            "1:m1:false",
            "2:m2:true",
            "3:m3:true",
            "4:m4:false",
            "5:m5:false",
            "6:m6:true",
            "7:m7:false",
            "8:m8:false",
            "9:m9:false",
            "10:m10:true",
            "11:m11:false",
            "12:m12:false",
        ],
    )
})

test("a comment or a string that mentions a module is no import", () => {
    const text = [
        `// import x from "typeorm-x"`,
        `const s = 'import a from "@modules/domain/chat"'`,
        'const t = `require("vm")`',
        `const eval2 = obj.eval("x")`,
    ].join("\n")
    assert.deepEqual(gatesOf(SERVICE, text), [])
    assert.deepEqual(gatesOf("be/src/modules/domain/chat/chat.service.ts", text), [])
})

// ---- gate A: what cells imports ---------------------------------------------------------------------------------------------

test("gate A positive: cells imports its own folder, the allowed platform pieces and the allowed packages", () => {
    const text = [
        `import { Injectable } from "@nestjs/common"`,
        `import type { EntityManager } from "typeorm"`,
        `import Ajv from "ajv/dist/2020"`,
        `import { parse } from "yaml"`,
        `import { clockOf } from "@modules/platform/clock"`,
        `import { DomainError } from "@modules/platform/errors"`,
        `import { x } from "@modules/domain/cells"`,
        `import { y } from "./cells.contracts"`,
        `import { z } from "./errors/cells.error"`,
        `import { w } from "../cells/cell-reader.port"`,
    ].join("\n")
    assert.deepEqual(gatesOf(SERVICE, text), [])
})

test("gate A negative: another module, the agent-sdk, a plugin package, an unlisted package and a path out of the folder are findings", () => {
    const text = [
        `import { a } from "@modules/domain/chat"`,
        `import { b } from "@modules/platform/queue"`,
        `import { c } from "@nivo-lite/agent-sdk/template"`,
        `import { d } from "@nivo-lite/blocks-core"`,
        `import { e } from "lodash"`,
        `import { f } from "../chat/chat.service"`,
        `import { g } from "fs"`,
    ].join("\n")
    assert.deepEqual(gatesOf(SERVICE, text), ["A:1", "A:2", "A:3", "A:4", "A:5", "A:6", "A:7"])
})

test("gate A: a node module only in the one file the plan names for it", () => {
    assert.deepEqual(gatesOf(`${CELLS}/cell-hash.policy.ts`, `import { createHash } from "node:crypto"`), [])
    assert.deepEqual(gatesOf(`${CELLS}/cell-runner.client.ts`, `import { spawn } from "node:child_process"`), [])
    assert.deepEqual(gatesOf(SERVICE, `import { createHash } from "node:crypto"`), ["A:1"])
    assert.deepEqual(gatesOf(`${CELLS}/cell-hash.policy.ts`, `import { spawn } from "node:child_process"`), ["A:1"])
})

test("gate A: a spec reaches the test kit, the doubles and agent-sdk/template only; a service does not", () => {
    const text = [
        `import { builder } from "@starci/jest-preset"`,
        `import { MemoryCellReader } from "@tests/fixtures/builders/cells.builder"`,
        `import { parity } from "@nivo-lite/agent-sdk/template"`,
    ].join("\n")
    assert.deepEqual(gatesOf(`${CELLS}/cell-expression.policy.spec.ts`, text), [])
    assert.deepEqual(gatesOf(`${CELLS}/cell-expression.policy.ts`, text), ["A:1", "A:2", "A:3"])
    assert.deepEqual(gatesOf(`${CELLS}/cell-expression.policy.spec.ts`, `import { x } from "@nivo-lite/agent-sdk"`), [
        "A:1",
    ])
})

test("gate A: the ruled allowances are single-file: typescript, ajv8, and the spec-only node:fs, node:path", () => {
    assert.deepEqual(gatesOf(`${CELLS}/cell-source-scan.policy.ts`, `import ts from "typescript"`), [])
    assert.deepEqual(gatesOf(`${CELLS}/cell-json-schema.policy.ts`, `import Ajv from "ajv8/dist/2020"`), [])
    // The same import in ANOTHER production file is still refused.
    assert.deepEqual(gatesOf(`${CELLS}/cell-seed.service.ts`, `import ts from "typescript"`), ["A:1"])
    assert.deepEqual(gatesOf(`${CELLS}/cell-seed.service.ts`, `import Ajv from "ajv8"`), ["A:1"])
    assert.deepEqual(gatesOf(`${CELLS}/cell-source-scan.policy.ts`, `import Ajv from "ajv8"`), ["A:1"])
    assert.deepEqual(
        gatesOf(
            `${CELLS}/cell-seed.service.ts`,
            `import { readFileSync } from "node:fs"
import { join } from "node:path"`,
        ),
        ["A:1", "A:2"],
    )
    assert.deepEqual(
        gatesOf(
            `${CELLS}/cell-seed.service.spec.ts`,
            `import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "yaml"`,
        ),
        [],
    )
    assert.deepEqual(gatesOf(`${CELLS}/cell-seed.service.spec.ts`, `import { tmpdir } from "node:os"`), ["A:1"])
})

test("gate A: a type-only import of a node module is erased and allowed; gate D: fixture authoring origins may import cells-author", () => {
    assert.deepEqual(
        gatesOf(
            `${CELLS}/cell-runner.client.ts`,
            `import type { Readable } from "node:stream"
import { Readable as R } from "node:stream"`,
        ),
        ["A:2"],
    )
    const origin = `import type { NodeContext } from "@nivo-lite/cells-author"`
    assert.deepEqual(gatesOf("be/src/tests/fixtures/cells/demo-money/cells/node/x/v1/run.ts", origin), [])
    assert.deepEqual(gatesOf("be/src/modules/domain/chat/run.ts", origin), ["D:1"])
})

// ---- gate B: who imports cells ----------------------------------------------------------------------------------------------

test("gate B positive: the cells folders, the cli seed, the fixtures, the doubles and the registry file import cells", () => {
    const text = `import { CellsModule } from "@modules/domain/cells"`
    for (const file of [
        `${CELLS}/index.ts`,
        "be/src/features/cli/cells-seed/cells-seed.cli.ts",
        "be/src/tests/fixtures/cells/demo-money/x.ts",
        "be/src/tests/fixtures/builders/cells.builder.ts",
        "be/src/tests/fixtures/builders/cells.builder.spec.ts",
        "be/src/tests/fixtures/builders/cells-proof.builder.ts",
        "be/src/modules/platform/database/entities.ts",
        "be/apps/cli/src/cli.env.ts",
        "be/apps/cli/src/compose/modules.ts",
    ]) {
        assert.deepEqual(gatesOf(file, text), [], file)
    }
})

test("gate B: the cli composition root is the one app file allowed; the api, the mcp app and another cli file are not", () => {
    const text = `import { CellsModule } from "@modules/domain/cells"`
    assert.deepEqual(gatesOf("be/apps/api/src/compose/modules.ts", text), ["B:1"])
    assert.deepEqual(gatesOf("be/apps/mcp/src/compose/modules.ts", text), ["B:1"])
    assert.deepEqual(gatesOf("be/apps/cli/src/main.ts", text), ["B:1"])
    assert.deepEqual(gatesOf("be/src/features/cli/cli.module.ts", text), ["B:1"])
})

test("gate A: the runner client's spec alone may import node:child_process and node:os (it probes the real child); another spec may not", () => {
    const text = `import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"`
    assert.deepEqual(gatesOf(`${CELLS}/cell-runner.client.spec.ts`, text), [])
    assert.deepEqual(gatesOf(`${CELLS}/cell-seed.runner.spec.ts`, text), ["A:1", "A:2"])
    assert.deepEqual(gatesOf(`${CELLS}/cell-runner.client.ts`, `import { tmpdir } from "node:os"`), ["A:1"])
})

test("gate B negative: any other file of be, fe or packages that imports cells, by alias, subpath or relative path", () => {
    assert.deepEqual(
        gatesOf("be/src/modules/domain/chat/chat.service.ts", `import { x } from "@modules/domain/cells"`),
        ["B:1"],
    )
    assert.deepEqual(
        gatesOf(
            "be/src/modules/domain/chat/chat.service.ts",
            `import { x } from "@modules/domain/cells/cells.contracts"`,
        ),
        ["B:1"],
    )
    assert.deepEqual(
        gatesOf("be/src/modules/domain/chat/chat.service.ts", `import { x } from "../cells/cells.contracts"`),
        ["B:1"],
    )
    assert.deepEqual(gatesOf("be/src/modules/domain/chat/chat.service.ts", `jest.mock("@modules/domain/cells")`), [
        "B:1",
    ])
    assert.deepEqual(
        gatesOf("packages/blocks-core/src/index.ts", `import { x } from "../../../be/src/modules/domain/cells"`),
        ["B:1"],
    )
    assert.deepEqual(
        gatesOf("be/src/modules/domain/chat/chat.service.ts", `import { x } from "@modules/domain/cells-other"`),
        [],
    )
})

// ---- gate C: no code evaluation ---------------------------------------------------------------------------------------------

test("gate C negative: the global eval, the Function constructor and the evaluating modules are findings", () => {
    const text = [
        `eval("1")`,
        `const f = new Function("a", "return a")`,
        `const g = Function("return 1")`,
        `globalThis.eval("2")`,
        `import vm from "vm"`,
        `import { Script } from "node:vm"`,
        `import vm2 from "vm2"`,
        `import ivm from "isolated-vm"`,
    ].join("\n")
    assert.deepEqual(gatesOf("be/src/modules/domain/chat/chat.service.ts", text), [
        "C:1",
        "C:2",
        "C:3",
        "C:4",
        "C:5",
        "C:6",
        "C:7",
        "C:8",
    ])
    assert.deepEqual(gatesOf("packages/blocks-core/src/x.ts", `eval("1")`), ["C:1"])
    assert.deepEqual(gatesOf("fe/apps/web/src/x.ts", `eval("1")`), ["C:1"])
})

test("gate C positive: a Redis client.eval member call (Lua on Redis), a method named eval and a string are no finding; outside the scopes none is read", () => {
    const text = [
        `await client.eval(script, 0)`,
        `redis.eval("return 1")`,
        `const note = "eval(x)"`,
        `class A { eval() {} }`,
        `this.eval("x")`,
    ].join("\n")
    assert.deepEqual(gatesOf("be/src/modules/platform/realtime/realtime.service.ts", text), [])
    assert.deepEqual(gatesOf("scripts/x.mjs", `eval("1")`), [])
    assert.deepEqual(gatesOf("be/src/x.json", `eval("1")`), [])
})

// ---- gate D: the runner is the only evaluator -------------------------------------------------------------------------------

test("gate D positive: the runner evaluates with QuickJS, imports only it and type-only cells protocol types", () => {
    const text = [
        `import { getQuickJS } from "quickjs-emscripten"`,
        `import type { RunnerInbound } from "@modules/domain/cells"`,
        `import { type RunnerFacts } from "../../../be/src/modules/domain/cells/cells.contracts"`,
        `import { prelude } from "./prelude"`,
        `const out = context.evalCode("1")`,
        `const more = await context.evalCodeAsync("2")`,
    ].join("\n")
    assert.deepEqual(gatesOf("packages/cell-runner/src/guest-run.ts", text), [])
})

test("gate D negative: QuickJS or its evaluation calls outside the runner source, and a runner that imports more than it may", () => {
    assert.deepEqual(
        gatesOf("be/src/modules/domain/cells/cell-runner.client.ts", `import { getQuickJS } from "quickjs-emscripten"`),
        ["A:1", "D:1"],
    )
    assert.deepEqual(gatesOf("packages/cells-author/src/x.ts", `context.evalCode("1")`), ["D:1"])
    assert.deepEqual(gatesOf("packages/cell-runner/scripts/x.mjs", `import q from "quickjs-emscripten"`), ["D:1"])
    const text = [
        `import { value } from "@modules/domain/cells"`,
        `import { clock } from "@modules/platform/clock"`,
        `import fs from "node:fs"`,
        `import x from "lodash"`,
    ].join("\n")
    assert.deepEqual(gatesOf("packages/cell-runner/src/main.ts", text), ["B:1", "D:1", "D:2", "D:3", "D:4"])
    // A runner spec may spawn the child and read its files.
    assert.deepEqual(gatesOf("packages/cell-runner/src/main.spec.ts", `import { spawn } from "node:child_process"`), [])
})

test("gate D negative: the authoring package imports no be path, and the engine imports no cells-author and no cell-runner", () => {
    const author = [
        `import { x } from "@modules/domain/cells"`,
        `import { y } from "../../../be/src/modules/platform/clock"`,
        `import { z } from "yaml"`,
    ].join("\n")
    assert.deepEqual(gatesOf("packages/cells-author/src/emit.ts", author), ["B:1", "D:1", "D:2"])
    assert.deepEqual(
        gatesOf("be/src/modules/domain/chat/chat.service.ts", `import { x } from "@nivo-lite/cells-author"`),
        ["D:1"],
    )
    assert.deepEqual(
        gatesOf("be/src/modules/domain/chat/chat.service.ts", `import { x } from "@nivo-lite/cells-author/emit"`),
        ["D:1"],
    )
    assert.deepEqual(
        gatesOf("be/src/modules/domain/chat/chat.service.ts", `import { x } from "@nivo-lite/cell-runner"`),
        ["D:1"],
    )
    assert.deepEqual(
        gatesOf(
            "be/src/modules/domain/chat/chat.service.ts",
            `import { x } from "../../../../../packages/cells-author/src/index"`,
        ),
        ["D:1"],
    )
    assert.deepEqual(
        gatesOf("be/src/modules/domain/chat/chat.service.ts", `import { x } from "@nivo-lite/cells-author-extra"`),
        [],
    )
})

test("a finding prints as file:line  gate what and counts per gate", () => {
    const findings = [
        ...cellsIsolationFindings("be/src/a.ts", `eval("1")`),
        ...cellsIsolationFindings("be/src/b.ts", `import { x } from "@modules/domain/cells"`),
    ]
    assert.deepEqual(findings.map(findingLine), [
        "be/src/a.ts:1  C eval: no code evaluation",
        "be/src/b.ts:1  B @modules/domain/cells: nothing outside the cells folders imports cells",
    ])
    assert.deepEqual(countsByGate(findings), { A: 0, B: 1, C: 1, D: 0 })
})

// ---- the check program on a scratch tree ------------------------------------------------------------------------------------

const CHECK = resolve(ROOT, "ext/checks/cells-isolation.mjs")
const runCheck = (tree) => {
    const dir = mkdtempSync(join(tmpdir(), "cells-isolation-"))
    try {
        for (const [file, text] of Object.entries(tree)) {
            const path = join(dir, file)
            mkdirSync(dirname(path), { recursive: true })
            writeFileSync(path, text)
        }
        const result = spawnSync(process.execPath, [CHECK, "--root", dir], { encoding: "utf8", windowsHide: true })
        return { status: result.status, out: result.stdout.trim(), err: result.stderr.trim() }
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
}

test("the program is green on a clean tree", () => {
    const result = runCheck({
        [`${CELLS}/cell-reader.service.ts`]: `import { Injectable } from "@nestjs/common"`,
        "be/src/modules/domain/chat/chat.service.ts": `export const x = 1`,
        "packages/cell-runner/src/main.ts": `import { getQuickJS } from "quickjs-emscripten"\nctx.evalCode("1")`,
    })
    assert.deepEqual(result, {
        status: 0,
        out: "cells isolation: 0 finding(s) in 3 files (A 0, B 0, C 0, D 0)",
        err: "",
    })
})

test("the program is red on four planted violations, one per gate", () => {
    const result = runCheck({
        [`${CELLS}/cell-reader.service.ts`]: `import { chat } from "@modules/domain/chat"`,
        "be/src/modules/domain/chat/chat.service.ts": `import { CellsModule } from "@modules/domain/cells"`,
        "be/src/modules/domain/mail/mail.service.ts": `export const run = (code: string) => eval(code)`,
        "packages/cells-author/src/emit.ts": `import { clock } from "@modules/platform/clock"`,
    })
    assert.equal(result.status, 1)
    assert.equal(result.out, "cells isolation: 4 finding(s) in 4 files (A 1, B 1, C 1, D 1)")
    assert.deepEqual(result.err.split(/\r?\n/u), [
        `${CELLS}/cell-reader.service.ts:1  A @modules/domain/chat: a module outside the allowed platform pieces`,
        "be/src/modules/domain/chat/chat.service.ts:1  B @modules/domain/cells: nothing outside the cells folders imports cells",
        "be/src/modules/domain/mail/mail.service.ts:1  C eval: no code evaluation",
        "packages/cells-author/src/emit.ts:1  D @modules/platform/clock: the authoring package imports no be path",
    ])
})
