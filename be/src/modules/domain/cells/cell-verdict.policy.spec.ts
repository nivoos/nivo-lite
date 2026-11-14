import { crmCells, moneyCells, semanticsOf } from "@tests/fixtures/builders/cells-executor.builder"
import type { CellOutcome, CellSemantics, CellVerdict } from "./cells.contracts"
import { CREDITS_EXHAUSTED_CODE, isDeclaredRefusal, isFinalRefusal, verdictOf, writesOutside } from "./cell-verdict.policy"

const KEY = "run-1:step-1:abc"
const ok: CellOutcome = { kind: "ok", output: { done: true } }
const cannot: CellOutcome = { kind: "ending", reason: "cannot", why: "no stock" }
const declined: CellOutcome = { kind: "ending", reason: "declined" }
const finalRefusal = (code: string): CellOutcome => ({ kind: "refused-final", code })
const refused = (code: string): CellOutcome => ({ kind: "refused", code, facts: {} })
const transient: CellOutcome = { kind: "transient", cause: { code: "http_503" } }
const unknown: CellOutcome = { kind: "unknown", key: KEY }
const failed = (why: "confused" | "permanent" | "limits"): CellOutcome => ({ kind: "failed", why })
const exhausted: CellOutcome = { kind: "failed", why: "limits", cause: { code: CREDITS_EXHAUSTED_CODE } }

const money = moneyCells.create.semantics
const crm = crmCells.createLead.semantics
const inside = crmCells.updateRecord.semantics
const read = moneyCells.read.semantics
const neither = semanticsOf({ mutates: true })

type Row = readonly [label: string, semantics: CellSemantics, outcome: CellOutcome, expected: CellVerdict]

const unsuccessful = (reason: string): CellVerdict => ({ kind: "unsuccessful", reason })
const stop = (why: "act_refused" | "outcome_unknown" | "failed" | "credits_exhausted", retry?: "after_take_over"): CellVerdict =>
    retry === undefined ? { kind: "stop", why } : { kind: "stop", why, retry }
const confirm: CellVerdict = {
    kind: "confirm",
    read: { tool: "nivo.tool.payment.request.read", args: { payKey: { from: "args", member: "payKey" } } },
}

describe("verdictOf: the full table, the one classifier", () => {
    describe.each<readonly [string, ReadonlyArray<Row>]>([
        [
            "demo-money (outside write, not repeatable, confirmBy)",
            [
                ["ok", money, ok, { kind: "continue" }],
                ["ending cannot", money, cannot, unsuccessful("cannot")],
                ["ending declined", money, declined, unsuccessful("declined")],
                ["refused final", money, finalRefusal("amount_invalid"), unsuccessful("amount_invalid")],
                ["refused, outside write", money, refused("bank_declined"), stop("act_refused")],
                ["transient", money, transient, { kind: "retry" }],
                ["unknown with confirmBy", money, unknown, confirm],
                ["unknown with neither", neither, unknown, stop("outcome_unknown", "after_take_over")],
                ["failed permanent", money, failed("permanent"), stop("failed")],
                ["failed confused", money, failed("confused"), stop("failed")],
                ["failed limits", money, failed("limits"), stop("failed")],
                ["credits exhausted", money, exhausted, stop("credits_exhausted")],
                ["read: refused continues", read, refused("not_found"), { kind: "continue" }],
                ["read: unknown retries", read, unknown, { kind: "retry" }],
            ],
        ],
        [
            "demo-crm-lead (repeatable outside write, inside write, metered)",
            [
                ["ok", crm, ok, { kind: "continue" }],
                ["ending cannot", crm, cannot, unsuccessful("cannot")],
                ["refused final", crm, finalRefusal("lead_duplicate"), unsuccessful("lead_duplicate")],
                ["refused, outside write", crm, refused("crm_closed"), stop("act_refused")],
                ["transient", crm, transient, { kind: "retry" }],
                ["unknown, repeatable repeats the same key", crm, unknown, { kind: "repeat", key: KEY }],
                [
                    "unknown, repeatable wins over confirmBy",
                    { ...crm, confirmBy: money.confirmBy as NonNullable<CellSemantics["confirmBy"]> },
                    unknown,
                    { kind: "repeat", key: KEY },
                ],
                ["inside write refusal continues", inside, refused("row_locked"), { kind: "continue" }],
                ["inside write failed", inside, failed("permanent"), stop("failed")],
                ["metered refused continues (a read)", crmCells.complete.semantics, refused("model_busy"), { kind: "continue" }],
                ["metered credits exhausted", crmCells.complete.semantics, exhausted, stop("credits_exhausted")],
            ],
        ],
    ])("%s", (_kind, rows) => {
        it.each(rows)("%s", (_label, semantics, outcome, expected) => {
            expect(verdictOf(semantics, outcome)).toEqual(expected)
        })
    })

    it("knows where a write lands and what a cell declared", () => {
        expect(writesOutside(money)).toBe(true)
        expect(writesOutside(inside)).toBe(false)
        expect(writesOutside(read)).toBe(false)
        expect(isFinalRefusal(money, "amount_invalid")).toBe(true)
        expect(isFinalRefusal(money, "bank_declined")).toBe(false)
        expect(isFinalRefusal(read, "amount_invalid")).toBe(false)
        expect(isDeclaredRefusal(money, "bank_declined")).toBe(true)
        expect(isDeclaredRefusal(money, "amount_invalid")).toBe(true)
        expect(isDeclaredRefusal(money, "other")).toBe(false)
        expect(isDeclaredRefusal(semanticsOf({ mutates: true, finalRefusals: ["only_final"] }), "only_final")).toBe(true)
        expect(isDeclaredRefusal(neither, "x")).toBe(false)
    })
})
