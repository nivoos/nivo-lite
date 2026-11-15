import { mock } from "@starci/jest-preset"
import type { EntityManager } from "typeorm"
import {
    CELLS_ERROR_KINDS,
    CELLS_MESSAGES,
    CellsError,
    CellsErrorCode,
    type CellDefinitionsWriter,
    type CellDefinitionView,
    type CellExecutor,
    type CellLedger,
    type CellMeter,
    type CellOutcome,
    type CellReader,
    type CellRef,
    type CellRunner,
    type CellToolDoor,
    type ExecuteScope,
    type ValidatedCell,
} from "@modules/domain/cells"
import {
    MemoryCellDefinitionsWriter,
    MemoryCellLedger,
    MemoryCellMeter,
    MemoryCellReader,
    ScriptedCellExecutor,
    ScriptedCellRunner,
    ScriptedCellToolDoor,
    canonicalJsonOf,
    sha256Of,
} from "./cells.builder"

const REF: CellRef = { kind: "node", key: "demo.ask-to-pay", version: 1 }

const SCOPE: ExecuteScope = {
    workspaceId: "ws-1",
    runId: "run-1",
    stepKey: "ask",
    attempt: 1,
    enterprise: null,
    world: "sandbox",
}

const DEFINITION: CellDefinitionView = {
    ...REF,
    id: "cell-1",
    packageKey: "demo-money",
    title: { vi: "Mời khách thanh toán", en: "Ask the customer to pay" },
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    configSchema: { type: "object" },
    semantics: { mutates: true },
    body: {},
    sourceSha256: null,
    examples: [],
    definitionHash: "hash-1",
    reviewState: "approved",
    deleted: false,
}

const CANDIDATE: ValidatedCell = {
    ...REF,
    title: DEFINITION.title,
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    configSchema: { type: "object" },
    semantics: { mutates: true },
    body: {},
    source: null,
    examples: [],
    reviewState: "approved",
    reviewRef: "demo-money@c0ffee",
}

/** The manager the writer double never touches. */
const manager = mock<EntityManager>()

describe("cells slice 0 contracts", () => {
    it("gives every error code a kind and a Vietnamese and an English message", () => {
        for (const code of Object.values(CellsErrorCode)) {
            expect(CELLS_ERROR_KINDS[code]).toBeDefined()
            expect(CELLS_MESSAGES.vi?.[`errors.${code}`]).toEqual(expect.any(String))
            expect(CELLS_MESSAGES.en?.[`errors.${code}`]).toEqual(expect.any(String))
        }
        expect(new CellsError({ code: CellsErrorCode.Unknown }).message).toBe("CELLS_UNKNOWN")
    })
})

describe("MemoryCellReader", () => {
    it("satisfies the CellReader port and answers an added row, a source by its hash and a listing of approved live rows", async () => {
        const reader = new MemoryCellReader()
        const port: CellReader = reader
        reader.addDefinition(DEFINITION)
        reader.addDefinition({ ...DEFINITION, key: "demo.old", reviewState: "retired" })
        reader.addDefinition({ ...DEFINITION, kind: "tool", key: "demo.gone", deleted: true })
        const source = reader.addSource("function run() {}")
        reader.addGraph({
            key: "demo.pay",
            version: 1,
            id: "graph-1",
            document: { start: "a", triggers: [], steps: {} },
            documentHash: "h",
            deleted: false,
        })

        await expect(port.definition(REF)).resolves.toBe(DEFINITION)
        await expect(port.source(source.sha256)).resolves.toEqual({
            sha256: sha256Of("function run() {}"),
            language: "js-quickjs@1",
            text: "function run() {}",
        })
        await expect(port.graph({ key: "demo.pay", version: 1 })).resolves.toMatchObject({ id: "graph-1" })
        await expect(port.listed({ enterprise: null })).resolves.toEqual([REF])
        await expect(port.listed({ kind: "tool", enterprise: null })).resolves.toEqual([])
        await expect(port.definition({ ...REF, version: 2 })).rejects.toMatchObject({
            code: CellsErrorCode.Unknown,
            params: { ref: "node:demo.ask-to-pay@2" },
        })
        await expect(port.graph({ key: "x", version: 1 })).rejects.toMatchObject({ code: CellsErrorCode.Unknown })
        await expect(port.source("nope")).rejects.toMatchObject({ code: CellsErrorCode.Unknown })
    })
})

describe("MemoryCellDefinitionsWriter", () => {
    it("satisfies the CellDefinitionsWriter port: created then unchanged, and other content for a kept version is refused", async () => {
        const writer = new MemoryCellDefinitionsWriter()
        const port: CellDefinitionsWriter = writer
        const packageId = await port.putPackage(
            manager,
            { key: "demo-money", version: "1", visibility: "public", author: "nivo" },
            { repository: "r", commit: "c0ffee" },
        )
        await expect(
            port.putPackage(
                manager,
                { key: "demo-money", version: "1", visibility: "public", author: "nivo" },
                { repository: "r", commit: "c0ffee" },
            ),
        ).resolves.toBe(packageId)
        await expect(
            port.putSource(manager, { text: "x", authorKind: "package", authorRef: "demo-money" }),
        ).resolves.toBe("source-1")

        await expect(port.putDefinition(manager, packageId, CANDIDATE)).resolves.toBe("created")
        await expect(port.putDefinition(manager, packageId, { ...CANDIDATE })).resolves.toBe("unchanged")
        await expect(
            port.putDefinition(manager, packageId, { ...CANDIDATE, body: { changed: true } }),
        ).rejects.toMatchObject({
            code: CellsErrorCode.VersionImmutable,
            params: { ref: "node:demo.ask-to-pay@1" },
        })
        const graph = {
            key: "demo.pay",
            version: 1,
            document: { start: "a", triggers: [], steps: {} },
            reviewState: "approved",
            reviewRef: null,
        } as const
        await expect(port.putGraph(manager, packageId, graph)).resolves.toBe("created")
        await expect(port.putGraph(manager, packageId, graph)).resolves.toBe("unchanged")
        await port.retire(manager, REF)
        const receipt = {
            packageKey: "demo-money",
            repository: "r",
            commit: "c0ffee",
            forced: false,
            report: { created: [], unchanged: [], refused: [], notInPackage: [], retired: [] },
        }
        await port.receipt(manager, receipt)
        await port.receipt(manager, { ...receipt, report: { ...receipt.report, created: ["x"] } })
        await expect(port.receiptExists(manager, "demo-money", "c0ffee", false)).resolves.toBe(true)
        await expect(port.receiptExists(manager, "demo-money", "c0ffee", true)).resolves.toBe(false)
        await expect(port.lastReport(manager, "demo-money")).resolves.toEqual(receipt.report)
        await expect(port.lastReport(manager, "demo-crm-lead")).resolves.toBeNull()

        expect(writer.retired).toEqual(["node:demo.ask-to-pay@1"])
        expect(writer.receipts).toEqual([receipt])
        expect(writer.calls.map((call) => call.method)).toEqual([
            "putPackage",
            "putPackage",
            "putSource",
            "putDefinition",
            "putDefinition",
            "putDefinition",
            "putGraph",
            "putGraph",
            "retire",
            "receipt",
            "receipt",
        ])
    })
})

describe("ScriptedCellRunner", () => {
    it("satisfies the CellRunner port: by default a run is done with null, and check answers the problems it was given", async () => {
        const runner = new ScriptedCellRunner(undefined, ["line 1: unexpected token"])
        const port: CellRunner = runner
        const door = new ScriptedCellToolDoor()
        const request = {
            type: "run",
            id: "r1",
            entry: "run",
            source: "function run() {}",
            sha256: sha256Of("function run() {}"),
            input: null,
            facts: {
                at: "2026-11-15T00:00:00.000Z",
                day: "2026-11-15",
                randomSeed: "seed",
                item: null,
                queue: [],
                waiting: 0,
                workspace: {},
            },
            limits: { memoryBytes: 1, stackBytes: 1, cpuMs: 1, wallMs: 1, outputBytes: 1, maxCalls: 1 },
        } as const

        await expect(
            port.run(request, {
                call: (_call, tool, args) => door.call(SCOPE, tool, args, { key: `k:${String(_call)}` }),
                say: () => Promise.resolve(null),
            }),
        ).resolves.toEqual({ type: "done", id: "r1", output: null })
        await expect(port.check("bad")).resolves.toEqual(["line 1: unexpected token"])
        expect(runner.runs).toEqual([request])
        expect(runner.checked).toEqual(["bad"])
    })
})

describe("MemoryCellLedger", () => {
    it("satisfies the CellLedger port: one act per key, a replay answers the kept outcome, a pending key answers unknown", async () => {
        const ledger = new MemoryCellLedger()
        const port: CellLedger = ledger
        const done: CellOutcome = { kind: "ok", output: { payKey: "DH1001" } }
        let acts = 0
        const act = (): Promise<CellOutcome> => {
            acts += 1
            return Promise.resolve(done)
        }

        await expect(port.once("run-1:ask:a", act)).resolves.toEqual({ replayed: false, outcome: done })
        await expect(port.once("run-1:ask:a", act)).resolves.toEqual({ replayed: true, outcome: done })
        expect(acts).toBe(1)

        const unknownCause = Object.assign(new Error("lost the answer"), { outcomeUnknown: 1 })
        await expect(port.once("run-1:ask:b", () => Promise.reject(unknownCause))).rejects.toBe(unknownCause)
        await expect(port.once("run-1:ask:b", act)).resolves.toEqual({
            replayed: true,
            outcome: { kind: "unknown", key: "run-1:ask:b" },
        })

        await expect(
            port.once("run-1:ask:c", () => Promise.reject(new Error("refused before the act"))),
        ).rejects.toThrow("refused before the act")
        await expect(port.once("run-1:ask:c", act)).resolves.toEqual({ replayed: false, outcome: done })
        expect(ledger.keys()).toEqual(["run-1:ask:a", "run-1:ask:b", "run-1:ask:c"])
    })
})

describe("MemoryCellMeter", () => {
    it("satisfies the CellMeter port: an empty pool allows nothing, a billed booking draws the pool down, a failed try is kept and not billed", async () => {
        const meter = new MemoryCellMeter()
        const port: CellMeter = meter
        await expect(port.allows("ws-1", REF, null)).resolves.toBe(false)

        meter.fund("ws-1", 10)
        await expect(port.allows("ws-1", REF, null)).resolves.toBe(true)
        await expect(port.allows("ws-1", REF, { units: 11 })).resolves.toBe(false)
        await expect(port.allows("ws-1", REF, { units: 10 })).resolves.toBe(true)

        await port.book("ws-1", REF, { units: 4 }, true)
        await port.book("ws-1", REF, { units: 3, model: "m" }, false)
        expect(meter.balanceOf("ws-1")).toBe(6)
        expect(meter.bookings.map((booking) => booking.billed)).toEqual([true, false])
    })
})

describe("ScriptedCellToolDoor", () => {
    it("satisfies the CellToolDoor port: a scripted answer, a function of the args, and a refusal for an unscripted tool", async () => {
        const door = new ScriptedCellToolDoor({
            "nivo.tool.a": { ok: true, value: { done: true } },
            "nivo.tool.b": (args) => ({ ok: true, value: args }),
        })
        const port: CellToolDoor = door

        await expect(port.call(SCOPE, "nivo.tool.a", {}, { key: "k1" })).resolves.toEqual({
            ok: true,
            value: { done: true },
        })
        await expect(port.call(SCOPE, "nivo.tool.b", { n: 1 }, { key: "k2" })).resolves.toEqual({
            ok: true,
            value: { n: 1 },
        })
        await expect(port.call(SCOPE, "nivo.tool.c", {}, { key: "k3" })).resolves.toEqual({
            ok: false,
            refusal: "tool_unscripted",
        })
        expect(door.calls.map((call) => call.tool)).toEqual(["nivo.tool.a", "nivo.tool.b", "nivo.tool.c"])
        expect(door.calls.map((call) => call.callKey)).toEqual(["k1", "k2", "k3"])
    })
})

describe("ScriptedCellExecutor", () => {
    it("satisfies the CellExecutor port: an unscripted call is a visible stop, a scripted one answers its result", async () => {
        const request = { scope: SCOPE, cell: REF, input: { orderId: "DH1001" } }
        const bare = new ScriptedCellExecutor()
        const bareExecutor: CellExecutor = bare
        await expect(bareExecutor.execute(request)).resolves.toEqual({
            outcome: { kind: "failed", why: "permanent", cause: { code: "executor_unscripted" } },
            verdict: { kind: "stop", why: "failed" },
            calls: [],
        })

        const answer = { outcome: { kind: "ok", output: 1 }, verdict: { kind: "continue" }, calls: [] } as const
        const scripted: CellExecutor = new ScriptedCellExecutor(() => Promise.resolve(answer))
        await expect(scripted.execute(request)).resolves.toBe(answer)
        expect(bare.requests).toEqual([request])
    })
})

describe("canonicalJsonOf", () => {
    it("sorts members, keeps arrays in order and leaves out undefined members", () => {
        expect(canonicalJsonOf({ b: [2, { d: 1, c: undefined }], a: null })).toBe('{"a":null,"b":[2,{"d":1}]}')
        expect(canonicalJsonOf(undefined)).toBe("null")
        expect(canonicalJsonOf({ a: 2, b: 1, c: 3 })).toBe('{"a":2,"b":1,"c":3}')
    })
})
