import {
    MemoryCellReader,
    ScriptedCellRunner,
    ScriptedCellToolDoor,
    type ScriptedRunnerRun,
    type ScriptedToolAnswer,
} from "@tests/fixtures/builders/cells.builder"
import { controlCells, crmCells, definitionOf, moneyCells, scopeOf } from "@tests/fixtures/builders/cells-executor.builder"
import type { Clock } from "@modules/platform/clock"
import type { Logger } from "@modules/platform/logging"
import type { CellLedger } from "./cell-ledger.port"
import type { CellDefinitionView, CellOutcome, ExecuteRequest, ExecuteResult, JsonValue, RunnerLimits } from "./cells.contracts"
import { CELL_CAUSE, CellExecutorService, REFUSAL_CLASS_FACT } from "./cell-executor.service"
import { CellExpressionPolicy } from "./cell-expression.policy"
import { CellJsonSchemaPolicy } from "./cell-json-schema.policy"
import { CREDITS_EXHAUSTED_CODE } from "./cell-verdict.policy"
import { CellsLogEvent } from "./cells.log-events"
import { CellsError, CellsErrorCode } from "./errors/cells.error"
import { MemoryCellLedgerClient } from "./memory-cell-ledger.client"
import { MemoryCellMeterClient } from "./memory-cell-meter.client"

const LIMITS: RunnerLimits = { memoryBytes: 64 << 20, stackBytes: 1 << 20, cpuMs: 2000, wallMs: 10_000, outputBytes: 262_144, maxCalls: 50 }
const NOW = "2026-11-15T01:00:00.000Z"

interface World {
    readonly executor: CellExecutorService
    readonly reader: MemoryCellReader
    readonly runner: ScriptedCellRunner
    readonly door: ScriptedCellToolDoor
    readonly ledger: MemoryCellLedgerClient
    readonly meter: MemoryCellMeterClient
    readonly logger: Logger
    readonly events: Array<string>
    readonly now: jest.Mock<Date, []>
}

const worldOf = (answers: Readonly<Record<string, ScriptedToolAnswer>> = {}, handler?: ScriptedRunnerRun): World => {
    const reader = new MemoryCellReader()
    const events: Array<string> = []
    const runner = new ScriptedCellRunner(handler)
    const door = new ScriptedCellToolDoor(
        Object.fromEntries(
            Object.entries(answers).map(([tool, answer]) => [
                tool,
                (args: JsonValue) => {
                    events.push(`run:${tool}`)
                    return typeof answer === "function" ? answer(args) : answer
                },
            ]),
        ),
    )
    const real = new MemoryCellLedgerClient()
    const ledger: CellLedger = {
        once: (key, act) => {
            events.push("intent")
            return real.once(key, act)
        },
    }
    const meter = new MemoryCellMeterClient()
    const now = jest.fn((): Date => new Date(NOW))
    const clock: Clock = { now }
    const logger: Logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    const executor = new CellExecutorService(reader, runner, ledger, meter, door, LIMITS, clock, logger, new CellExpressionPolicy(), new CellJsonSchemaPolicy())
    return { executor, reader, runner, door, ledger: real, meter, logger, events, now }
}

/** Adds a definition (with its source text when it has a stored source) and answers the row a request names. */
const add = (world: World, view: CellDefinitionView, source?: string): CellDefinitionView => {
    const sourceSha256 = source === undefined ? view.sourceSha256 : world.reader.addSource(source).sha256
    return world.reader.addDefinition({ ...view, sourceSha256: source === undefined && view.sourceSha256 === "to-be-set" ? null : sourceSha256 })
}

const request = (view: CellDefinitionView, input: JsonValue, over: Partial<ExecuteRequest> = {}): ExecuteRequest => ({
    scope: scopeOf(),
    cell: { kind: view.kind, key: view.key, version: view.version },
    input,
    ...over,
})

const payInput = { payKey: "DH1001", amount: 350000 }
const leadInput = { name: "An" }
const created: ScriptedToolAnswer = { ok: true, value: { payKey: "DH1001" } }

const outcomeKind = (result: ExecuteResult): CellOutcome["kind"] => result.outcome.kind

describe("CellExecutorService on demo-money (an outside write, not repeatable, settled by a read)", () => {
    it("runs a declarative cell and goes on: intent first, then the run, outcome ok, verdict continue", async () => {
        const world = worldOf({ [moneyCells.create.key]: created })
        add(world, moneyCells.create)
        const result = await world.executor.execute(request(moneyCells.create, payInput))
        expect(result.outcome).toEqual({ kind: "ok", output: { payKey: "DH1001" } })
        expect(result.verdict).toEqual({ kind: "continue" })
        expect(world.events).toEqual(["intent", `run:${moneyCells.create.key}`])
        expect(world.door.calls).toHaveLength(1)
        expect(world.door.calls[0]?.scope).toEqual(scopeOf())
        expect(world.logger.info).toHaveBeenCalledWith(
            CellsLogEvent.Executed,
            expect.objectContaining({ outcome: "ok", verdict: "continue", runId: "run-1", stepKey: "step-1" }),
        )
    })

    it("a repeat under the same key returns the recorded result without running again", async () => {
        const world = worldOf({ [moneyCells.create.key]: created })
        add(world, moneyCells.create)
        await world.executor.execute(request(moneyCells.create, payInput))
        const again = await world.executor.execute(request(moneyCells.create, payInput))
        expect(again.outcome).toEqual({ kind: "ok", output: { payKey: "DH1001" } })
        expect(again.calls).toEqual([])
        expect(world.door.calls).toHaveLength(1)
        expect(world.logger.info).toHaveBeenCalledWith(CellsLogEvent.Replayed, expect.objectContaining({ stepKey: "step-1" }))
    })

    it("a read has no intent: it runs each time", async () => {
        const world = worldOf({ [moneyCells.read.key]: { ok: true, value: { status: "open" } } })
        add(world, moneyCells.read)
        await world.executor.execute(request(moneyCells.read, { payKey: "DH1001" }))
        await world.executor.execute(request(moneyCells.read, { payKey: "DH1001" }))
        expect(world.door.calls).toHaveLength(2)
        expect(world.events).toEqual([`run:${moneyCells.read.key}`, `run:${moneyCells.read.key}`])
    })

    it("refuses an input outside its schema before anything runs: no intent, no door call", async () => {
        const world = worldOf({ [moneyCells.create.key]: created })
        add(world, moneyCells.create)
        await expect(world.executor.execute(request(moneyCells.create, { payKey: 5, amount: 1 }))).rejects.toMatchObject({
            code: CellsErrorCode.InputInvalid,
            params: { path: "/payKey" },
        })
        await expect(world.executor.execute(request(moneyCells.create, "text"))).rejects.toMatchObject({ code: CellsErrorCode.InputInvalid, params: { path: "/" } })
        expect(world.events).toEqual([])
        expect(world.door.calls).toEqual([])
    })

    it("refuses a config outside the config schema", async () => {
        const world = worldOf()
        const strict = add(world, definitionOf({ kind: "tool", key: "demo.configured", version: 1 }, { configSchema: { type: "object", required: ["mode"], properties: { mode: { type: "string" } } } }))
        await expect(world.executor.execute(request(strict, {}, { config: {} }))).rejects.toMatchObject({
            code: CellsErrorCode.InputInvalid,
            params: { path: "config/" },
        })
    })

    it("an unknown or unpublished cell is CELLS_UNKNOWN", async () => {
        const world = worldOf()
        await expect(world.executor.execute(request(moneyCells.create, payInput))).rejects.toMatchObject({ code: CellsErrorCode.Unknown })
        add(world, { ...moneyCells.create, reviewState: "draft" })
        await expect(world.executor.execute(request(moneyCells.create, payInput))).rejects.toMatchObject({ code: CellsErrorCode.Unknown })
    })

    it("a retired cell still runs: a pinned run finishes", async () => {
        const world = worldOf({ [moneyCells.create.key]: created })
        add(world, { ...moneyCells.create, reviewState: "retired" })
        const result = await world.executor.execute(request(moneyCells.create, payInput))
        expect(result.verdict).toEqual({ kind: "continue" })
    })

    it("a final refusal ends unsuccessful and is kept: the same key answers it again without acting", async () => {
        const world = worldOf({ [moneyCells.create.key]: { ok: false, refusal: "amount_invalid" } })
        add(world, moneyCells.create)
        const first = await world.executor.execute(request(moneyCells.create, payInput))
        expect(first.outcome).toEqual({ kind: "refused-final", code: "amount_invalid" })
        expect(first.verdict).toEqual({ kind: "unsuccessful", reason: "amount_invalid" })
        await world.executor.execute(request(moneyCells.create, payInput))
        expect(world.door.calls).toHaveLength(1)
    })

    it("a refusal of an outside write is one stop; the key is released so Retry acts again", async () => {
        const world = worldOf({ [moneyCells.create.key]: { ok: false, refusal: "bank_declined", facts: { bank: "x" } } })
        add(world, moneyCells.create)
        const first = await world.executor.execute(request(moneyCells.create, payInput))
        expect(first.outcome).toEqual({ kind: "refused", code: "bank_declined", facts: { bank: "x" } })
        expect(first.verdict).toEqual({ kind: "stop", why: "act_refused" })
        await world.executor.execute(request(moneyCells.create, payInput))
        expect(world.door.calls).toHaveLength(2)
    })

    it("an undeclared refusal code ends typed: failed, CELLS_REFUSAL_UNDECLARED, a stop", async () => {
        const world = worldOf({ [moneyCells.create.key]: { ok: false, refusal: "mystery" } })
        add(world, moneyCells.create)
        const result = await world.executor.execute(request(moneyCells.create, payInput))
        expect(result.outcome).toEqual({ kind: "failed", why: "permanent", cause: { code: CellsErrorCode.RefusalUndeclared, detail: "mystery" } })
        expect(result.verdict).toEqual({ kind: "stop", why: "failed" })
    })

    it("a transient answer retries and releases the key", async () => {
        const world = worldOf({ [moneyCells.create.key]: { ok: false, refusal: "http_503", facts: { [REFUSAL_CLASS_FACT]: "transient" } } })
        add(world, moneyCells.create)
        const first = await world.executor.execute(request(moneyCells.create, payInput))
        expect(first.outcome).toEqual({ kind: "transient", cause: { code: "http_503" } })
        expect(first.verdict).toEqual({ kind: "retry" })
        await world.executor.execute(request(moneyCells.create, payInput))
        expect(world.door.calls).toHaveLength(2)
    })

    it("an unknown outcome is confirmed by the declared read, and the key stays open: it never acts again by itself", async () => {
        const world = worldOf({ [moneyCells.create.key]: { ok: false, refusal: "timeout", facts: { [REFUSAL_CLASS_FACT]: "unknown" } } })
        add(world, moneyCells.create)
        const first = await world.executor.execute(request(moneyCells.create, payInput))
        expect(first.outcome.kind).toBe("unknown")
        expect(first.verdict).toEqual({
            kind: "confirm",
            read: { tool: "nivo.tool.payment.request.read", args: { payKey: { from: "args", member: "payKey" } } },
        })
        const again = await world.executor.execute(request(moneyCells.create, payInput))
        expect(outcomeKind(again)).toBe("unknown")
        expect(again.verdict.kind).toBe("confirm")
        expect(world.door.calls).toHaveLength(1)
    })

    it("an unknown outcome of a write that declares neither repeatable nor confirmBy stops for a person", async () => {
        const world = worldOf({ "demo.bare": { ok: false, refusal: "timeout", facts: { [REFUSAL_CLASS_FACT]: "unknown" } } })
        const bare = add(world, definitionOf({ kind: "tool", key: "demo.bare", version: 1 }, { semantics: { mutates: true } }))
        const result = await world.executor.execute(request(bare, {}))
        expect(result.verdict).toEqual({ kind: "stop", why: "outcome_unknown", retry: "after_take_over" })
    })

    it("an output outside the schema of an outside write is unknown (it happened, its answer cannot be read)", async () => {
        const world = worldOf({ [moneyCells.create.key]: { ok: true, value: { nope: 1 } } })
        add(world, moneyCells.create)
        const result = await world.executor.execute(request(moneyCells.create, payInput))
        expect(outcomeKind(result)).toBe("unknown")
        expect(result.verdict.kind).toBe("confirm")
    })

    it("an output outside the schema of a read is failed permanent", async () => {
        const world = worldOf({ "demo.reader": { ok: true, value: "text" } })
        const reader = add(world, definitionOf({ kind: "tool", key: "demo.reader", version: 1 }, { outputSchema: { type: "object" } }))
        const result = await world.executor.execute(request(reader, {}))
        expect(result.outcome).toEqual({ kind: "failed", why: "permanent", cause: { code: CellsErrorCode.OutputInvalid, detail: "/" } })
        expect(result.verdict).toEqual({ kind: "stop", why: "failed" })
    })

    it("a throw from the door is classed by typed members: outcomeUnknown, transient, anything else failed", async () => {
        const thrower = (cause: unknown): ScriptedToolAnswer => () => {
            throw cause
        }
        const unknown = Object.assign(new Error("lost"), { outcomeUnknown: 1 })
        const transient = Object.assign(new Error("busy"), { transient: true })
        const cases: ReadonlyArray<readonly [unknown, CellOutcome["kind"]]> = [
            [unknown, "unknown"],
            [transient, "transient"],
            [new Error("boom"), "failed"],
            [new CellsError({ code: CellsErrorCode.RunnerLimits, params: { ref: "x", limit: "cpu" } }), "failed"],
            [new CellsError({ code: CellsErrorCode.Unknown, params: { ref: "x" } }), "failed"],
            [new CellsError({ code: CellsErrorCode.RunnerCrashed, params: { ref: "x" } }), "transient"],
        ]
        for (const [cause, kind] of cases) {
            const world = worldOf({ [moneyCells.create.key]: thrower(cause) })
            add(world, moneyCells.create)
            const result = await world.executor.execute(request(moneyCells.create, payInput))
            expect(outcomeKind(result)).toBe(kind)
        }
    })
})

describe("CellExecutorService on demo-crm-lead (repeatable write with a replay key, inside write, metered)", () => {
    it("an unknown outcome of a repeatable write repeats the SAME key, and the repeat acts again", async () => {
        let sent = 0
        const world = worldOf({
            [crmCells.createLead.key]: () => {
                sent += 1
                return sent === 1 ? { ok: false, refusal: "timeout", facts: { [REFUSAL_CLASS_FACT]: "unknown" } } : { ok: true, value: { leadId: "L1" } }
            },
        })
        add(world, crmCells.createLead)
        const first = await world.executor.execute(request(crmCells.createLead, leadInput))
        expect(first.outcome.kind).toBe("unknown")
        expect(first.verdict.kind).toBe("repeat")
        const key = first.verdict.kind === "repeat" ? first.verdict.key : ""
        expect(key).toMatch(/^run-1:step-1:[0-9a-f]{64}$/)
        const repeated = await world.executor.execute(request(crmCells.createLead, leadInput))
        expect(repeated.outcome).toEqual({ kind: "ok", output: { leadId: "L1" } })
        expect(world.door.calls).toHaveLength(2)
        const third = await world.executor.execute(request(crmCells.createLead, leadInput))
        expect(third.calls).toEqual([])
        expect(world.door.calls).toHaveLength(2)
    })

    it("the key follows the content: other input, other step or other run is another act", async () => {
        const world = worldOf({ [crmCells.createLead.key]: { ok: true, value: { leadId: "L1" } } })
        add(world, crmCells.createLead)
        await world.executor.execute(request(crmCells.createLead, leadInput))
        await world.executor.execute(request(crmCells.createLead, { name: "Binh" }))
        await world.executor.execute({ ...request(crmCells.createLead, leadInput), scope: scopeOf({ stepKey: "step-2" }) })
        await world.executor.execute({ ...request(crmCells.createLead, leadInput), scope: scopeOf({ runId: "run-2" }) })
        expect(world.door.calls).toHaveLength(4)
    })

    it("a refusal of an inside write continues; a final one of the repeatable write ends unsuccessful", async () => {
        const world = worldOf({
            [crmCells.updateRecord.key]: { ok: false, refusal: "row_locked" },
            [crmCells.createLead.key]: { ok: false, refusal: "lead_duplicate" },
        })
        add(world, crmCells.updateRecord)
        add(world, crmCells.createLead)
        const inside = await world.executor.execute(request(crmCells.updateRecord, {}))
        expect(inside.outcome.kind).toBe("refused")
        expect(inside.verdict).toEqual({ kind: "continue" })
        const dup = await world.executor.execute(request(crmCells.createLead, leadInput))
        expect(dup.verdict).toEqual({ kind: "unsuccessful", reason: "lead_duplicate" })
    })

    it("a metered cell with an empty pool stops with credits_exhausted: nothing runs, nothing is booked", async () => {
        const world = worldOf({ [crmCells.complete.key]: { ok: true, value: { text: "hi" } } })
        add(world, crmCells.complete)
        const result = await world.executor.execute(request(crmCells.complete, { prompt: "hello" }))
        expect(result.outcome).toEqual({ kind: "failed", why: "limits", cause: { code: CREDITS_EXHAUSTED_CODE } })
        expect(result.verdict).toEqual({ kind: "stop", why: "credits_exhausted" })
        expect(world.door.calls).toEqual([])
        expect(world.meter.bookings()).toEqual([])
        expect(world.logger.warn).toHaveBeenCalledWith(CellsLogEvent.CreditsExhausted, expect.objectContaining({ workspaceId: "ws-1" }))
    })

    it("a metered run books the usage it reported and draws the pool down", async () => {
        const world = worldOf({ [crmCells.complete.key]: { ok: true, value: { text: "hi" }, usage: { units: 120, unit: "token" } } })
        add(world, crmCells.complete)
        world.meter.fund("ws-1", 1000)
        const result = await world.executor.execute(request(crmCells.complete, { prompt: "hello" }))
        expect(result.verdict).toEqual({ kind: "continue" })
        expect(world.meter.bookings()).toEqual([
            { workspaceId: "ws-1", cell: { kind: "tool", key: "demo.model.complete", version: 1 }, usage: { units: 120 }, billed: true },
        ])
        expect(world.meter.balanceOf("ws-1")).toBe(880)
    })

    it("a failed try of a metered cell is booked and never billed", async () => {
        const world = worldOf({ [crmCells.complete.key]: { ok: false, refusal: "model_busy" } })
        add(world, crmCells.complete)
        world.meter.fund("ws-1", 1000)
        const result = await world.executor.execute(request(crmCells.complete, { prompt: "hello" }))
        expect(result.outcome.kind).toBe("refused")
        expect(world.meter.bookings()).toEqual([
            { workspaceId: "ws-1", cell: { kind: "tool", key: "demo.model.complete", version: 1 }, usage: { units: 0 }, billed: false },
        ])
        expect(world.meter.balanceOf("ws-1")).toBe(1000)
    })

    it("a fixed price per unit books one unit at that price; a reported price with no figures books zero", async () => {
        const world = worldOf({ "demo.fixed": { ok: true, value: {} }, "demo.silent": { ok: true, value: { text: "x", usage: "n/a" } } })
        const fixed = add(world, definitionOf({ kind: "tool", key: "demo.fixed", version: 1 }, { semantics: { mutates: false, metered: { usage: "units", price: { usdPerUnit: 0.01 } } } }))
        const silent = add(world, definitionOf({ kind: "tool", key: "demo.silent", version: 1 }, { semantics: { mutates: false, metered: { usage: "tokens", price: "reported" } } }))
        world.meter.fund("ws-1", 10)
        await world.executor.execute(request(fixed, {}))
        await world.executor.execute(request(silent, {}))
        expect(world.meter.bookings().map((booking) => booking.usage)).toEqual([{ units: 1, usd: 0.01 }, { units: 0 }])
    })

    it("a sandbox world is not metered", async () => {
        const world = worldOf({ [crmCells.complete.key]: { ok: true, value: { text: "hi" } } })
        add(world, crmCells.complete)
        const result = await world.executor.execute({ ...request(crmCells.complete, { prompt: "p" }), scope: scopeOf({ world: "sandbox" }) })
        expect(result.verdict).toEqual({ kind: "continue" })
        expect(world.meter.bookings()).toEqual([])
    })

    it("a booking that fails is logged and the answer is kept", async () => {
        const world = worldOf({ [crmCells.complete.key]: { ok: true, value: { text: "hi" } } })
        add(world, crmCells.complete)
        world.meter.fund("ws-1", 10)
        jest.spyOn(world.meter, "book").mockRejectedValue(new Error("books down"))
        const result = await world.executor.execute(request(crmCells.complete, { prompt: "p" }))
        expect(result.verdict).toEqual({ kind: "continue" })
        expect(world.logger.error).toHaveBeenCalledWith(CellsLogEvent.BookingFailed, expect.any(Error), expect.objectContaining({ workspaceId: "ws-1" }))
    })
})

describe("CellExecutorService on stored sources (the same road as a declarative cell)", () => {
    const askToPay = (tools: ReadonlyArray<string> = [moneyCells.create.key]): ScriptedRunnerRun => async (run, door) => {
        let call = 0
        for (const tool of tools) {
            call += 1
            await door.call(call, tool, payInput)
        }
        return { type: "done", id: run.id, output: { payKey: "DH1001" } }
    }

    it("runs a node source: intent first, the source's calls go through the door and are recorded, facts come from the clock", async () => {
        const world = worldOf({ [moneyCells.create.key]: created }, askToPay())
        add(world, moneyCells.askToPay, "function run(){}")
        const result = await world.executor.execute(request(moneyCells.askToPay, payInput))
        expect(result.outcome).toEqual({ kind: "ok", output: { payKey: "DH1001" } })
        expect(result.verdict).toEqual({ kind: "continue" })
        expect(result.calls).toEqual([{ call: 1, tool: moneyCells.create.key, args: payInput, answer: { ok: true, value: { payKey: "DH1001" } } }])
        expect(world.events).toEqual(["intent", `run:${moneyCells.create.key}`])
        const run = world.runner.runs[0]
        expect(run).toMatchObject({ entry: "run", source: "function run(){}", input: payInput, limits: LIMITS })
        expect(run?.facts).toMatchObject({ at: NOW, day: "2026-11-15", waiting: 0, workspace: { id: "ws-1" } })
        expect(run?.facts.randomSeed).toMatch(/^run-1:step-1:/)
    })

    it("a repeat under the same key returns the recorded result and does not run the source again", async () => {
        const world = worldOf({ [moneyCells.create.key]: created }, askToPay())
        add(world, moneyCells.askToPay, "function run(){}")
        await world.executor.execute(request(moneyCells.askToPay, payInput))
        const again = await world.executor.execute(request(moneyCells.askToPay, payInput))
        expect(again.outcome.kind).toBe("ok")
        expect(world.runner.runs).toHaveLength(1)
        expect(world.door.calls).toHaveLength(1)
    })

    it("takes the clock and the random from the request when given; else once from the clock port and records them with the intent", async () => {
        const world = worldOf({}, (run) => Promise.resolve({ type: "done", id: run.id, output: {} }))
        const node = add(world, definitionOf({ kind: "node", key: "demo.facts", version: 1 }), "x")
        await world.executor.execute(request(node, {}, { facts: { now: "2020-02-03T04:05:06.000Z", randomSeed: "seed-9" } }))
        expect(world.runner.runs[0]?.facts).toMatchObject({ at: "2020-02-03T04:05:06.000Z", day: "2020-02-03", randomSeed: "seed-9" })
        expect(world.now).not.toHaveBeenCalled()
        await world.executor.execute(request(node, {}))
        world.now.mockReturnValue(new Date("2030-01-01T00:00:00.000Z"))
        await world.executor.execute(request(node, {}))
        expect(world.runner.runs[1]?.facts).toEqual(world.runner.runs[2]?.facts)
        expect(world.runner.runs[1]?.facts.at).toBe(NOW)
    })

    it("the call key of the door: the intent key for a declarative cell, key plus position for a source's call", async () => {
        const declared = worldOf({ [moneyCells.create.key]: created })
        add(declared, moneyCells.create)
        await declared.executor.execute(request(moneyCells.create, payInput))
        const sourced = worldOf({ [moneyCells.create.key]: created }, async (run, door) => {
            await door.call(7, moneyCells.create.key, payInput)
            return { type: "done", id: run.id, output: { payKey: "DH1001" } }
        })
        add(sourced, moneyCells.askToPay, "function run(){}")
        await sourced.executor.execute(request(moneyCells.askToPay, payInput))
        const intent = declared.door.calls[0]?.callKey ?? ""
        expect(intent).toMatch(/^run-1:step-1:[0-9a-f]{64}$/)
        expect(sourced.door.calls[0]?.callKey).toMatch(/^run-1:step-1:[0-9a-f]{64}:7$/)
    })

    it("a node's usage is the sum of what its tool answers reported in their envelopes", async () => {
        const world = worldOf(
            { "demo.t": { ok: true, value: 1, usage: { units: 5, unit: "token" } } },
            async (run, door) => {
                await door.call(1, "demo.t", { a: 1 })
                await door.call(2, "demo.t", { a: 2 })
                return { type: "done", id: run.id, output: {} }
            },
        )
        const node = add(world, definitionOf({ kind: "node", key: "demo.sum", version: 1 }, { semantics: { mutates: false, tools: ["demo.t"], metered: { usage: "tokens", price: "reported" } } }), "x")
        world.meter.fund("ws-1", 100)
        await world.executor.execute(request(node, {}))
        expect(world.meter.bookings().map((booking) => booking.usage)).toEqual([{ units: 10 }])
    })

    it("a fault of the ledger itself is not an outcome: it propagates", async () => {
        const world = worldOf({ [moneyCells.create.key]: created })
        add(world, moneyCells.create)
        jest.spyOn(world.ledger, "once").mockRejectedValue(new Error("ledger down"))
        await expect(world.executor.execute(request(moneyCells.create, payInput))).rejects.toThrow("ledger down")
    })

    it("a trigger source runs as translate and has no intent when it writes nothing", async () => {
        const world = worldOf({}, (run) => Promise.resolve({ type: "done", id: run.id, output: { fact: "credit" } }))
        add(world, moneyCells.bankCredit, "function translate(){}")
        const result = await world.executor.execute(request(moneyCells.bankCredit, { raw: "x" }))
        expect(result.outcome).toEqual({ kind: "ok", output: { fact: "credit" } })
        expect(world.runner.runs[0]?.entry).toBe("translate")
        expect(world.events).toEqual([])
    })

    it("a cell's own timeout may only lower the wall clock limit", async () => {
        const world = worldOf({}, (run) => Promise.resolve({ type: "done", id: run.id, output: {} }))
        const short = add(world, definitionOf({ kind: "node", key: "demo.short", version: 1 }, { semantics: { mutates: false, timeoutMs: 500 } }), "x")
        const long = add(world, definitionOf({ kind: "node", key: "demo.long", version: 1 }, { semantics: { mutates: false, timeoutMs: 600_000 } }), "y")
        await world.executor.execute(request(short, {}))
        await world.executor.execute(request(long, {}))
        expect(world.runner.runs.map((run) => run.limits.wallMs)).toEqual([500, 10_000])
    })

    it("a source that reaches for a tool it did not declare ends typed, whether the runner rethrows or swallows the refusal", async () => {
        const reaching: ScriptedRunnerRun = async (run, door) => {
            await door.call(1, "nivo.tool.secret.read", {})
            return { type: "done", id: run.id, output: { payKey: "DH1001" } }
        }
        const swallowing: ScriptedRunnerRun = async (run, door) => {
            await door.call(1, "nivo.tool.secret.read", {}).catch(() => null)
            return { type: "done", id: run.id, output: { payKey: "DH1001" } }
        }
        for (const handler of [reaching, swallowing]) {
            const world = worldOf({ "nivo.tool.secret.read": { ok: true, value: "secret" } }, handler)
            add(world, moneyCells.askToPay, "function run(){}")
            const result = await world.executor.execute(request(moneyCells.askToPay, payInput))
            expect(result.outcome).toEqual({ kind: "failed", why: "permanent", cause: { code: CellsErrorCode.ToolUndeclared, detail: "nivo.tool.secret.read" } })
            expect(result.verdict).toEqual({ kind: "stop", why: "failed" })
            expect(world.door.calls).toEqual([])
            expect(world.logger.warn).toHaveBeenCalledWith(CellsLogEvent.ToolUndeclared, { cell: "node:demo.ask-to-pay@1", tool: "nivo.tool.secret.read" })
        }
    })

    it("maps what the runner answers: ended, limits, thrown, syntax, output", async () => {
        const answers: ReadonlyArray<readonly [Awaited<ReturnType<ScriptedRunnerRun>>, CellOutcome["kind"], string]> = [
            [{ type: "ended", id: "x", reason: "cannot", why: "no stock" }, "ending", "unsuccessful"],
            [{ type: "failed", id: "x", why: "limits", detail: "cpu" }, "failed", "stop"],
            [{ type: "failed", id: "x", why: "thrown", detail: "boom" }, "failed", "stop"],
            [{ type: "failed", id: "x", why: "syntax", detail: "bad" }, "failed", "stop"],
            [{ type: "failed", id: "x", why: "output", detail: "too big" }, "unknown", "confirm"],
        ]
        for (const [answer, kind, verdict] of answers) {
            const world = worldOf({}, () => Promise.resolve(answer))
            add(world, moneyCells.askToPay, "function run(){}")
            const withConfirm = { ...moneyCells.askToPay, semantics: { ...moneyCells.askToPay.semantics, confirmBy: moneyCells.create.semantics.confirmBy as NonNullable<CellDefinitionView["semantics"]["confirmBy"]> } }
            add(world, withConfirm, "function run(){}")
            const result = await world.executor.execute(request(withConfirm, payInput))
            expect([outcomeKind(result), result.verdict.kind]).toEqual([kind, verdict])
        }
    })

    it("tells the failure causes apart", async () => {
        const causes: ReadonlyArray<readonly [Awaited<ReturnType<ScriptedRunnerRun>>, string, "limits" | "permanent"]> = [
            [{ type: "failed", id: "x", why: "limits", detail: "cpu" }, CellsErrorCode.RunnerLimits, "limits"],
            [{ type: "failed", id: "x", why: "thrown", detail: "boom" }, CELL_CAUSE.sourceThrown, "permanent"],
            [{ type: "failed", id: "x", why: "syntax", detail: "bad" }, CellsErrorCode.SourceSyntax, "permanent"],
        ]
        for (const [answer, code, why] of causes) {
            const world = worldOf({}, () => Promise.resolve(answer))
            add(world, moneyCells.askToPay, "function run(){}")
            const result = await world.executor.execute(request(moneyCells.askToPay, payInput))
            expect(result.outcome).toMatchObject({ kind: "failed", why, cause: { code } })
        }
    })

    it("a node that ended on a business ending is unsuccessful and kept", async () => {
        const world = worldOf({}, (run) => Promise.resolve({ type: "ended", id: run.id, reason: "cannot", why: "no stock" }))
        add(world, moneyCells.askToPay, "function run(){}")
        const first = await world.executor.execute(request(moneyCells.askToPay, payInput))
        expect(first.verdict).toEqual({ kind: "unsuccessful", reason: "cannot" })
        await world.executor.execute(request(moneyCells.askToPay, payInput))
        expect(world.runner.runs).toHaveLength(1)
    })

    it("a re-run after a retry replays the tool answers the first run recorded: the write is not sent twice", async () => {
        let attempts = 0
        const world = worldOf({ [moneyCells.create.key]: created, [moneyCells.read.key]: { ok: true, value: {} } }, async (run, door) => {
            await door.call(1, moneyCells.create.key, payInput)
            attempts += 1
            if (attempts === 1) throw Object.assign(new Error("worker lost"), { transient: true })
            return { type: "done", id: run.id, output: { payKey: "DH1001" } }
        })
        add(world, { ...moneyCells.askToPay, semantics: { ...moneyCells.askToPay.semantics, tools: [moneyCells.create.key] } }, "function run(){}")
        const first = await world.executor.execute(request(moneyCells.askToPay, payInput))
        expect(first.verdict).toEqual({ kind: "retry" })
        const second = await world.executor.execute(request(moneyCells.askToPay, payInput))
        expect(second.verdict).toEqual({ kind: "continue" })
        expect(world.door.calls).toHaveLength(1)
        expect(second.calls).toHaveLength(1)
    })

    it("a refusal the door answers is recorded; a transient answer is not (it is asked again)", async () => {
        let busy = 0
        const world = worldOf(
            {
                [moneyCells.create.key]: () => {
                    busy += 1
                    return busy === 1 ? { ok: false, refusal: "busy", facts: { [REFUSAL_CLASS_FACT]: "transient" } } : { ok: true, value: { payKey: "DH1001" } }
                },
            },
            async (run, door) => {
                const answer = await door.call(1, moneyCells.create.key, payInput)
                if (!answer.ok) throw Object.assign(new Error("busy"), { transient: true })
                return { type: "done", id: run.id, output: { payKey: "DH1001" } }
            },
        )
        add(world, { ...moneyCells.askToPay, semantics: { ...moneyCells.askToPay.semantics, tools: [moneyCells.create.key] } }, "function run(){}")
        expect((await world.executor.execute(request(moneyCells.askToPay, payInput))).verdict).toEqual({ kind: "retry" })
        expect((await world.executor.execute(request(moneyCells.askToPay, payInput))).verdict).toEqual({ kind: "continue" })
        expect(world.door.calls).toHaveLength(2)
    })

    it("ctx.say gets its request back in phase 0 (no AI behind the door yet)", async () => {
        let said: JsonValue = null
        const world = worldOf({}, async (run, door) => {
            said = await door.say(1, { ask: "pay" })
            return { type: "done", id: run.id, output: {} }
        })
        const node = add(world, definitionOf({ kind: "node", key: "demo.say", version: 1 }), "x")
        await world.executor.execute(request(node, {}))
        expect(said).toEqual({ ask: "pay" })
    })

    it("evicts the oldest recorded call beyond the bound", async () => {
        const world = worldOf({ "demo.t": { ok: true, value: 1 } }, async (run, door) => {
            for (let call = 1; call <= 10_001; call += 1) await door.call(call, "demo.t", { call })
            return { type: "done", id: run.id, output: {} }
        })
        const node = add(world, definitionOf({ kind: "node", key: "demo.many", version: 1 }, { semantics: { mutates: false, tools: ["demo.t"] } }), "x")
        await world.executor.execute(request(node, {}))
        await world.executor.execute({ ...request(node, {}), scope: scopeOf({ stepKey: "again" }) })
        expect(world.door.calls).toHaveLength(20_002)
    })
})

describe("CellExecutorService on control cells (data, evaluated by the interpreter)", () => {
    const state = { trigger: { amount: 350000 }, steps: {}, vars: { count: { value: 2, by: "s0", at: "t0" } }, item: null }

    it("core.if takes the yes branch, and `unknown` takes the no branch", async () => {
        const world = worldOf()
        const view = add(world, controlCells.ifCell)
        const yes = await world.executor.execute(
            request(view, state, { config: { when: { op: "gte", ref: { $ref: "trigger.amount" }, value: 300000 }, yes: "ship", no: "stop" } }),
        )
        expect(yes.outcome).toEqual({ kind: "ok", output: { truth: true, branch: "yes", next: "ship" } })
        expect(yes.verdict).toEqual({ kind: "continue" })
        const unsure = await world.executor.execute(
            request(view, state, { config: { when: { op: "gt", ref: { $ref: "trigger.amount" }, value: "text" }, yes: "ship", no: "stop" } }),
        )
        expect(unsure.outcome).toEqual({ kind: "ok", output: { truth: "unknown", branch: "no", next: "stop" } })
        expect(world.events).toEqual([])
        expect(world.runner.runs).toEqual([])
        expect(world.door.calls).toEqual([])
    })

    it("core.if with a missing or invalid condition is failed permanent", async () => {
        const world = worldOf()
        const view = add(world, controlCells.ifCell)
        for (const config of [undefined, { when: { op: "bogus" }, yes: "a" }, { when: { not: { not: { not: { not: { not: { op: "present", ref: { $ref: "trigger.a" } } } } } } }, yes: "a" }]) {
            const result = await world.executor.execute(request(view, state, config === undefined ? {} : { config }))
            expect(result.outcome).toEqual({ kind: "failed", why: "permanent", cause: { code: CELL_CAUSE.expressionInvalid } })
            expect(result.verdict).toEqual({ kind: "stop", why: "failed" })
        }
    })

    it("core.set returns the variables update { value, by, at } with the step key and the clock", async () => {
        const world = worldOf()
        const view = add(world, controlCells.setCell)
        const result = await world.executor.execute(
            request(view, state, {
                scope: scopeOf({ stepKey: "remember" }),
                config: { set: { paid: { op: "gte", ref: { $ref: "trigger.amount" }, value: 300000 }, count: { $ref: "vars.count" }, tag: "vip" } },
            }),
        )
        expect(result.outcome).toEqual({
            kind: "ok",
            output: {
                vars: {
                    paid: { value: true, by: "remember", at: NOW },
                    count: { value: 2, by: "remember", at: NOW },
                    tag: { value: "vip", by: "remember", at: NOW },
                },
            },
        })
        expect(result.verdict).toEqual({ kind: "continue" })
    })

    it("core.set without a set map is failed permanent", async () => {
        const world = worldOf()
        const view = add(world, controlCells.setCell)
        const result = await world.executor.execute(request(view, state, { config: {} }))
        expect(result.outcome).toEqual({ kind: "failed", why: "permanent", cause: { code: CELL_CAUSE.expressionInvalid } })
    })

    it("a control kind phase 0 does not interpret answers a typed failure, never runs", async () => {
        const world = worldOf()
        const view = add(world, controlCells.loopCell)
        const result = await world.executor.execute(request(view, state, { config: {} }))
        expect(result.outcome).toEqual({ kind: "failed", why: "permanent", cause: { code: CELL_CAUSE.controlNotInterpreted } })
        expect(result.verdict).toEqual({ kind: "stop", why: "failed" })
    })
})
