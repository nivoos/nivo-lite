import { spawn, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { parse } from "yaml"
import type { JsonValue, RunnerLimits, RunnerRunRequest, ToolAnswer } from "./cells.contracts"
import { sha256Of } from "./cell-hash.policy"
import {
    CellRunnerClient,
    limitsHeldTo,
    readDirsOf,
    spawnPlanOf,
    type CellRunnerClientOptions,
} from "./cell-runner.client"
import type { RunnerDoor } from "./cell-runner.port"
import { CellsError, CellsErrorCode } from "./errors/cells.error"

/*
 * These specs start the REAL runner process (packages/cell-runner/dist/main.js, built with `npm run build -w @nivo-lite/cell-runner`) with the real
 * QuickJS WebAssembly. Nothing is mocked: the proofs are about the process, the permission flags and the engine.
 */

const ENTRY = resolve(__dirname, "../../../../../packages/cell-runner/dist/main.js")
const CEILING: RunnerLimits = {
    memoryBytes: 64 * 1024 * 1024,
    stackBytes: 1024 * 1024,
    cpuMs: 2000,
    wallMs: 8000,
    outputBytes: 4096,
    maxCalls: 5,
}
const AT = "2026-11-15T08:30:00.000Z"

const options = (over: Partial<CellRunnerClientOptions> = {}): CellRunnerClientOptions => ({
    limits: CEILING,
    poolSize: 2,
    entry: ENTRY,
    readDirs: readDirsOf(ENTRY),
    ...over,
})

const requestOf = (source: string, over: Partial<RunnerRunRequest> = {}): RunnerRunRequest => ({
    type: "run",
    id: "ignored",
    entry: "run",
    source,
    sha256: sha256Of(source),
    input: null,
    facts: { at: AT, day: "2026-11-15", randomSeed: "seed-1", item: null, queue: [], waiting: 0, workspace: {} },
    limits: CEILING,
    ...over,
})

interface Recorded {
    readonly call: number
    readonly tool: string
    readonly args: JsonValue
}

/** A door that answers from a table and records every call. */
const doorOf = (
    answers: Record<string, ToolAnswer> = {},
    delayMs = 0,
): RunnerDoor & { readonly calls: Recorded[]; readonly says: JsonValue[] } => {
    const calls: Recorded[] = []
    const says: JsonValue[] = []
    return {
        calls,
        says,
        call: async (call, tool, args) => {
            calls.push({ call, tool, args })
            if (delayMs > 0) await new Promise((done) => setTimeout(done, delayMs))
            return answers[tool] ?? { ok: false, refusal: "unscripted" }
        },
        say: (_call, request) => {
            says.push(request)
            return Promise.resolve("said")
        },
    }
}

const ASK_TO_PAY = `
function run(input, ctx) {
  const asked = ctx.tool("nivo.tool.payment.request.create", { amountVnd: input.total, reference: input.orderId })
  if (!asked.ok) return ctx.cannot("payment request refused: " + asked.refusal)
  ctx.tool("nivo.tool.customer.message.send", { text: ctx.say("ask the customer to pay", asked.value) })
  return { payKey: asked.value.payKey }
}`
const BANK_CREDIT = `function translate(raw) { return { amount: Number(raw.amount), reference: String(raw.memo).toUpperCase() } }`
const DECLARED = ["nivo.tool.payment.request.create", "nivo.tool.customer.message.send"]

describe("CellRunnerClient (real process, real QuickJS)", () => {
    jest.setTimeout(60_000)
    const clients: CellRunnerClient[] = []
    const clientOf = (over: Partial<CellRunnerClientOptions> = {}): CellRunnerClient => {
        const client = new CellRunnerClient(options(over))
        clients.push(client)
        return client
    }
    afterAll(() => {
        for (const client of clients) client.onModuleDestroy()
    })

    describe("a node source and a translate source", () => {
        it("runs the node source, round-trips both tools to the door and returns the typed output", async () => {
            const door = doorOf({
                "nivo.tool.payment.request.create": { ok: true, value: { payKey: "DH1001" } },
                "nivo.tool.customer.message.send": { ok: true, value: { delivered: true } },
            })
            const result = await clientOf().run(
                { ...requestOf(ASK_TO_PAY, { input: { orderId: "DH1001", total: 350000 } }), declaredTools: DECLARED },
                door,
            )
            expect(result).toMatchObject({ type: "done", output: { payKey: "DH1001" } })
            expect(door.calls).toEqual([
                { call: 1, tool: "nivo.tool.payment.request.create", args: { amountVnd: 350000, reference: "DH1001" } },
                { call: 3, tool: "nivo.tool.customer.message.send", args: { text: "said" } },
            ])
            expect(door.says).toEqual([{ prompt: "ask the customer to pay", data: { payKey: "DH1001" } }])
        })

        it("runs the translate source with no door", async () => {
            const result = await clientOf().run(
                requestOf(BANK_CREDIT, { entry: "translate", input: { amount: "350000", memo: "dh1001" } }),
                {
                    call: () => Promise.reject(new Error("a translate source must not reach the door")),
                    say: () => Promise.reject(new Error("a translate source must not reach the door")),
                },
            )
            expect(result).toMatchObject({ type: "done", output: { amount: 350000, reference: "DH1001" } })
        })

        it("ends with `ended` when the source says it cannot, and hands a tool refusal to the source", async () => {
            const door = doorOf({ "nivo.tool.payment.request.create": { ok: false, refusal: "no_account" } })
            const result = await clientOf().run(
                { ...requestOf(ASK_TO_PAY, { input: { orderId: "A", total: 1 } }), declaredTools: DECLARED },
                door,
            )
            expect(result).toMatchObject({
                type: "ended",
                reason: "cannot",
                why: "payment request refused: no_account",
            })
        })
    })

    describe("the guards of the client", () => {
        it("refuses a tool the cell did not declare, before the door sees it", async () => {
            const door = doorOf()
            const run = clientOf().run(
                {
                    ...requestOf(ASK_TO_PAY, { input: { orderId: "A", total: 1 } }),
                    declaredTools: ["nivo.tool.customer.message.send"],
                },
                door,
            )
            await expect(run).rejects.toMatchObject({
                code: CellsErrorCode.ToolUndeclared,
                params: { tool: "nivo.tool.payment.request.create" },
            })
            expect(door.calls).toEqual([])
        })

        it("treats a cell with no declared tools as one that may call none", async () => {
            const door = doorOf()
            await expect(
                clientOf().run(requestOf(ASK_TO_PAY, { input: { orderId: "A", total: 1 } }), door),
            ).rejects.toBeInstanceOf(CellsError)
            expect(door.calls).toEqual([])
        })

        it("refuses a source whose hash does not match, without starting anything", async () => {
            const door = doorOf()
            const run = clientOf().run(
                { ...requestOf("function run() { return 1 }"), sha256: sha256Of("another text") },
                door,
            )
            await expect(run).rejects.toMatchObject({ code: CellsErrorCode.SourceHashMismatch })
        })

        it("holds every limit of a request to the ceiling of the client", () => {
            expect(limitsHeldTo({ ...CEILING, cpuMs: 10, memoryBytes: 1e12, maxCalls: 0 }, CEILING)).toEqual({
                ...CEILING,
                cpuMs: 10,
            })
        })

        it("ends a run that makes more calls than allowed", async () => {
            const source = `function run(input, ctx) { for (let i = 0; i < 10; i++) ctx.tool("t", i); return 1 }`
            const result = await clientOf().run(
                { ...requestOf(source, { limits: { ...CEILING, maxCalls: 3 } }), declaredTools: ["t"] },
                doorOf({ t: { ok: true, value: 1 } }),
            )
            expect(result).toMatchObject({ type: "failed", why: "limits", detail: "calls" })
        })

        it("does not count the time a tool call takes against the wall clock", async () => {
            const source = `function run(input, ctx) { return ctx.tool("slow", null) }`
            const result = await clientOf().run(
                { ...requestOf(source, { limits: { ...CEILING, wallMs: 1500 } }), declaredTools: ["slow"] },
                doorOf({ slow: { ok: true, value: "late" } }, 2500),
            )
            expect(result).toMatchObject({ type: "done", output: { ok: true, value: "late" } })
        })
    })

    describe("limits end typed within the wall limit", () => {
        const failing = async (
            source: string,
            over: Partial<RunnerRunRequest> = {},
            client = clientOf(),
        ): Promise<unknown> => {
            const started = Date.now()
            const result = await client.run(requestOf(source, over), doorOf())
            expect(Date.now() - started).toBeLessThan(CEILING.wallMs + 3000)
            return result
        }

        it("an endless loop ends as limits (cpu deadline)", async () => {
            expect(
                await failing("function run() { while (true) {} }", { limits: { ...CEILING, cpuMs: 300 } }),
            ).toMatchObject({ type: "failed", why: "limits", detail: "cpu time" })
        })

        it("a loop that swallows every error still ends as limits", async () => {
            const source = "function run() { while (true) { try { while (true) {} } catch (e) {} } }"
            expect(await failing(source, { limits: { ...CEILING, cpuMs: 300 } })).toMatchObject({
                type: "failed",
                why: "limits",
            })
        })

        it("the wall clock kills the process when the cpu deadline is set higher", async () => {
            const client = clientOf({ limits: { ...CEILING, cpuMs: 60_000, wallMs: 700 } })
            expect(
                await failing(
                    "function run() { while (true) {} }",
                    { limits: { ...CEILING, cpuMs: 60_000, wallMs: 700 } },
                    client,
                ),
            ).toMatchObject({
                type: "failed",
                why: "limits",
                detail: "wall clock",
            })
        })

        it("an allocation past the memory limit ends as limits", async () => {
            const source =
                "function run() { const a = []; for (let i = 0; i < 4e7; i++) a.push('x'.repeat(100) + i); return a.length }"
            expect(await failing(source, { limits: { ...CEILING, memoryBytes: 16 * 1024 * 1024 } })).toMatchObject({
                type: "failed",
                why: "limits",
            })
        })

        it("a 200 MB allocation ends as limits under the default limit", async () => {
            expect(
                await failing(
                    "function run() { return new Array(25e6).fill(1).length + new Uint8Array(200 * 1024 * 1024).length }",
                ),
            ).toMatchObject({
                type: "failed",
                why: "limits",
            })
        })

        it("an endless recursion ends as limits", async () => {
            expect(await failing("function f() { return f() + 1 } function run() { return f() }")).toMatchObject({
                type: "failed",
                why: "limits",
            })
        })

        it("an output past the limit ends as failed output", async () => {
            expect(await failing("function run() { return 'x'.repeat(10000) }")).toMatchObject({
                type: "failed",
                why: "output",
            })
        })

        it("an output that is not JSON, or a promise, ends as failed output", async () => {
            expect(await failing("function run() { return () => 1 }")).toMatchObject({ type: "failed", why: "output" })
            expect(await failing("function run() { return Promise.resolve(1) }")).toMatchObject({
                type: "failed",
                why: "output",
            })
            expect(await failing("function run() { const o = {}; o.o = o; return o }")).toMatchObject({
                type: "failed",
                why: "output",
            })
        })

        it("a thrown error and a syntax error end typed", async () => {
            expect(await failing("function run() { throw new Error('boom') }")).toMatchObject({
                type: "failed",
                why: "thrown",
                detail: expect.stringContaining("boom") as string,
            })
            expect(await failing("function run( {")).toMatchObject({ type: "failed", why: "syntax" })
            expect(await failing("const x = 1")).toMatchObject({
                type: "failed",
                why: "output",
                detail: expect.stringContaining("run") as string,
            })
        })
    })

    describe("escape attempts end typed and reach nothing", () => {
        it("sees no process, require, fetch, timers, console, Buffer, env or module loader", async () => {
            const source = `function run() {
                return {
                    types: [typeof process, typeof require, typeof fetch, typeof setTimeout, typeof console, typeof Buffer, typeof module, typeof globalThis.process, typeof WebAssembly, typeof eval, typeof __host_call, typeof __host_say, typeof __cell_install],
                    names: Object.getOwnPropertyNames(globalThis).filter((name) => /^(process|env|require|fetch|Buffer|setTimeout|console|std|os)$/.test(name))
                }
            }`
            const result = await clientOf().run(requestOf(source), doorOf())
            expect(result).toMatchObject({ type: "done", output: { types: Array(13).fill("undefined"), names: [] } })
        })

        it.each([
            ["process", "function run() { return process.env }"],
            ["require", "function run() { return require('fs').readFileSync('x') }"],
            [
                "the constructor chain",
                "function run() { return globalThis.constructor.constructor('return process')() }",
            ],
            ["a function built from text", "function run() { return new Function('return 1')() }"],
            ["indirect eval", "function run() { return (0, eval)('1') }"],
            [
                "a generator constructor",
                "function run() { return Object.getPrototypeOf(function* () {}).constructor('return 1') }",
            ],
            ["fetch", "function run() { return fetch('http://127.0.0.1:1') }"],
        ])("%s ends as a typed thrown failure", async (_name, source) => {
            expect(await clientOf().run(requestOf(source), doorOf())).toMatchObject({ type: "failed", why: "thrown" })
        })

        it("import() yields nothing a source can use", async () => {
            const source = "function run() { const p = import('fs'); return typeof p }"
            const result = await clientOf().run(requestOf(source), doorOf())
            expect(result.type === "done" || result.type === "failed").toBe(true)
            if (result.type === "done") expect(result.output).not.toEqual("fs")
        })

        it("a polluted prototype does not reach the next run", async () => {
            const client = clientOf()
            const first = await client.run(
                requestOf(
                    "function run() { Object.prototype.polluted = 1; Array.prototype.extra = 2; return ({}).polluted }",
                ),
                doorOf(),
            )
            expect(first.type).toBe("done")
            const second = await client.run(
                requestOf("function run() { return [({}).polluted === undefined, [].extra === undefined] }"),
                doorOf(),
            )
            expect(second).toMatchObject({ type: "done", output: [true, true] })
        })
    })

    describe("determinism: the recorded clock and random make a replay make the same calls", () => {
        const source = `function run(input, ctx) {
            const stamp = [Date.now(), new Date().toISOString(), Math.random(), Math.random(), new Date(2020, 0, 1).getFullYear()]
            ctx.tool("t", stamp)
            return stamp
        }`
        it("two runs with the same facts and answers give the same call sequence and output; another seed differs", async () => {
            const client = clientOf()
            const runWith = async (seed: string): Promise<{ readonly calls: Recorded[]; readonly out: unknown }> => {
                const door = doorOf({ t: { ok: true, value: 1 } })
                const result = await client.run(
                    {
                        ...requestOf(source, { facts: { ...requestOf(source).facts, randomSeed: seed } }),
                        declaredTools: ["t"],
                    },
                    door,
                )
                return { calls: door.calls, out: result.type === "done" ? result.output : result }
            }
            const one = await runWith("same")
            const two = await runWith("same")
            const other = await runWith("other")
            expect(two).toEqual(one)
            expect(one.out).toEqual(expect.arrayContaining([Date.parse(AT), AT, 2020]))
            expect(other.out).not.toEqual(one.out)
        })
    })

    describe("the fixture packages: every example of a stored source, through the real runner", () => {
        const FIXTURES = resolve(__dirname, "../../../tests/fixtures/cells")
        interface ExampleFile {
            readonly name: string
            readonly input: JsonValue
            readonly tools?: ReadonlyArray<{ readonly id: string; readonly answer: ToolAnswer }>
            readonly expect: { readonly ok?: JsonValue; readonly ending?: string }
        }
        interface CellYaml {
            readonly source: string
            readonly semantics: { readonly tools?: ReadonlyArray<string> }
            readonly examples: ReadonlyArray<ExampleFile>
        }
        const cells: ReadonlyArray<readonly [string, string, "node" | "trigger"]> = [
            ["demo-money/cells/node/demo.ask-to-pay/v1", "demo.ask-to-pay", "node"],
            ["demo-money/cells/trigger/demo.bank-credit/v1", "demo.bank-credit", "trigger"],
            ["demo-crm-lead/cells/node/demo.file-lead/v1", "demo.file-lead", "node"],
        ]
        it.each(cells)("%s (%s)", async (folder, _key, kind) => {
            const cell = parse(readFileSync(join(FIXTURES, folder, "cell.yaml"), "utf8")) as CellYaml
            const source = readFileSync(join(FIXTURES, folder, cell.source), "utf8")
            expect(cell.examples.length).toBeGreaterThan(0)
            for (const example of cell.examples) {
                const answers = Object.fromEntries((example.tools ?? []).map((tool) => [tool.id, tool.answer]))
                const door = doorOf(answers)
                const result = await clientOf().run(
                    {
                        ...requestOf(source, { entry: kind === "trigger" ? "translate" : "run", input: example.input }),
                        cellKind: kind,
                        declaredTools: cell.semantics.tools ?? [],
                    },
                    door,
                )
                if (example.expect.ok !== undefined)
                    expect(result).toMatchObject({ type: "done", output: example.expect.ok })
                else expect(result).toMatchObject({ type: "ended", reason: "cannot" })
            }
        })
    })

    describe("the guest's wall clock", () => {
        it("is UTC whatever the zone of the host is", async () => {
            const result = await clientOf().run(
                requestOf(
                    "function run() { return [new Date(0).getTimezoneOffset(), new Date(2026, 10, 15, 8).toISOString()] }",
                ),
                doorOf(),
            )
            expect(result).toMatchObject({ type: "done", output: [0, "2026-11-15T08:00:00.000Z"] })
        })
    })

    describe("capabilities by cell kind", () => {
        it("gives a trigger or an operation no way out and a node the tool way", async () => {
            const source = "function run() { return typeof tool + typeof say }"
            const client = clientOf()
            expect(await client.run(requestOf(source, { cellKind: "node" }), doorOf())).toMatchObject({
                type: "done",
                output: "functionfunction",
            })
            expect(await client.run(requestOf(source, { cellKind: "trigger" }), doorOf())).toMatchObject({
                type: "done",
                output: "undefinedundefined",
            })
            expect(await client.run(requestOf(source, { cellKind: "operation" }), doorOf())).toMatchObject({
                type: "done",
                output: "undefinedundefined",
            })
            expect(await client.run(requestOf(source, { cellKind: "core.if" }), doorOf())).toMatchObject({
                type: "done",
                output: "undefinedundefined",
            })
        })
    })

    describe("check", () => {
        it("answers no problem for a script, `imports` for module syntax and `syntax` for a parse error", async () => {
            const client = clientOf()
            expect(await client.check("function run(input, ctx) { return input }")).toEqual([])
            expect(await client.check("import x from 'y'\nfunction run() {}")).toEqual([
                expect.stringMatching(/^imports:/) as string,
            ])
            expect(await client.check("export function run() {}")).toEqual([
                expect.stringMatching(/^imports:/) as string,
            ])
            expect(await client.check("function run( {")).toEqual([expect.stringMatching(/^syntax:/) as string])
        })
    })

    describe("the pool", () => {
        it("serves more runs at once than its size, each in its own process", async () => {
            const client = clientOf({ poolSize: 2 })
            client.warmUp()
            const runs = await Promise.all(
                [1, 2, 3, 4].map((n) => client.run(requestOf(`function run() { return ${String(n)} }`), doorOf())),
            )
            expect(runs.map((r) => (r.type === "done" ? r.output : r))).toEqual([1, 2, 3, 4])
        })
    })

    describe("a broken child ends typed, never a hang", () => {
        const dir = mkdtempSync(join(tmpdir(), "cells-s3-"))
        afterAll(() => {
            // a killed child may still hold its working directory for a moment on Windows; the folder is in the temp area either way
            try {
                rmSync(dir, { recursive: true, force: true })
            } catch {
                // left for the system's temp cleaning
            }
        })
        const brokenWith = (name: string, text: string): CellRunnerClient => {
            const entry = join(dir, name)
            writeFileSync(entry, text)
            return clientOf({ entry, readDirs: [`${dir.replaceAll("\\", "/")}/`] })
        }

        it("a child that exits at once is a crash", async () => {
            await expect(
                brokenWith("exit.js", "process.exit(3)").run(requestOf("function run() {}"), doorOf()),
            ).rejects.toMatchObject({ code: CellsErrorCode.RunnerCrashed })
        })
        it("a child that speaks garbage is a crash", async () => {
            await expect(
                brokenWith("garbage.js", "console.log('not json'); setTimeout(() => {}, 5000)").run(
                    requestOf("function run() {}"),
                    doorOf(),
                ),
            ).rejects.toMatchObject({
                code: CellsErrorCode.RunnerCrashed,
            })
        })
        it("a child that floods stdout is cut off as failed output", async () => {
            const result = await brokenWith(
                "flood.js",
                "process.stdout.write('x'.repeat(6e6)); setTimeout(() => {}, 5000)",
            ).run(requestOf("function run() {}"), doorOf())
            expect(result).toMatchObject({ type: "failed", why: "output" })
        })
        it("a child that never answers ends at the wall clock", async () => {
            const result = await brokenWith("silent.js", "setTimeout(() => {}, 20000)").run(
                requestOf("function run() {}", { limits: { ...CEILING, wallMs: 600 } }),
                doorOf(),
            )
            expect(result).toMatchObject({ type: "failed", why: "limits", detail: "wall clock" })
        })
    })

    describe("a child that lies is cut off, typed", () => {
        const dir = mkdtempSync(join(tmpdir(), "cells-s3-liar-"))
        afterAll(() => {
            try {
                rmSync(dir, { recursive: true, force: true })
            } catch {
                // left for the system's temp cleaning
            }
        })
        let count = 0
        /** A child that reads the request, then runs `body` with `id`, `send(object)` and `raw(text)`; it stays alive afterwards unless the body exits. */
        const liar = (body: string, over: Partial<CellRunnerClientOptions> = {}): CellRunnerClient => {
            count += 1
            const entry = join(dir, `liar${String(count)}.js`)
            writeFileSync(
                entry,
                `const NL = String.fromCharCode(10);
                 const send = (o) => process.stdout.write(JSON.stringify(o) + NL);
                 const raw = (t) => process.stdout.write(t);
                 let text = "";
                 process.stdin.on("data", (d) => { text += d; if (text.includes(NL)) { const first = JSON.parse(text.split(NL)[0]); text = ""; main(first.id) } });
                 const main = (id) => { ${body} };
                 setTimeout(() => {}, 15000)`,
            )
            return clientOf({ entry, readDirs: [`${dir.replaceAll("\\", "/")}/`], ...over })
        }
        const crash = async (
            client: CellRunnerClient,
            door: RunnerDoor = doorOf(),
            request = requestOf("function run() {}"),
        ): Promise<unknown> =>
            client.run({ ...request, declaredTools: ["t"] }, door).then(
                (result) => result,
                (error: unknown) => error,
            )
        const call1 = "send({ type: 'call', id, call: 1, tool: 't', args: null })"

        it.each([
            ["done without an output", "send({ type: 'done', id })", "done without output"],
            ["ended with a bad reason", "send({ type: 'ended', id, reason: 'x', why: 'y' })", "ended badly"],
            ["failed with an unknown kind", "send({ type: 'failed', id, why: 'bogus', detail: 'x' })", "failed badly"],
            ["checked in answer to a run", "send({ type: 'checked', id, problems: [] })", "answered a check to a run"],
            ["an unknown message type", "send({ type: 'weird', id })", "unknown message"],
            ["a message for another run", "send({ type: 'done', id: 'other', output: 1 })", "not ours"],
            ["a message that is not an object", "raw('[1,2]' + NL)", "not ours"],
            [
                "a call numbered badly",
                "send({ type: 'call', id, call: 'x', tool: 't', args: null })",
                "numbered a call badly",
            ],
            ["a call out of order", "send({ type: 'call', id, call: 2, tool: 't', args: null })", "call order"],
            [
                "a call with an empty tool name",
                "send({ type: 'call', id, call: 1, tool: '', args: null })",
                "not a name",
            ],
            [
                "a call with a tool name that is a number",
                "send({ type: 'call', id, call: 1, tool: 7, args: null })",
                "not a name",
            ],
            [
                "two messages while a call is waiting",
                `${call1}; send({ type: 'done', id, output: 1 })`,
                "its call was waiting",
            ],
            ["a line that is not JSON", "raw('nope' + NL)", "not JSON"],
        ])("%s is a crash", async (_name, body, reason) => {
            expect(await crash(liar(body), doorOf({ t: { ok: true, value: 1 } }, 50))).toMatchObject({
                code: CellsErrorCode.RunnerCrashed,
                params: { reason: expect.stringContaining(reason) as string },
            })
        })

        it("a check that asks for the door is a crash, since a check has none", async () => {
            await expect(liar(call1).check("function run() {}")).rejects.toMatchObject({
                code: CellsErrorCode.RunnerCrashed,
                params: { reason: expect.stringContaining("door that this request does not have") as string },
            })
        })

        it("a child that calls past the allowed count is ended as limits by the client too", async () => {
            const result = await crash(liar(call1, { limits: { ...CEILING, maxCalls: 0 } }))
            expect(result).toMatchObject({ type: "failed", why: "limits", detail: "calls" })
        })

        it("a valid answer split over two chunks, after an empty line, is accepted", async () => {
            const body = `raw(NL + '{"type":"ended",'); setTimeout(() => raw('"id":"' + id + '","reason":"cannot","why":"w"}' + NL), 50)`
            expect(await crash(liar(body))).toMatchObject({ type: "ended", why: "w" })
        })

        it("a rejected door call ends the run with the error of the door, for a say as for a call", async () => {
            const down: RunnerDoor = {
                call: () => Promise.reject(new Error("door down")),
                say: () => Promise.reject(new Error("say down")),
            }
            expect(await crash(liar("send({ type: 'say', id, call: 1, request: 1 })"), down)).toMatchObject({
                message: "say down",
            })
            expect(await crash(liar(call1), down)).toMatchObject({ message: "door down" })
        })

        it("the standard error of the child is kept in the crash reason", async () => {
            const error = await crash(liar("console.error('child said this'); process.exit(2)"))
            expect(error).toMatchObject({
                code: CellsErrorCode.RunnerCrashed,
                params: { reason: expect.stringContaining("child said this") as string },
            })
        })

        it("a node binary that does not exist is a crash", async () => {
            const client = liar("send({ type: 'done', id, output: 1 })", { nodeBinary: join(dir, "no-such-node") })
            expect(await crash(client)).toMatchObject({ code: CellsErrorCode.RunnerCrashed })
        })

        it("clips a long detail, ends a check that is answered as something else, and refuses a badly shaped check answer", async () => {
            const long = await crash(liar("send({ type: 'failed', id, why: 'thrown', detail: 'd'.repeat(2000) })"))
            expect(long).toMatchObject({
                type: "failed",
                why: "thrown",
                detail: expect.stringMatching(/^d{500}[.]{3}$/) as string,
            })
            expect(
                await liar("send({ type: 'failed', id, why: 'thrown', detail: 'x' })").check("function run() {}"),
            ).toEqual(["runner: the check ended as failed"])
            await expect(
                liar("send({ type: 'checked', id, problems: 5 })").check("function run() {}"),
            ).rejects.toMatchObject({
                params: { reason: expect.stringContaining("checked badly") as string },
            })
        })

        it("the first terminal message wins when two arrive in one chunk", async () => {
            const body =
                "const line = JSON.stringify({ type: 'ended', id, reason: 'cannot', why: 'first' }) + NL; raw(line + line)"
            expect(await crash(liar(body))).toMatchObject({ type: "ended", why: "first" })
        })

        it("a single line past the size limit is cut off as failed output", async () => {
            expect(await crash(liar("raw('x'.repeat(6000000) + NL)"))).toMatchObject({ type: "failed", why: "output" })
        })

        it("a package resolved outside a node_modules path still grants its own folder", () => {
            const base = mkdtempSync(join(tmpdir(), "cells-s3-links-"))
            try {
                const elsewhere = join(base, "elsewhere", "qjs")
                mkdirSync(elsewhere, { recursive: true })
                writeFileSync(
                    join(elsewhere, "package.json"),
                    JSON.stringify({ name: "quickjs-emscripten", main: "index.js" }),
                )
                writeFileSync(join(elsewhere, "index.js"), "")
                mkdirSync(join(base, "pkg", "dist"), { recursive: true })
                mkdirSync(join(base, "pkg", "node_modules"), { recursive: true })
                symlinkSync(elsewhere, join(base, "pkg", "node_modules", "quickjs-emscripten"), "junction")
                const dirs = readDirsOf(join(base, "pkg", "dist", "main.js"))
                expect(dirs).toContain(`${elsewhere.replaceAll(String.fromCharCode(92), "/")}/`)
            } finally {
                try {
                    rmSync(base, { recursive: true, force: true })
                } catch {
                    // left for the system's temp cleaning
                }
            }
        })

        it("a closed client starts nothing", async () => {
            const client = clientOf()
            client.onModuleDestroy()
            await expect(client.run(requestOf("function run() {}"), doorOf())).rejects.toMatchObject({
                code: CellsErrorCode.RunnerCrashed,
            })
        })

        it("readDirsOf leaves out a package it cannot find", () => {
            expect(readDirsOf("/nowhere/at/all/dist/main.js")).toEqual(["/nowhere/at/all/dist/"])
        })
    })

    describe("the outer layers", () => {
        it("starts the child hidden (no console window on Windows), attached, piped, and these options reach spawn", async () => {
            const plan = spawnPlanOf(options())
            expect(plan.spawnOptions).toMatchObject({
                windowsHide: true,
                detached: false,
                stdio: ["pipe", "pipe", "pipe"],
            })
            const seen: Array<unknown> = []
            const recording = ((
                command: string,
                args: ReadonlyArray<string>,
                spawnOptions: Parameters<typeof spawn>[2],
            ) => {
                seen.push(spawnOptions)
                return spawn(command, args, spawnOptions)
            }) as typeof spawn
            await expect(
                new CellRunnerClient({ ...options(), spawnProcess: recording }).check("function run() { return 1 }"),
            ).resolves.toEqual([])
            expect(seen).toEqual([
                expect.objectContaining({
                    windowsHide: true,
                    detached: false,
                    env: {},
                    stdio: ["pipe", "pipe", "pipe"],
                }),
            ])
        })

        it("starts the child with an empty environment and Node's permission model", () => {
            const plan = spawnPlanOf(options())
            expect(plan.spawnOptions.env).toEqual({})
            expect(plan.args[0]).toBe("--permission")
            expect(
                plan.args
                    .filter((arg) => arg.startsWith("--allow-"))
                    .every((arg) => arg.startsWith("--allow-fs-read=")),
            ).toBe(true)
            expect(plan.args.some((arg) => /allow-(net|child-process|worker|addons|wasi|fs-write)/.test(arg))).toBe(
                false,
            )
            expect(plan.args.at(-1)).toBe(ENTRY)
        })

        it("the child's own Node code cannot read outside the granted paths, run a child process or see our environment", () => {
            const dir = mkdtempSync(join(tmpdir(), "cells-s3-probe-"))
            const secret = join(dir, "secret.txt")
            const probe = join(dir, "probe.js")
            const probeDir = mkdtempSync(join(tmpdir(), "cells-s3-entry-"))
            const entry = join(probeDir, "probe.js")
            writeFileSync(secret, "secret")
            writeFileSync(probe, "")
            writeFileSync(
                entry,
                `const fs = require("node:fs");
                 const out = {};
                 try { fs.readFileSync(${JSON.stringify(secret)}, "utf8"); out.outside = "READ" } catch (e) { out.outside = e.code }
                 try { fs.readFileSync(${JSON.stringify(ENTRY)}, "utf8"); out.granted = "READ" } catch (e) { out.granted = e.code }
                 try { require("node:child_process").execSync("echo x"); out.spawn = "RAN" } catch (e) { out.spawn = e.code }
                 try { fs.writeFileSync(${JSON.stringify(join(dir, "w.txt"))}, "x"); out.write = "WROTE" } catch (e) { out.write = e.code }
                 out.sentinel = process.env.CELLS_S3_SENTINEL === undefined
                 console.log(JSON.stringify(out))`,
            )
            process.env.CELLS_S3_SENTINEL = "must-not-reach-the-child"
            try {
                const plan = spawnPlanOf({ ...options(), entry })
                const ran = spawnSync(plan.command, plan.args, { ...plan.spawnOptions, encoding: "utf8" })
                expect(JSON.parse(ran.stdout)).toEqual({
                    outside: "ERR_ACCESS_DENIED",
                    granted: "READ",
                    spawn: "ERR_ACCESS_DENIED",
                    write: "ERR_ACCESS_DENIED",
                    sentinel: true,
                })
            } finally {
                delete process.env.CELLS_S3_SENTINEL
                rmSync(dir, { recursive: true, force: true })
                rmSync(probeDir, { recursive: true, force: true })
            }
        })
    })
})
