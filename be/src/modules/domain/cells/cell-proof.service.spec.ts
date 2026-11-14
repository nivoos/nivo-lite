import { resolve } from "node:path"
import { Test } from "@nestjs/testing"
import { MemoryCellReader, ScriptedCellRunner } from "@tests/fixtures/builders/cells.builder"
import { definitionOf } from "@tests/fixtures/builders/cells-executor.builder"
import { fixturePackageOf, PROOF_LIMITS, ProofWorlds, readerOfPackage, realRunnerOf, type FixturePackage } from "@tests/fixtures/builders/cells-proof.builder"
import type { CellRunner } from "./cell-runner.port"
import type { CellProof, CellProofWorlds } from "./cell-proof.contracts"
import { CELL_PROOF_WORLDS } from "./cell-proof.decorators"
import { CellProofService } from "./cell-proof.service"
import { CELL_READER } from "./cells.decorators"
import type { CellDefinitionView, CellRef } from "./cells.contracts"

const FIXTURES = resolve(__dirname, "../../../tests/fixtures/cells")
const runner = realRunnerOf()

afterAll(() => runner.onModuleDestroy())

const build = async (worlds: CellProofWorlds, reader: MemoryCellReader) => {
    const moduleRef = await Test.createTestingModule({
        providers: [CellProofService, { provide: CELL_PROOF_WORLDS, useValue: worlds }, { provide: CELL_READER, useValue: reader }],
    }).compile()
    return moduleRef.get(CellProofService)
}

const kitOver = (pack: FixturePackage) => build(new ProofWorlds(runner, PROOF_LIMITS), readerOfPackage(pack))

/** The cases that PASS, by cell: the ones the row gives something to judge (every other case is `na`). */
const passedOf = (proof: CellProof): string => proof.cases.filter((result) => result.status === "pass").map((result) => result.id).join(" ")
const failedOf = (proof: CellProof): ReadonlyArray<string> => proof.cases.filter((result) => result.status === "fail").map((result) => `${result.id}: ${result.detail}`)
const rowOf = (pack: FixturePackage, key: string): CellDefinitionView => {
    const row = pack.rows.find((candidate) => candidate.key === key)
    if (row === undefined) throw new Error(`no row ${key}`)
    return row
}

const MONEY = {
    "core.if": "invalid-input if-truth-table config-checks",
    "core.outcome": "invalid-input config-checks",
    "core.set": "invalid-input set-update set-undeclared config-checks",
    "core.wait": "invalid-input config-checks",
    "demo.ask-to-pay": "examples invalid-input output-shape declared-tools undeclared-tool limits determinism",
    "nivo.tool.customer.message.send": "valid-input invalid-input output-shape refusal-final refusal-undeclared transient unknown-outcome intent-once",
    "nivo.tool.payment.request.create": "valid-input invalid-input output-shape refusal-classes refusal-final refusal-undeclared transient unknown-outcome intent-once",
    "nivo.tool.payment.request.read": "valid-input invalid-input output-shape refusal-classes refusal-undeclared transient unknown-outcome",
    "demo.bank-credit": "examples invalid-input output-shape declared-tools undeclared-tool limits determinism",
}
const CRM = {
    "core.loop": "invalid-input config-checks",
    "core.outcome": "invalid-input config-checks",
    "demo.file-lead": "examples invalid-input output-shape declared-tools undeclared-tool limits determinism",
    "nivo.api.crm.demo.post.leads": "valid-input invalid-input output-shape refusal-classes refusal-final refusal-undeclared transient unknown-outcome intent-once repeatable",
    "demo.crm": "invalid-input",
    "demo.model.complete": "valid-input invalid-input output-shape refusal-undeclared transient unknown-outcome metered",
    "nivo.tool.crm.lead.create": "valid-input invalid-input output-shape refusal-final refusal-undeclared transient unknown-outcome intent-once repeatable",
    "nivo.tool.record.update": "valid-input invalid-input output-shape refusal-classes refusal-undeclared transient unknown-outcome intent-once",
}

describe("CellProofService", () => {
    describe("proveRow over the fixture packages (the real executor, the real isolated runner)", () => {
        it.each([
            ["demo-money", MONEY],
            ["demo-crm-lead", CRM],
        ])("proves every cell of %s from its row alone", async (name, expected) => {
            const pack = fixturePackageOf(resolve(FIXTURES, name))
            const kit = await kitOver(pack)
            const proofs = new Map<string, CellProof>()
            for (const row of pack.rows) proofs.set(row.key, await kit.proveRow(row))
            expect([...proofs.keys()].sort()).toEqual(Object.keys(expected).sort())
            for (const [key, proof] of proofs) {
                expect({ key, failed: failedOf(proof) }).toEqual({ key, failed: [] })
                expect({ key, passed: passedOf(proof) }).toEqual({ key, passed: expected[key as keyof typeof expected] })
                expect(proof.ok).toBe(true)
            }
        }, 180_000)

        it("proves a cell by its ref through the reader", async () => {
            const pack = fixturePackageOf(resolve(FIXTURES, "demo-money"))
            const ref: CellRef = { kind: "tool", key: "nivo.tool.payment.request.read", version: 1 }
            const proof = await (await kitOver(pack)).prove(ref)
            expect({ cell: proof.cell, ok: proof.ok }).toEqual({ cell: "tool:nivo.tool.payment.request.read@1", ok: true })
        })

        it("says why a case is not applicable", async () => {
            const pack = fixturePackageOf(resolve(FIXTURES, "demo-money"))
            const proof = await (await kitOver(pack)).proveRow(rowOf(pack, "nivo.tool.payment.request.read"))
            expect(proof.cases.find((result) => result.id === "metered")).toEqual({ id: "metered", status: "na", detail: "the cell is not metered" })
            expect(proof.cases.find((result) => result.id === "examples")).toEqual({ id: "examples", status: "na", detail: "the row declares no example" })
        })
    })

    describe("proveRow catches a cell that breaks its own declaration", () => {
        it("catches a node that declares no tool but calls one (real runner)", async () => {
            const pack = fixturePackageOf(resolve(FIXTURES, "demo-money"))
            const wrong: CellDefinitionView = { ...rowOf(pack, "demo.ask-to-pay"), semantics: { mutates: false, tools: [] } }
            const proof = await (await kitOver(pack)).proveRow(wrong)
            expect(proof.ok).toBe(false)
            const failed = failedOf(proof)
            expect(failed.map((entry) => entry.split(":")[0])).toEqual(["examples", "declared-tools"])
            expect(failed[1]).toContain("calls undeclared tool nivo.tool.payment.request.create")
        }, 120_000)

        it("catches a cell that declares repeatable but whose run is not idempotent", async () => {
            const reader = new MemoryCellReader()
            const text = "function run(input, ctx) { return null }\n"
            const source = reader.addSource(text)
            let counter = 0
            const drifting: CellRunner = new ScriptedCellRunner(async (request, door) => {
                counter += 1
                await door.call(1, "nivo.tool.payment.request.create", { amountVnd: counter, reference: "R1" })
                return { type: "done", id: request.id, output: { payKey: "R1" } }
            })
            const row = definitionOf(
                { kind: "node", key: "demo.drifting", version: 1 },
                {
                    sourceSha256: source.sha256,
                    semantics: { mutates: true, outside: true, repeatable: true, tools: ["nivo.tool.payment.request.create"] },
                    examples: [
                        {
                            name: "files R1",
                            input: {},
                            tools: [{ id: "nivo.tool.payment.request.create", answer: { ok: true, value: { payKey: "R1" } } }],
                            expect: { ok: { payKey: "R1" } },
                        },
                    ],
                },
            )
            reader.addDefinition(row)
            const kit = await build(new ProofWorlds(drifting, PROOF_LIMITS), reader)
            const proof = await kit.proveRow(row)
            expect(proof.ok).toBe(false)
            const failed = failedOf(proof)
            // The stand-in runner ignores every probe source, so the probes of the runner cases fail too; the two cases of this wrong cell are among them.
            expect(failed.map((entry) => entry.split(":")[0])).toEqual(expect.arrayContaining(["repeatable", "determinism"]))
            expect(failed.find((entry) => entry.startsWith("repeatable"))).toBe('repeatable: example "files R1" is declared repeatable but its two runs reach the door differently (not idempotent)')
        })

        it("fails a case that throws instead of judging", async () => {
            const reader = new MemoryCellReader()
            const row = definitionOf({ kind: "node", key: "demo.nosource", version: 1 }, { sourceSha256: "missing", examples: [{ name: "x", input: {}, expect: { ok: null } }] })
            const kit = await build(new ProofWorlds(new ScriptedCellRunner(), PROOF_LIMITS), reader)
            const proof = await kit.proveRow(row)
            expect(proof.ok).toBe(false)
            expect(proof.cases.find((result) => result.id === "examples")?.detail).toMatch(/^the case threw: /u)
        })
    })
})
