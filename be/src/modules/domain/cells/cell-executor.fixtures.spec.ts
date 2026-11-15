import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { parse } from "yaml"
import { MemoryCellReader, ScriptedCellToolDoor, type ScriptedToolAnswer } from "@tests/fixtures/builders/cells.builder"
import { scopeOf } from "@tests/fixtures/builders/cells-executor.builder"
import type { Clock } from "@modules/platform/clock"
import type { Logger } from "@modules/platform/logging"
import { CellRunnerClient, readDirsOf } from "./cell-runner.client"
import { CellExecutorService, REFUSAL_CLASS_FACT } from "./cell-executor.service"
import { CellExpressionPolicy } from "./cell-expression.policy"
import { CellJsonSchemaPolicy } from "./cell-json-schema.policy"
import type {
    CellDefinitionView,
    CellExample,
    CellKind,
    CellVerdict,
    ExecuteRequest,
    JsonValue,
    RunnerLimits,
} from "./cells.contracts"
import { CellsErrorCode } from "./errors/cells.error"
import { MemoryCellLedgerClient } from "./memory-cell-ledger.client"
import { MemoryCellMeterClient } from "./memory-cell-meter.client"

/*
 * The executor over the REAL fixture packages (S2) and the REAL runner process (S3): rows read from the packages' cell.yaml files, sources from
 * their run.js / translate.js. The reader is the in-memory one (the database reader needs a throwaway database), the tool door is scripted.
 */

const FIXTURES = resolve(__dirname, "../../../tests/fixtures/cells")
const ENTRY = resolve(__dirname, "../../../../../packages/cell-runner/dist/main.js")
const LIMITS: RunnerLimits = {
    memoryBytes: 64 * 1024 * 1024,
    stackBytes: 1024 * 1024,
    cpuMs: 2000,
    wallMs: 8000,
    outputBytes: 4096,
    maxCalls: 10,
}

interface CellYaml {
    readonly kind: CellKind
    readonly key: string
    readonly version: number
    readonly title: { readonly vi: string; readonly en: string }
    readonly input: Record<string, JsonValue>
    readonly output: Record<string, JsonValue>
    readonly config?: Record<string, JsonValue>
    readonly semantics: CellDefinitionView["semantics"]
    readonly body?: Record<string, JsonValue>
    readonly source?: string
    readonly examples?: ReadonlyArray<CellExample>
}

const cellFoldersOf = (packageName: string): ReadonlyArray<string> => {
    const found: Array<string> = []
    const root = join(FIXTURES, packageName, "cells")
    for (const kind of readdirSync(root)) {
        for (const key of readdirSync(join(root, kind))) {
            for (const version of readdirSync(join(root, kind, key))) found.push(join(root, kind, key, version))
        }
    }
    return found
}

interface Built {
    readonly executor: CellExecutorService
    readonly door: ScriptedCellToolDoor
    readonly meter: MemoryCellMeterClient
    readonly reader: MemoryCellReader
    readonly views: ReadonlyMap<string, CellDefinitionView>
}

const build = (packageName: string, answers: Readonly<Record<string, ScriptedToolAnswer>> = {}): Built => {
    const reader = new MemoryCellReader()
    const views = new Map<string, CellDefinitionView>()
    for (const folder of cellFoldersOf(packageName)) {
        const cell = parse(readFileSync(join(folder, "cell.yaml"), "utf8")) as CellYaml
        const sourceSha256 =
            cell.source === undefined ? null : reader.addSource(readFileSync(join(folder, cell.source), "utf8")).sha256
        const view: CellDefinitionView = {
            kind: cell.kind,
            key: cell.key,
            version: cell.version,
            id: `${cell.kind}-${cell.key}`,
            packageKey: packageName,
            title: cell.title,
            inputSchema: cell.input,
            outputSchema: cell.output,
            configSchema: cell.config ?? {},
            semantics: cell.semantics,
            body: cell.body ?? {},
            sourceSha256,
            examples: cell.examples ?? [],
            definitionHash: "fixture",
            reviewState: "approved",
            deleted: false,
        }
        reader.addDefinition(view)
        views.set(cell.key, view)
    }
    const door = new ScriptedCellToolDoor(answers)
    const meter = new MemoryCellMeterClient()
    const clock: Clock = { now: () => new Date("2026-11-15T08:30:00.000Z") }
    const logger: Logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    const runner = new CellRunnerClient({ limits: LIMITS, poolSize: 1, entry: ENTRY, readDirs: readDirsOf(ENTRY) })
    const executor = new CellExecutorService(
        reader,
        runner,
        new MemoryCellLedgerClient(),
        meter,
        door,
        { runnerLimits: LIMITS, runnerPoolSize: 1, runnerEntry: "" },
        clock,
        logger,
        new CellExpressionPolicy(),
        new CellJsonSchemaPolicy(),
    )
    return { executor, door, meter, reader, views }
}

const view = (built: Built, key: string): CellDefinitionView => {
    const found = built.views.get(key)
    if (found === undefined) throw new Error(`fixture cell ${key} is missing`)
    return found
}

const requestOf = (cell: CellDefinitionView, input: JsonValue, over: Partial<ExecuteRequest> = {}): ExecuteRequest => ({
    scope: scopeOf(),
    cell: { kind: cell.kind, key: cell.key, version: cell.version },
    input,
    ...over,
})

const verdictOfExecution = async (built: Built, key: string, input: JsonValue): Promise<CellVerdict> =>
    (await built.executor.execute(requestOf(view(built, key), input))).verdict

describe.each(["demo-money", "demo-crm-lead"])(
    "CellExecutorService over the %s fixture package and the real runner",
    (packageName) => {
        it("runs every example of every stored-source cell through the executor: ok continues, a business ending is unsuccessful", async () => {
            let proven = 0
            for (const folder of cellFoldersOf(packageName)) {
                const cell = parse(readFileSync(join(folder, "cell.yaml"), "utf8")) as CellYaml
                if (cell.source === undefined) continue
                for (const example of cell.examples ?? []) {
                    const answers = Object.fromEntries((example.tools ?? []).map((tool) => [tool.id, tool.answer]))
                    const built = build(packageName, answers)
                    const result = await built.executor.execute(requestOf(view(built, cell.key), example.input))
                    if ("ok" in example.expect) {
                        expect(result.outcome).toEqual({ kind: "ok", output: example.expect.ok })
                        expect(result.verdict).toEqual({ kind: "continue" })
                    } else {
                        expect(result.outcome).toMatchObject({ kind: "ending", reason: "cannot" })
                        expect(result.verdict).toEqual({ kind: "unsuccessful", reason: "cannot" })
                    }
                    proven += 1
                }
            }
            expect(proven).toBeGreaterThan(0)
        }, 120_000)

        it("refuses an input outside the schema of a stored-source cell before the runner starts", async () => {
            const key = packageName === "demo-money" ? "demo.ask-to-pay" : "demo.file-lead"
            const built = build(packageName)
            await expect(built.executor.execute(requestOf(view(built, key), { nothing: true }))).rejects.toMatchObject({
                code: CellsErrorCode.InputInvalid,
            })
            expect(built.door.calls).toEqual([])
        })

        it("ends typed when a stored source reaches for a tool its cell did not declare (the real client refuses it)", async () => {
            const key = packageName === "demo-money" ? "demo.ask-to-pay" : "demo.file-lead"
            const built = build(packageName, { "nivo.tool.secret.read": { ok: true, value: "secret" } })
            const cell = view(built, key)
            const source = built.reader.addSource(
                'function run(input, ctx) { ctx.tool("nivo.tool.secret.read", {}); return { leaked: true } }',
            )
            built.reader.addDefinition({ ...cell, sourceSha256: source.sha256 })
            const result = await built.executor.execute(requestOf(cell, example(packageName)))
            expect(result.outcome).toMatchObject({
                kind: "failed",
                why: "permanent",
                cause: { code: CellsErrorCode.ToolUndeclared },
            })
            expect(result.verdict).toEqual({ kind: "stop", why: "failed" })
            expect(built.door.calls).toEqual([])
        }, 60_000)
    },
)

/** An input that fits the node of each package. */
const example = (packageName: string): JsonValue =>
    packageName === "demo-money"
        ? { orderId: "DH1001", total: 350000 }
        : { recordId: "R1", name: "Lan", email: "lan@example.test" }

describe("demo-money: the verdict table over its real rows (outside write, not repeatable, settled by a read)", () => {
    const input = { amountVnd: 350000, reference: "DH1001" }
    const KEY = "nivo.tool.payment.request.create"

    it.each<readonly [string, ScriptedToolAnswer, CellVerdict]>([
        ["ok", { ok: true, value: { payKey: "DH1001" } }, { kind: "continue" }],
        [
            "a non-final refusal of an outside write",
            { ok: false, refusal: "amount_invalid" },
            { kind: "stop", why: "act_refused" },
        ],
        [
            "a final refusal",
            { ok: false, refusal: "account_closed" },
            { kind: "unsuccessful", reason: "account_closed" },
        ],
        [
            "a transient answer",
            { ok: false, refusal: "http_503", facts: { [REFUSAL_CLASS_FACT]: "transient" } },
            { kind: "retry" },
        ],
        [
            "an unknown outcome is confirmed by the declared read",
            { ok: false, refusal: "timeout", facts: { [REFUSAL_CLASS_FACT]: "unknown" } },
            {
                kind: "confirm",
                read: {
                    tool: "nivo.tool.payment.request.read",
                    args: { payKey: { from: "args", member: "reference" } },
                },
            },
        ],
        [
            "an answer the output schema refuses is unknown, so confirmed",
            { ok: true, value: { wrong: 1 } },
            {
                kind: "confirm",
                read: {
                    tool: "nivo.tool.payment.request.read",
                    args: { payKey: { from: "args", member: "reference" } },
                },
            },
        ],
        ["a refusal nobody declared", { ok: false, refusal: "mystery" }, { kind: "stop", why: "failed" }],
    ])("%s", async (_label, answer, expected) => {
        const built = build("demo-money", { [KEY]: answer })
        expect(await verdictOfExecution(built, KEY, input)).toEqual(expected)
    })

    it("a repeat under the same key answers the recorded result: one act", async () => {
        const built = build("demo-money", { [KEY]: { ok: true, value: { payKey: "DH1001" } } })
        await verdictOfExecution(built, KEY, input)
        const again = await built.executor.execute(requestOf(view(built, KEY), input))
        expect(again.outcome).toEqual({ kind: "ok", output: { payKey: "DH1001" } })
        expect(built.door.calls).toHaveLength(1)
        expect(built.door.calls[0]?.callKey).toMatch(/^run-1:step-1:[0-9a-f]{64}$/)
    })

    it("an input outside the schema is refused before the door", async () => {
        const built = build("demo-money", { [KEY]: { ok: true, value: { payKey: "x" } } })
        await expect(
            built.executor.execute(requestOf(view(built, KEY), { amountVnd: 0, reference: "r" })),
        ).rejects.toMatchObject({ code: CellsErrorCode.InputInvalid })
        expect(built.door.calls).toEqual([])
    })

    it("core.if over the money rows: the paid amount takes the yes branch", async () => {
        const built = build("demo-money")
        const result = await built.executor.execute(
            requestOf(
                view(built, "core.if"),
                { trigger: { amountVnd: 350000 }, steps: {}, vars: {}, item: null },
                {
                    config: {
                        when: { op: "gte", ref: { $ref: "trigger.amountVnd" }, value: 300000 },
                        yes: "ask",
                        no: "end",
                    },
                },
            ),
        )
        expect(result.outcome).toEqual({ kind: "ok", output: { truth: true, branch: "yes", next: "ask" } })
    })

    it("core.set over the money rows: the variables update names the step and the instant", async () => {
        const built = build("demo-money")
        const result = await built.executor.execute(
            requestOf(
                view(built, "core.set"),
                { trigger: { amountVnd: 350000 }, steps: {}, vars: {}, item: null },
                {
                    scope: scopeOf({ stepKey: "remember" }),
                    config: { set: { paid: { op: "gte", ref: { $ref: "trigger.amountVnd" }, value: 300000 } } },
                },
            ),
        )
        expect(result.outcome).toEqual({
            kind: "ok",
            output: { vars: { paid: { value: true, by: "remember", at: "2026-11-15T08:30:00.000Z" } } },
        })
    })
})

describe("demo-crm-lead: the verdict table over its real rows (repeatable write with a replay key, inside write, metered)", () => {
    const lead = { name: "Lan", email: "lan@example.test" }
    const LEAD = "nivo.tool.crm.lead.create"

    it.each<readonly [string, string, JsonValue, ScriptedToolAnswer, CellVerdict]>([
        ["ok", LEAD, lead, { ok: true, value: { leadId: "L1" } }, { kind: "continue" }],
        [
            "a final refusal",
            LEAD,
            lead,
            { ok: false, refusal: "invalid_lead" },
            { kind: "unsuccessful", reason: "invalid_lead" },
        ],
        [
            "a transient answer",
            LEAD,
            lead,
            { ok: false, refusal: "http_503", facts: { [REFUSAL_CLASS_FACT]: "transient" } },
            { kind: "retry" },
        ],
        [
            "an inside write that refuses continues",
            "nivo.tool.record.update",
            { recordId: "R1", fields: {} },
            { ok: false, refusal: "record_locked" },
            { kind: "continue" },
        ],
    ])("%s", async (_label, key, input, answer, expected) => {
        const built = build("demo-crm-lead", { [key]: answer })
        expect(await verdictOfExecution(built, key, input)).toEqual(expected)
    })

    it("an unknown outcome of the repeatable write repeats the same key, and the repeat acts again", async () => {
        let sent = 0
        const built = build("demo-crm-lead", {
            [LEAD]: () => {
                sent += 1
                return sent === 1
                    ? { ok: false, refusal: "timeout", facts: { [REFUSAL_CLASS_FACT]: "unknown" } }
                    : { ok: true, value: { leadId: "L1" } }
            },
        })
        const first = await built.executor.execute(requestOf(view(built, LEAD), lead))
        expect(first.verdict.kind).toBe("repeat")
        const repeated = await built.executor.execute(requestOf(view(built, LEAD), lead))
        expect(repeated.outcome).toEqual({ kind: "ok", output: { leadId: "L1" } })
        expect(built.door.calls.map((call) => call.callKey)).toEqual([
            built.door.calls[0]?.callKey,
            built.door.calls[0]?.callKey,
        ])
        expect(first.verdict).toEqual({ kind: "repeat", key: built.door.calls[0]?.callKey })
    })

    it("the metered model tool: an empty pool stops, a funded run books what its envelope reported, a failed try is never billed", async () => {
        const MODEL = "demo.model.complete"
        const empty = build("demo-crm-lead", { [MODEL]: { ok: true, value: { text: "hi" } } })
        expect(await verdictOfExecution(empty, MODEL, { prompt: "p" })).toEqual({
            kind: "stop",
            why: "credits_exhausted",
        })
        expect(empty.door.calls).toEqual([])
        expect(empty.meter.bookings()).toEqual([])

        const funded = build("demo-crm-lead", {
            [MODEL]: { ok: true, value: { text: "hi" }, usage: { units: 90, unit: "token" } },
        })
        funded.meter.fund("ws-1", 500)
        expect(await verdictOfExecution(funded, MODEL, { prompt: "p" })).toEqual({ kind: "continue" })
        expect(funded.meter.bookings().map((booking) => [booking.usage.units, booking.billed])).toEqual([[90, true]])
        expect(funded.meter.balanceOf("ws-1")).toBe(410)

        const failed = build("demo-crm-lead", { [MODEL]: { ok: true, value: { nope: 1 } } })
        failed.meter.fund("ws-1", 500)
        expect(await verdictOfExecution(failed, MODEL, { prompt: "p" })).toEqual({ kind: "stop", why: "failed" })
        expect(failed.meter.bookings().map((booking) => [booking.usage.units, booking.billed])).toEqual([[0, false]])
        expect(failed.meter.balanceOf("ws-1")).toBe(500)
    })
})

describe("the existence of the fixtures the specs above read", () => {
    it("has both packages and the built runner", () => {
        expect(existsSync(join(FIXTURES, "demo-money", "cells.package.yaml"))).toBe(true)
        expect(existsSync(join(FIXTURES, "demo-crm-lead", "cells.package.yaml"))).toBe(true)
        expect(existsSync(ENTRY)).toBe(true)
    })
})
