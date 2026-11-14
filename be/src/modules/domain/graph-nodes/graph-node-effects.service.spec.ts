import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { LOGGER } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { GraphNodesErrorCode } from "./errors/graph-nodes.error"
import { TOOL } from "@nivo-lite/agent-sdk/names"
import {
    GraphNodeEffectsService,
    INTENT_KIND,
    OUTCOME_UNKNOWN_CODES,
    OUTCOME_UNKNOWN_KIND,
    actsOutside,
    ledgerJsonOf,
    ledgerKeyOf,
    placeOf,
} from "./graph-node-effects.service"
import { NODE_EFFECT_STORE, type NodeEffectStore, type StoredEffect } from "./node-effect-store.port"

const WS = "11111111-1111-4111-8111-111111111111"
const AT = "2026-11-06T10:00:00.000Z"
const CALL = { key: "run:0", dedupeKey: null }

/** An act that stays inside NIVO's database by its spec (NIVO's own records): written once AFTER the act (QB-P3 rule I-2). */
const INSIDE = TOOL.recordCreate

/** An act outside: a plugin's effect no spec declares (the engine cannot prove it stays inside). */
const OUTSIDE = "core.send"

/** A ledger row as the store answers it: the effect that wrote the key and the subject it kept. */
const recordedAs = (subjectEntity: string, subjectId: string, effectId = "core.send", more: Partial<StoredEffect> = {}): StoredEffect => ({
    effectKey: "call:run:0",
    effectId,
    subjectEntity,
    subjectId,
    undoneAt: null,
    runId: null,
    stepKey: null,
    args: null,
    facts: null,
    createdAt: AT,
    ...more,
})

const build = async () => {
    const store = mock<NodeEffectStore>()
    const logger = mock<Logger>()
    store.byKey.mockResolvedValue(null)
    store.insert.mockResolvedValue(true)
    store.resettle.mockResolvedValue(true)
    store.release.mockResolvedValue(true)
    const moduleRef = await Test.createTestingModule({
        providers: [
            GraphNodeEffectsService,
            { provide: NODE_EFFECT_STORE, useValue: store },
            { provide: LOGGER, useValue: logger },
        ],
    }).compile()
    return { service: moduleRef.get(GraphNodeEffectsService), store, logger }
}

describe("ledgerKeyOf", () => {
    it("keys a call by its business key when it has one, else by the run step's own", () => {
        expect(ledgerKeyOf({ key: "run:0", dedupeKey: null })).toBe("call:run:0")
        expect(ledgerKeyOf({ key: "run:0", dedupeKey: "pay:o1" })).toBe("dedupe:pay:o1")
    })

    it("keeps a key too long for the ledger as its digest: the same call gives the same key, another call another", () => {
        const long = { key: `run:${"k".repeat(240)}`, dedupeKey: null }
        const key = ledgerKeyOf(long)
        expect(key).toMatch(/^digest:[0-9a-f]{64}$/)
        expect(ledgerKeyOf({ ...long })).toBe(key)
        expect(ledgerKeyOf({ key: `${long.key}x`, dedupeKey: null })).not.toBe(key)
    })
})

describe("GraphNodeEffectsService.once", () => {
    it("acts once and writes the subject under the key, after the lookup and outside any transaction (an act inside)", async () => {
        const { service, store } = await build()
        const act = jest.fn().mockResolvedValue({ kind: "message", id: "m-1" })

        await expect(service.once(WS, INSIDE, CALL, act)).resolves.toEqual({ kind: "message", id: "m-1" })

        expect(act).toHaveBeenCalledTimes(1)
        expect(store.byKey).toHaveBeenCalledWith(WS, "call:run:0")
        expect(store.resettle).not.toHaveBeenCalled()
        expect(store.insert).toHaveBeenCalledWith(WS, {
            effectKey: "call:run:0",
            effectId: INSIDE,
            runId: null,
            stepKey: null,
            args: null,
            subjectEntity: "message",
            subjectId: "m-1",
            facts: null,
        })
    })

    it("answers the first subject of a key already written and acts no more", async () => {
        const { service, store, logger } = await build()
        store.byKey.mockResolvedValue(recordedAs("message", "m-0"))
        const act = jest.fn()

        await expect(service.once(WS, "core.send", { key: "run:0", dedupeKey: "pay:o1" }, act)).resolves.toEqual({
            kind: "message",
            id: "m-0",
        })

        expect(act).not.toHaveBeenCalled()
        expect(store.insert).not.toHaveBeenCalled()
        expect(logger.info).toHaveBeenCalledWith("graph_nodes.effect_replayed", {
            workspaceId: WS,
            effect: "core.send",
        })
    })

    it("never answers one effect with what another kept: a key another effect holds is refused before anything acts", async () => {
        const { service, store } = await build()
        store.byKey.mockResolvedValue(recordedAs("message", "m-0", "nivo.tool.customer.message.send"))
        const act = jest.fn()

        await expect(service.once(WS, "nivo.tool.order.confirm", CALL, act)).rejects.toMatchObject({
            code: GraphNodesErrorCode.EffectKeyTaken,
            params: { effect: "nivo.tool.order.confirm", heldBy: "nivo.tool.customer.message.send" },
        })

        expect(act).not.toHaveBeenCalled()
        expect(store.insert).not.toHaveBeenCalled()
    })

    it("answers the subject of the record that won when two runs raced to write the key", async () => {
        const { service, store } = await build()
        store.byKey.mockResolvedValueOnce(null).mockResolvedValueOnce(recordedAs("message", "m-0", INSIDE))
        store.insert.mockResolvedValue(false)
        const act = jest.fn().mockResolvedValue({ kind: "message", id: "m-1" })

        await expect(service.once(WS, INSIDE, CALL, act)).resolves.toEqual({ kind: "message", id: "m-0" })
    })
})

describe("GraphNodeEffectsService.once, when the act answers a refusal", () => {
    const REFUSED = { kind: "refused", id: "needs_owner_note", facts: { amountVnd: 5_000_000, thresholdVnd: 2_000_000 } }

    it("answers the refusal with its facts and writes nothing under the key: a refusal changed nothing", async () => {
        const { service, store } = await build()
        const act = jest.fn().mockResolvedValue(REFUSED)

        await expect(service.once(WS, INSIDE, CALL, act)).resolves.toEqual(REFUSED)

        expect(act).toHaveBeenCalledTimes(1)
        expect(store.insert).not.toHaveBeenCalled()
    })

    it("really makes the call again under the same key after a refusal, and keeps the subject of the call that went through", async () => {
        const { service, store } = await build()
        const act = jest.fn().mockResolvedValueOnce(REFUSED).mockResolvedValueOnce({ kind: "order", id: "o-1" })

        await expect(service.once(WS, INSIDE, CALL, act)).resolves.toEqual(REFUSED)
        await expect(service.once(WS, INSIDE, CALL, act)).resolves.toEqual({ kind: "order", id: "o-1" })

        expect(act).toHaveBeenCalledTimes(2)
        expect(store.insert).toHaveBeenCalledTimes(1)
        expect(store.insert).toHaveBeenCalledWith(
            WS,
            expect.objectContaining({ effectKey: "call:run:0", effectId: INSIDE, subjectEntity: "order", subjectId: "o-1" }),
        )
    })
})

describe("GraphNodeEffectsService.once, when the ledger cannot answer", () => {
    it("fails when the key is neither written nor held by a winner", async () => {
        const { service, store } = await build()
        const act = jest.fn().mockResolvedValue({ kind: "message", id: "m-1" })
        store.insert.mockResolvedValue(false)

        await expect(service.once(WS, "core.send", CALL, act)).rejects.toMatchObject({
            code: GraphNodesErrorCode.EffectNotRecorded,
        })
    })
})

const RUN = "0f8e2c1a-5b6d-4e7f-8a9b-0c1d2e3f4a5b"
const STEP_CALL = { key: `${RUN}:answer:0123456789abcdef`, dedupeKey: null }

describe("placeOf", () => {
    it("reads the run and the step of a step's call key, an undo's key, and nothing of another key", () => {
        expect(placeOf(STEP_CALL.key)).toEqual({ runId: RUN, stepKey: "answer" })
        expect(placeOf(`${RUN}:loop:item:0123456789abcdef`)).toEqual({ runId: RUN, stepKey: "loop:item" })
        expect(placeOf(`${RUN}:order:undo:2`)).toEqual({ runId: RUN, stepKey: "order" })
        expect(placeOf("mcp:agent-1:op-7")).toBeNull()
        expect(placeOf("run:0")).toBeNull()
    })
})

describe("ledgerJsonOf", () => {
    it("keeps plain JSON within the ledger's bounds, and leaves out what it cannot hold", () => {
        expect(ledgerJsonOf({ text: "Da nhan", at: new Date(AT), skip: undefined })).toEqual({ text: "Da nhan", at: AT })
        expect(ledgerJsonOf(undefined)).toBeNull()
        expect(ledgerJsonOf(["a"])).toBeNull()
        expect(ledgerJsonOf({ text: "x".repeat(20_001) })).toBeNull()
        expect(ledgerJsonOf({ big: BigInt(1) })).toBeNull()
    })
})

describe("GraphNodeEffectsService.once, D.1: the run, the step, the arguments and the facts of each call", () => {
    it("keeps them beside the subject, the place read from the step's call key", async () => {
        const { service, store } = await build()
        const act = jest.fn().mockResolvedValue({ kind: "message", id: "m-1", facts: { conversationId: "c-1" } })

        await service.once(WS, "nivo.tool.customer.message.send", STEP_CALL, act, { args: { conversationId: "c-1", text: "Da nhan" } })

        // The customer send is a provider's act: its intent is written first with the run, the step and the arguments, then filled.
        expect(store.insert).toHaveBeenCalledWith(WS, {
            effectKey: `call:${STEP_CALL.key}`,
            effectId: "nivo.tool.customer.message.send",
            runId: RUN,
            stepKey: "answer",
            args: { conversationId: "c-1", text: "Da nhan" },
            subjectEntity: INTENT_KIND,
            subjectId: INTENT_KIND,
            facts: null,
        })
        expect(store.resettle).toHaveBeenCalledWith(WS, `call:${STEP_CALL.key}`, INTENT_KIND, {
            subjectEntity: "message",
            subjectId: "m-1",
            facts: { conversationId: "c-1" },
        })
    })

    it("takes the place its caller names over the key's", async () => {
        const { service, store } = await build()

        await service.once(WS, INSIDE, CALL, jest.fn().mockResolvedValue({ kind: "message", id: "m-1" }), {
            place: { runId: RUN, stepKey: "match" },
        })

        expect(store.insert).toHaveBeenCalledWith(WS, {
            effectKey: "call:run:0",
            effectId: INSIDE,
            runId: RUN,
            stepKey: "match",
            args: null,
            subjectEntity: "message",
            subjectId: "m-1",
            facts: null,
        })
    })

    it("answers a replay with the facts the first call answered, not the subject alone", async () => {
        const { service, store } = await build()
        store.byKey.mockResolvedValue(recordedAs("order", "o-1", "nivo.tool.order.confirm", { facts: { totalVnd: 100_000 } }))

        await expect(service.once(WS, "nivo.tool.order.confirm", CALL, jest.fn())).resolves.toEqual({
            kind: "order",
            id: "o-1",
            facts: { totalVnd: 100_000 },
        })
    })
})

describe("GraphNodeEffectsService.once, an outcome nobody knows", () => {
    const unknown = (code: string): Error => Object.assign(new Error("sent, no answer"), { code })

    it.each([...OUTCOME_UNKNOWN_CODES])("keeps a call that ended with %s and rethrows it untouched", async (code: string) => {
        const { service, store } = await build()
        const thrown = unknown(code)

        await expect(service.once(WS, INSIDE, STEP_CALL, jest.fn().mockRejectedValue(thrown))).rejects.toBe(thrown)

        expect(store.insert).toHaveBeenCalledWith(WS, {
            effectKey: `call:${STEP_CALL.key}`,
            effectId: INSIDE,
            runId: RUN,
            stepKey: "answer",
            args: null,
            subjectEntity: OUTCOME_UNKNOWN_KIND,
            subjectId: code,
            facts: { code },
        })
    })

    it("never makes such a call again: the key answers the same code, nothing acts", async () => {
        const { service, store } = await build()
        store.byKey.mockResolvedValue(recordedAs(OUTCOME_UNKNOWN_KIND, "tool_outcome_unknown", "nivo.tool.agent.tag"))
        const act = jest.fn()

        await expect(service.once(WS, "nivo.tool.agent.tag", STEP_CALL, act)).rejects.toMatchObject({ code: "tool_outcome_unknown" })

        expect(act).not.toHaveBeenCalled()
        expect(store.insert).not.toHaveBeenCalled()
    })

    it("keeps nothing for any other throw (the call may be made again, as before); a failed keep never hides the act's error", async () => {
        const { service, store } = await build()
        const other = Object.assign(new Error("refused"), { code: "provider_down" })

        await expect(service.once(WS, INSIDE, STEP_CALL, jest.fn().mockRejectedValue(other))).rejects.toBe(other)
        expect(store.insert).not.toHaveBeenCalled()

        store.insert.mockRejectedValue(new Error("db down"))
        const thrown = unknown("tool_outcome_unknown")
        await expect(service.once(WS, INSIDE, STEP_CALL, jest.fn().mockRejectedValue(thrown))).rejects.toBe(thrown)
    })
})

describe("GraphNodeEffectsService.recordsOf", () => {
    it("reads a run step's records by run and step, oldest first, cut to the effects named, with their arguments and time", async () => {
        const { service, store } = await build()
        const args = { conversationId: "c-1", text: "Da nhan" }
        store.ofStep.mockResolvedValue([
            recordedAs("message", "m-1", "nivo.tool.customer.message.send", { args }),
            recordedAs("team-message", "t-1", "nivo.tool.team.message.post"),
        ])

        await expect(service.recordsOf(WS, { runId: RUN, stepKey: "match" }, ["nivo.tool.customer.message.send"])).resolves.toEqual([
            { effect: "nivo.tool.customer.message.send", args, subject: { kind: "message", id: "m-1" }, at: AT },
        ])
        expect(store.ofStep).toHaveBeenCalledWith(WS, RUN, "match", 100)
    })
})

describe("actsOutside (QB-P3 rule I-2: from declared data only)", () => {
    it("is false for the engine's own facts, a read and NIVO's own records; true for a provider's tool and every undeclared id", () => {
        expect(actsOutside("engine.step-instant")).toBe(false)
        expect(actsOutside(TOOL.domainRenewalGet)).toBe(false)
        expect(actsOutside(TOOL.recordCreate)).toBe(false)
        expect(actsOutside(TOOL.customerMessageSend)).toBe(true)
        expect(actsOutside(TOOL.domainRenewalCreate)).toBe(true)
        expect(actsOutside("ledger.write")).toBe(true)
        expect(actsOutside("nivo.tool.test.money.move")).toBe(true)
    })
})

describe("GraphNodeEffectsService.once, INTENT BEFORE ACT (QB-P3 rule I-1)", () => {
    it("writes the intent BEFORE the act, then fills it with the subject the act answered", async () => {
        const { service, store } = await build()
        const order: Array<string> = []
        store.insert.mockImplementation(() => {
            order.push("intent")
            return Promise.resolve(true)
        })
        store.resettle.mockImplementation(() => {
            order.push("fill")
            return Promise.resolve(true)
        })
        const act = jest.fn(() => {
            order.push("act")
            return Promise.resolve({ kind: "message", id: "m-1", facts: { a: 1 } })
        })

        await expect(service.once(WS, OUTSIDE, CALL, act)).resolves.toEqual({ kind: "message", id: "m-1", facts: { a: 1 } })

        expect(order).toEqual(["intent", "act", "fill"])
        expect(store.insert).toHaveBeenCalledWith(WS, expect.objectContaining({ effectKey: "call:run:0", subjectEntity: INTENT_KIND, facts: null }))
        expect(store.resettle).toHaveBeenCalledWith(WS, "call:run:0", INTENT_KIND, { subjectEntity: "message", subjectId: "m-1", facts: { a: 1 } })
    })

    it("a refusal releases the intent (nothing happened): the same key really acts again later", async () => {
        const { service, store } = await build()
        const act = jest.fn().mockResolvedValue({ kind: "refused", id: "no_stock" })

        await expect(service.once(WS, OUTSIDE, CALL, act)).resolves.toEqual({ kind: "refused", id: "no_stock" })

        expect(store.release).toHaveBeenCalledWith(WS, "call:run:0", INTENT_KIND)
        expect(store.resettle).not.toHaveBeenCalled()
    })

    it("a throw that is not of the outcome-unknown codes releases the intent and rethrows the act's own error", async () => {
        const { service, store } = await build()
        const refused = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" })

        await expect(service.once(WS, OUTSIDE, CALL, jest.fn().mockRejectedValue(refused))).rejects.toBe(refused)

        expect(store.release).toHaveBeenCalledWith(WS, "call:run:0", INTENT_KIND)
    })

    it.each([...OUTCOME_UNKNOWN_CODES])("an act that ends with %s settles the intent as outcome-unknown", async (code: string) => {
        const { service, store } = await build()
        const thrown = Object.assign(new Error("sent, no answer"), { code })

        await expect(service.once(WS, OUTSIDE, CALL, jest.fn().mockRejectedValue(thrown))).rejects.toBe(thrown)

        expect(store.resettle).toHaveBeenCalledWith(WS, "call:run:0", INTENT_KIND, {
            subjectEntity: OUTCOME_UNKNOWN_KIND,
            subjectId: code,
            facts: { code },
        })
        expect(store.release).not.toHaveBeenCalled()
    })

    it("an intent a later call finds with NO result is an outcome unknown: nothing acts again (a plain write)", async () => {
        const { service, store } = await build()
        store.byKey.mockResolvedValue(recordedAs(INTENT_KIND, INTENT_KIND, OUTSIDE))
        const act = jest.fn()

        await expect(service.once(WS, OUTSIDE, CALL, act)).rejects.toMatchObject({
            code: "tool_outcome_unknown",
            params: { effect: OUTSIDE, open: INTENT_KIND },
        })

        expect(act).not.toHaveBeenCalled()
        expect(store.insert).not.toHaveBeenCalled()
    })

    it("an intent with no result of a REPEATABLE tool is made again under the same key and settles the intent (rule Q-3)", async () => {
        const { service, store } = await build()
        store.byKey.mockResolvedValue(recordedAs(INTENT_KIND, INTENT_KIND, TOOL.customerMessageSend))
        const act = jest.fn().mockResolvedValue({ kind: "message", id: "m-2" })

        await expect(service.once(WS, TOOL.customerMessageSend, CALL, act)).resolves.toEqual({ kind: "message", id: "m-2" })

        expect(act).toHaveBeenCalledTimes(1)
        expect(store.insert).not.toHaveBeenCalled()
        expect(store.resettle).toHaveBeenCalledWith(WS, "call:run:0", INTENT_KIND, { subjectEntity: "message", subjectId: "m-2", facts: null })
    })

    it("two tries racing for the intent: the loser answers as the row the winner holds (an intent still open = unknown)", async () => {
        const { service, store } = await build()
        store.byKey.mockResolvedValueOnce(null).mockResolvedValueOnce(recordedAs(INTENT_KIND, INTENT_KIND, OUTSIDE))
        store.insert.mockResolvedValue(false)
        const act = jest.fn()

        await expect(service.once(WS, OUTSIDE, CALL, act)).rejects.toMatchObject({ code: "tool_outcome_unknown" })
        expect(act).not.toHaveBeenCalled()
    })

    it("a fill that fails leaves the intent: the write's failure is the caller's, and a later call reads an unknown outcome", async () => {
        const { service, store } = await build()
        store.resettle.mockRejectedValue(new Error("db down"))

        await expect(service.once(WS, OUTSIDE, CALL, jest.fn().mockResolvedValue({ kind: "message", id: "m-1" }))).rejects.toThrow("db down")
        expect(store.release).not.toHaveBeenCalled()
    })
})

describe("GraphNodeEffectsService.settleOpen (QB-P3 rule I-3: a confirmation read settles an open row)", () => {
    it("settles an intent first, else an outcome kept unknown, with the subject the read proved", async () => {
        const { service, store } = await build()
        store.resettle.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
        const proved = { kind: "confirmed", id: TOOL.domainRenewalGet, facts: { outcome: "renewed" } }

        await expect(service.settleOpen(WS, CALL, proved)).resolves.toBe(true)

        const settled = { subjectEntity: "confirmed", subjectId: TOOL.domainRenewalGet, facts: { outcome: "renewed" } }
        expect(store.resettle).toHaveBeenNthCalledWith(1, WS, "call:run:0", INTENT_KIND, settled)
        expect(store.resettle).toHaveBeenNthCalledWith(2, WS, "call:run:0", OUTCOME_UNKNOWN_KIND, settled)
    })
})

describe("GraphNodeEffectsService.once, through the platform's ONE rule book (QB-EFFECTS rules E-1..E-3)", () => {
    it("makes an unknown row of a REPEATABLE tool an intent again before acting, then settles it from the intent", async () => {
        const { service, store } = await build()
        store.byKey.mockResolvedValue(recordedAs(OUTCOME_UNKNOWN_KIND, "delivery_outcome_unknown", TOOL.customerMessageSend))
        const order: Array<string> = []
        store.resettle.mockImplementation((_ws, _key, fromKind) => {
            order.push(`from:${fromKind}`)
            return Promise.resolve(true)
        })
        const act = jest.fn(() => {
            order.push("act")
            return Promise.resolve({ kind: "message", id: "m-3" })
        })

        await expect(service.once(WS, TOOL.customerMessageSend, CALL, act)).resolves.toEqual({ kind: "message", id: "m-3" })

        expect(order).toEqual([`from:${OUTCOME_UNKNOWN_KIND}`, "act", `from:${INTENT_KIND}`])
        expect(store.insert).not.toHaveBeenCalled()
    })

    it("an act whose fill finds no open row answers what the key holds and never acts again", async () => {
        const { service, store } = await build()
        store.byKey.mockResolvedValueOnce(null).mockResolvedValueOnce(recordedAs("message", "m-0", OUTSIDE))
        store.resettle.mockResolvedValue(false)
        const act = jest.fn().mockResolvedValue({ kind: "message", id: "m-1" })

        await expect(service.once(WS, OUTSIDE, CALL, act)).resolves.toEqual({ kind: "message", id: "m-0" })

        expect(act).toHaveBeenCalledTimes(1)
    })

    it("an act whose fill finds no open row and an open key left is an outcome unknown, never a second act", async () => {
        const { service, store } = await build()
        store.byKey.mockResolvedValueOnce(null).mockResolvedValueOnce(recordedAs(INTENT_KIND, INTENT_KIND, TOOL.customerMessageSend))
        store.resettle.mockResolvedValue(false)
        const act = jest.fn().mockResolvedValue({ kind: "message", id: "m-1" })

        await expect(service.once(WS, TOOL.customerMessageSend, CALL, act)).rejects.toMatchObject({ code: "tool_outcome_unknown" })

        expect(act).toHaveBeenCalledTimes(1)
    })
})
