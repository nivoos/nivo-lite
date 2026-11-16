import { Test } from "@nestjs/testing"
import { STUCK_FACT } from "@modules/domain/team-chat"
import {
    AI_CONFUSED,
    RETRY_PAUSES_MS,
    failureClassOf,
    retryVerdictOf,
    stuckFactsOf,
    troubleOfConfusion,
    troubleOfRefusal,
    troubleOfThrow,
    type FailureFacts,
    type StepTrouble,
} from "./step-trouble.policy"

const SUBJECT = Symbol("step-trouble.policy")

/** The policy as Nest provides it. */
const buildSubject = async () => {
    const moduleRef = await Test.createTestingModule({
        providers: [{ provide: SUBJECT, useValue: { stuckFactsOf } }],
    }).compile()
    return moduleRef.get<{ readonly stuckFactsOf: typeof stuckFactsOf }>(SUBJECT)
}

describe("stuckFactsOf and the stop card's wording", () => {
    it("names the engine's own facts exactly as the stop card words them (team-chat STUCK_FACT), so no raw fact slips through unworded", async () => {
        const subject = await buildSubject()
        const facts = subject.stuckFactsOf(
            {
                workflow: "accounting.reconcile",
                nodeKey: "match",
                nodeStep: "accounting.match-payment",
                runId: "run-1",
                subject: "bank-transaction:tx-9",
            },
            troubleOfConfusion({ reason: "amount differs", question: "Mark it paid?" }),
            { bankName: "MBBANK" },
        )
        const names = facts.map(([name]) => name)
        const known: ReadonlyArray<string> = Object.values(STUCK_FACT)
        expect(names.filter((name) => !known.includes(name))).toEqual(["bankName"])
        expect(Object.fromEntries(facts)).toMatchObject({
            [STUCK_FACT.workflow]: "accounting.reconcile",
            [STUCK_FACT.step]: "match (accounting.match-payment)",
            [STUCK_FACT.code]: AI_CONFUSED,
            [STUCK_FACT.error]: "amount differs",
            [STUCK_FACT.subject]: "bank-transaction:tx-9",
            [STUCK_FACT.question]: "Mark it paid?",
            [STUCK_FACT.run]: "run-1",
        })
    })
})

/** The engine's outcome-unknown codes, as the runner hands them (a typed code, never words). */
const UNKNOWN: ReadonlySet<string> = new Set(["tool_outcome_unknown"])

/** A tool that declares `repeatable`, one that does not, and one the registry does not hold. */
const FACTS: FailureFacts = {
    repeatable: (tool) => (tool === "repeatable.send" ? true : tool === "plain.write" ? false : null),
}

/** A thrown socket failure: `classifyFailure` calls it transient. */
const socketCut = (): StepTrouble => troubleOfThrow(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }))

/** An outcome-unknown trouble naming its tool (`params.effect`). */
const unknownOf = (tool: string): StepTrouble => ({ ...troubleOfRefusal("tool_outcome_unknown", "no answer"), data: { effect: tool } })

describe("failureClassOf (rule Q-2: typed codes only)", () => {
    it("reads a thrown transient cause as transient, an AI failure as ai_failed, an unknown code as outcome_unknown, the rest permanent", () => {
        expect(failureClassOf(socketCut(), UNKNOWN)).toBe("transient")
        expect(failureClassOf(troubleOfRefusal("AI_TASKS_UNAVAILABLE", "tries spent"), UNKNOWN)).toBe("ai_failed")
        expect(failureClassOf(troubleOfRefusal("GRAPH_NODES_MODEL_ANSWER_INVALID", "schema"), UNKNOWN)).toBe("ai_failed")
        expect(failureClassOf(unknownOf("plain.write"), UNKNOWN)).toBe("outcome_unknown")
        expect(failureClassOf(troubleOfRefusal("customer_opted_out", "refused"), UNKNOWN)).toBe("permanent")
        expect(failureClassOf(troubleOfThrow(new Error("bug")), UNKNOWN)).toBe("permanent")
    })

    it("an outcome-unknown code wins over a transient cause (the call may have acted)", () => {
        expect(failureClassOf({ ...socketCut(), code: "tool_outcome_unknown" }, UNKNOWN)).toBe("outcome_unknown")
    })
})

describe("retryVerdictOf (rule Q-2 on the saga, R80/R81)", () => {
    it.each(["read", "write"] as const)("a transient failure of a %s step runs again after 1, 2, 4, 8 minutes, then stops exhausted", (saga) => {
        const verdicts = [0, 1, 2, 3, 4].map((retried) => retryVerdictOf(saga, "transient", socketCut(), FACTS, retried))

        expect(verdicts).toEqual([
            { kind: "retry", attempt: 1, pauseMs: 60_000 },
            { kind: "retry", attempt: 2, pauseMs: 120_000 },
            { kind: "retry", attempt: 3, pauseMs: 240_000 },
            { kind: "retry", attempt: 4, pauseMs: 480_000 },
            { kind: "stop", why: "exhausted" },
        ])
        expect(RETRY_PAUSES_MS).toEqual([60_000, 120_000, 240_000, 480_000])
    })

    it("an unknown outcome of a repeatable tool runs again (same key through the ledgers), bounded the same way", () => {
        expect(retryVerdictOf("write", "outcome_unknown", unknownOf("repeatable.send"), FACTS, 0)).toEqual({
            kind: "retry",
            attempt: 1,
            pauseMs: 60_000,
        })
        expect(retryVerdictOf("write", "outcome_unknown", unknownOf("repeatable.send"), FACTS, 4)).toEqual({
            kind: "stop",
            why: "exhausted",
        })
    })

    it("an unknown outcome of a tool that is not repeatable stops at once: forward only past a write, not retried on a read", () => {
        expect(retryVerdictOf("write", "outcome_unknown", unknownOf("plain.write"), FACTS, 0)).toEqual({ kind: "stop", why: "forward_only" })
        expect(retryVerdictOf("write", "outcome_unknown", unknownOf("not.held"), FACTS, 0)).toEqual({ kind: "stop", why: "forward_only" })
        expect(retryVerdictOf("read", "outcome_unknown", unknownOf("plain.write"), FACTS, 0)).toEqual({ kind: "stop", why: "not_retried" })
        // An unknown trouble that names no tool cannot be repeated either.
        expect(retryVerdictOf("write", "outcome_unknown", troubleOfRefusal("tool_outcome_unknown", "x"), FACTS, 0)).toEqual({
            kind: "stop",
            why: "forward_only",
        })
    })

    it.each(["read", "write"] as const)("an AI failure and a permanent failure of a %s step are never retried", (saga) => {
        const ai = troubleOfRefusal("AI_TASKS_UNAVAILABLE", "tries spent")
        const refused = troubleOfRefusal("customer_opted_out", "refused")

        expect(retryVerdictOf(saga, "ai_failed", ai, FACTS, 0)).toEqual({ kind: "stop", why: "not_retried" })
        expect(retryVerdictOf(saga, "permanent", refused, FACTS, 0)).toEqual({ kind: "stop", why: "not_retried" })
    })
})
