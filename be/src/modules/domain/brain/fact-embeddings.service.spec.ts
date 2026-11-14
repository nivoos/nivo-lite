import { Test } from "@nestjs/testing"
import { mock, mockEntityManager } from "@starci/jest-preset"
import { BrainFactEmbeddingsService, BrainFactsReadService, BrainFactsService, factEmbedHashOf } from "@modules/domain/brain-facts"
import type { FactEmbeddingState, FactRecord } from "@modules/domain/brain-facts"
import { UsageMeterService } from "@modules/domain/knowledge"
import { EMBEDDING_DIMENSIONS } from "@modules/domain/knowledge-chunks"
import { AI } from "@modules/integrations/ai"
import type { AiService } from "@modules/integrations/ai"
import { LOGGER } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { BrainLogEvent } from "./brain.log-events"
import { VectorSyncService } from "@modules/domain/vector-sync"
import { FactEmbeddingsService } from "./fact-embeddings.service"
import { ModelJsonService } from "./model-json.service"
import { EMBEDDING_PROFILE, EMBEDDING_WS, embeddingFactOf, embeddingVectorOf, parsedJsonOf, scriptEmbeddingDoubles } from "@tests/fixtures/builders/brain-embeddings.builder"

const WS = EMBEDDING_WS
const PROFILE = EMBEDDING_PROFILE
const factOf = embeddingFactOf
const parsedJson = parsedJsonOf
const vector = embeddingVectorOf

const build = async (states: ReadonlyArray<FactEmbeddingState>) => {
    const ai = mock<AiService>()
    const logger = mock<Logger>()
    const usage = mock<UsageMeterService>()
    const vectors = mock<BrainFactEmbeddingsService>()
    const facts = mock<BrainFactsService>()
    const json = mock<ModelJsonService>()
    const reads = mock<BrainFactsReadService>()
    const sync = mock<VectorSyncService>()
    scriptEmbeddingDoubles({ ai, vectors, reads, sync }, states)
    const moduleRef = await Test.createTestingModule({
        providers: [
            FactEmbeddingsService,
            { provide: AI, useValue: ai },
            { provide: LOGGER, useValue: logger },
            { provide: UsageMeterService, useValue: usage },
            { provide: BrainFactEmbeddingsService, useValue: vectors },
            { provide: BrainFactsService, useValue: facts },
            { provide: ModelJsonService, useValue: json },
            { provide: BrainFactsReadService, useValue: reads },
            { provide: VectorSyncService, useValue: sync },
        ],
    }).compile()
    return { service: moduleRef.get(FactEmbeddingsService), ai, logger, usage, vectors, facts, json, reads, sync }
}

describe("FactEmbeddingsService.embedLines: the one embedding loop, never twice for the same line", () => {
    const current = factOf({ id: "same" })
    const changed = factOf({ id: "changed", value: "35.000" })
    const oldIdentity = factOf({ id: "old-profile" })
    const fresh = factOf({ id: "fresh" })
    const currentState: FactEmbeddingState = {
        fact: current,
        stored: { model: PROFILE, dimensions: EMBEDDING_DIMENSIONS, hash: factEmbedHashOf(current) },
    }
    const states: ReadonlyArray<FactEmbeddingState> = [
        currentState,
        { fact: changed, stored: { model: PROFILE, dimensions: EMBEDDING_DIMENSIONS, hash: factEmbedHashOf(current) } },
        {
            fact: oldIdentity,
            stored: { model: "embed-v0", dimensions: EMBEDDING_DIMENSIONS, hash: factEmbedHashOf(oldIdentity) },
        },
        { fact: fresh, stored: { model: null, dimensions: null, hash: null } },
    ]

    it("sends only the changed, re-indexed and new lines, hands the batch to the vector index in ONE hand-over, meters the call", async () => {
        const { service, ai, usage, sync } = await build(states)
        ai.embed.mockResolvedValue({ vectors: [vector(1), vector(2), vector(3)], usage: null })

        await expect(service.embedLines(WS, states)).resolves.toEqual({
            embedded: 3,
            adopted: 0,
            unchanged: 1,
            stopped: false,
        })

        expect(ai.embed.mock.calls.map((call) => call[0])).toEqual([
            {
                input: [
                    "Phi ship - noi thanh: 35.000 d",
                    "Phi ship - noi thanh: 30.000 d",
                    "Phi ship - noi thanh: 30.000 d",
                ],
                dimensions: EMBEDDING_DIMENSIONS,
                timeoutMs: 20_000,
            },
        ])
        // The index holds the vectors; Postgres records identity, hash and indexed_at once the index accepted them (the sync's stamp).
        expect(sync.accept.mock.calls).toEqual([
            [
                "truth",
                WS,
                new Map([
                    ["changed", vector(1)],
                    ["old-profile", vector(2)],
                    ["fresh", vector(3)],
                ]),
            ],
        ])
        // The adoption was asked first for the three stale lines, by id.
        expect(sync.adopt).toHaveBeenCalledWith("truth", WS, ["changed", "old-profile", "fresh"])
        expect(usage.record).toHaveBeenCalledWith(
            expect.objectContaining({ workspaceId: WS, kind: "embedding", model: PROFILE }),
        )
    })

    it("calls nothing when every line is current", async () => {
        const { service, ai } = await build([currentState])

        await expect(service.embedLines(WS, [currentState])).resolves.toEqual({
            embedded: 0,
            adopted: 0,
            unchanged: 1,
            stopped: false,
        })
        expect(ai.embed).not.toHaveBeenCalled()
    })

    it("names its identity from config (the AI profile) and the index's dimensions", async () => {
        const { service } = await build([])

        expect(service.identity()).toEqual({ model: PROFILE, dimensions: EMBEDDING_DIMENSIONS })
    })
})

describe("FactEmbeddingsService: an announcement queues the sync job of the changed facts and embeds nothing", () => {
    it("listens to the facts store when its module starts; an announcement writes the vector.sync job of EVERY changed fact and reads and embeds nothing", async () => {
        const { service, facts, ai, vectors, sync } = await build([])

        service.onModuleInit()
        expect(facts.whenChanged).toHaveBeenCalledWith(service)

        await expect(service.factsChanged(WS, ["deb9154f", "deb9154f"])).resolves.toBeUndefined()

        // Every changed fact gets its sync job, so a superseded or retired truth loses its point; the job makes the points.
        expect(sync.changed).toHaveBeenCalledWith("truth", WS, ["deb9154f", "deb9154f"], undefined)
        expect(vectors.statesOf).not.toHaveBeenCalled()
        expect(sync.adopt).not.toHaveBeenCalled()
        expect(sync.accept).not.toHaveBeenCalled()
        expect(ai.embed).not.toHaveBeenCalled()
    })

    it("never fails the write: a sync job that cannot be written is logged, never thrown (the vector reconcile finds what a lost job left)", async () => {
        const { service, logger, sync } = await build([])
        sync.changed.mockRejectedValue(new Error("db down"))

        await expect(service.factsChanged(WS, ["f1"])).resolves.toBeUndefined()

        expect(logger.error).toHaveBeenCalledWith(BrainLogEvent.EmbeddingsFailed, expect.any(Error), { workspaceId: WS })
    })
})

describe("FactEmbeddingsService: told inside a job's finishing transaction", () => {
    it("writes the vector.sync job of the changed facts in THAT transaction and lets a failure throw", async () => {
        const { service, logger, sync } = await build([])
        const tx = mockEntityManager({})

        await expect(service.factsChanged(WS, ["f1"], tx)).resolves.toBeUndefined()
        expect(sync.changed).toHaveBeenCalledWith("truth", WS, ["f1"], tx)

        const cause = new Error("db down")
        sync.changed.mockRejectedValue(cause)
        await expect(service.factsChanged(WS, ["f1"], tx)).rejects.toBe(cause)
        expect(logger.error).not.toHaveBeenCalled()
    })
})

describe("FactEmbeddingsService.recheckBeforeForce: the truths put in force since a truth was filed (TRIAGE-2)", () => {
    // Synthetic laundry truths: the same price in two documents read in parallel.
    const mine = factOf({
        id: "mine",
        status: "proposed",
        subjectKey: "shirt-washing",
        subjectLabel: "Shirt washing",
        attribute: "price",
        attributeLabel: "price",
        value: "20,000 VND",
        proposedAt: "2026-11-12T01:00:00.000Z",
        decidedAt: null,
    })
    const later = factOf({ id: "later", subjectKey: "washing-a-shirt", subjectLabel: "Washing a shirt", value: "20,000 VND", decidedAt: "2026-11-12T01:05:00.000Z" })
    const older = factOf({ id: "older", subjectKey: "washing-a-shirt", subjectLabel: "Washing a shirt", value: "20,000 VND", decidedAt: "2026-11-12T00:30:00.000Z" })
    const verdictOf = (verdict: object) => ({
        ok: true as const,
        answer: {
            text: JSON.stringify(verdict),
            parsed: null,
            model: "sonnet",
            usage: { promptTokens: 60, completionTokens: 12, totalTokens: 72, costUsd: 0 },
            retrieved: 0,
            served: { upstream: "anthropic", finishReason: "end_turn", durationMs: 400 },
        },
    })
    const ready = async (candidates: ReadonlyArray<FactRecord>, verdict: object) => {
        const parts = await build([])
        parts.vectors.nearestTo.mockResolvedValue([])
        parts.reads.wordHits.mockResolvedValue([...candidates])
        parts.usage.blockedBy.mockResolvedValue(false)
        parts.ai.attempt.mockResolvedValue(verdictOf(verdict))
        parts.json.jsonOf.mockImplementation(parsedJson)
        parts.facts.flagSameMeaning.mockResolvedValue(true)
        parts.facts.mergeDuplicate.mockResolvedValue(later)
        return parts
    }

    it("joins a truth put in force after it was filed when the judge says the same truth with the same value", async () => {
        const t = await ready([later], { same: 1, sameValue: true, sameScope: true })
        await expect(t.service.recheckBeforeForce(WS, mine)).resolves.toBe("duplicate")
        expect(t.facts.mergeDuplicate).toHaveBeenCalledWith(WS, "mine", "later")
    })

    it("flags another value of the same truth for the founder", async () => {
        const t = await ready([factOf({ ...later, value: "25,000 VND" })], { same: 1, sameValue: false, sameScope: true })
        await expect(t.service.recheckBeforeForce(WS, mine)).resolves.toBe("flagged")
        expect(t.facts.flagSameMeaning).toHaveBeenCalledWith(WS, "mine", "later")
    })

    it("shows the judge a truth put in force since whose labels name other numbers (the judge alone reads likeness)", async () => {
        // Another document filed the same price as "per 5 shirts" while this one says "per shirt": code no longer hides the pair.
        const perFive = factOf({ ...later, id: "per-five", subjectKey: "washing-5-shirts", subjectLabel: "Washing 5 shirts", value: "90,000 VND" })
        const perShirt = factOf({ ...mine, subjectKey: "washing-1-shirt", subjectLabel: "Washing 1 shirt" })
        const t = await ready([perFive], { same: 1, sameValue: false, sameScope: true })
        await expect(t.service.recheckBeforeForce(WS, perShirt)).resolves.toBe("flagged")
        expect(t.ai.attempt).toHaveBeenCalledTimes(1)
        expect(t.ai.attempt.mock.calls[0]?.[0].messages[1]?.content).toContain("1. Washing 5 shirts")
        expect(t.facts.flagSameMeaning).toHaveBeenCalledWith(WS, "mine", "per-five")
    })

    it("makes no call when nothing came in force since it was filed (its filing-time check already saw those)", async () => {
        const t = await ready([older], { same: 1, sameValue: true })
        await expect(t.service.recheckBeforeForce(WS, mine)).resolves.toBe("clear")
        expect(t.ai.attempt).not.toHaveBeenCalled()
    })

    it("says clear for a different truth, a truth already linked, and on a failure", async () => {
        const t = await ready([later], { same: null })
        await expect(t.service.recheckBeforeForce(WS, mine)).resolves.toBe("clear")
        await expect(t.service.recheckBeforeForce(WS, factOf({ ...mine, conflictWith: "x" }))).resolves.toBe("clear")
        t.reads.wordHits.mockRejectedValue(new Error("down"))
        await expect(t.service.recheckBeforeForce(WS, mine)).resolves.toBe("clear")
    })
})
