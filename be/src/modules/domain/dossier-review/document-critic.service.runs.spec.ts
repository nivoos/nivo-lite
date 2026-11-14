import { claimedAiJob } from "@tests/fixtures/builders/brain-ai-effects.builder"
import { passageTextHashOf } from "@modules/domain/knowledge-chunks"
import {
    answered,
    buildCriticSubject,
    ownTruthOf,
    rowOf,
    sectionsOf,
    type OwnTruth,
    type Subject,
} from "@tests/fixtures/builders/dossier-review-critic.builder"
import { NOW, SRC, WS, type Row } from "@tests/fixtures/builders/dossier-review-world.builder"
import { CRITIC_CAPS, takesAnotherTurn, type CritiqueRunEnd } from "./document-critic.contracts"
import type { CritiqueTry } from "./document-critic.port"
import { DossierReviewError, DossierReviewErrorCode } from "./errors/dossier-review.error"
import { SourceCritiqueEntity } from "./persistence/entities"

/**
 * What a critique that stops leaves (a typed state a person or a credit top-up moves on: nothing counts runs any more, the review
 * job's ladder and dead letter judge a failure) and the TURNS of a workspace's documents (D-V-3: one endless critique held the
 * others), through the REAL `DocumentCriticService` on the in-memory world, with a scripted model. The only progress of a run is a passage
 * newly reviewed by the security read (the per-truth verification is deleted). Synthetic data of another trade: the service rules
 * of a bicycle repair workshop.
 */

/** The workshop's service rules: three sections, one passage each. */
const WORKSHOP = [
    "# Puncture repair\n\nA puncture on a standard inner tube is repaired for 60,000 VND while the customer waits.",
    "# Brake service\n\nA full brake service, pads and cables included, costs 250,000 VND and takes one working day.",
    "# Storage\n\nA bicycle left more than 30 days after the repair is ready is charged 20,000 VND per day of storage.",
].join("\n\n")

/** The workshop document's title. */
const TITLE = "Workshop service rules"

/** Its waiting truths, as the reading filed them. */
const TRUTHS: ReadonlyArray<OwnTruth> = [
    { id: "t-puncture", subjectLabel: "Puncture repair", attributeLabel: "Price", value: "60,000 VND", quote: "repaired for 60,000 VND" },
    { id: "t-brakes", subjectLabel: "Brake service", attributeLabel: "Price", value: "250,000 VND", quote: "costs 250,000 VND" },
    { id: "t-storage", subjectLabel: "Storage", attributeLabel: "Daily fee", value: "20,000 VND", quote: "20,000 VND per day of storage" },
]

/** A critic try that answered something that is not the JSON asked for (a paid call). */
const unreadable = (): CritiqueTry => ({ ok: false, reason: "unreadable" })

/** A critic try whose answer was cut at the token cap (a paid call): the next try reads half the passages. */
const cut = (): CritiqueTry => ({ ok: false, reason: "cut" })

/** The workshop document uploaded and read, its critique asked for: no passage reviewed yet. */
const workshop = async (): Promise<Subject> => {
    const subject = await buildCriticSubject()
    subject.world.upload(WORKSHOP)
    subject.world.facts = TRUTHS.map((truth) => ownTruthOf(subject.world, truth, TITLE))
    await subject.critic.request(WS, SRC)
    return subject
}

/** One upkeep tick that goes on with the critique (a RESUME), then the review run that carries out what waits. */
const tick = async (subject: Subject): Promise<boolean> => {
    const waits = await subject.critic.request(WS, SRC, { resume: true })
    await subject.critic.runWaiting(WS, claimedAiJob())
    return waits
}

afterEach(() => {
    jest.restoreAllMocks()
})

describe("a slice of work", () => {
    const end = (changes: Partial<CritiqueRunEnd>): CritiqueRunEnd => ({ state: "not_done", reason: "budget", progressed: false, ...changes })

    it("takes another turn only with progress and more to do", () => {
        expect(takesAnotherTurn(end({ progressed: true }))).toBe(true)
        expect(takesAnotherTurn(end({}))).toBe(false)
        expect(takesAnotherTurn(end({ reason: "credits", progressed: true }))).toBe(false)
        expect(takesAnotherTurn(end({ state: "done", reason: null, progressed: true }))).toBe(false)
    })
})

describe("DocumentCriticService: a critique the model could not read is a typed state, not a count of tries", () => {
    it("a dead model: the run throws the typed outage once (no try is counted here), the critique is left not done (model), the truths work is told, and a run that comes later makes no call for it unless it is handed back", async () => {
        const subject = await workshop()

        await expect(subject.critic.runWaiting(WS, claimedAiJob())).rejects.toMatchObject({ code: DossierReviewErrorCode.ModelUnavailable })

        expect(subject.model.critique).toHaveBeenCalledTimes(1)
        expect(rowOf(subject)).toMatchObject({ state: "not_done", reason: "model" })
        expect(subject.hook.critiqued).toHaveBeenCalledTimes(1)
        // The tick does not go on with it (it is a dead letter's, a person's): it waits for no run and no call is made.
        await expect(subject.critic.request(WS, SRC, { resume: true })).resolves.toBe(false)
        await expect(subject.critic.runWaiting(WS, claimedAiJob())).resolves.toBe(0)
        expect(subject.model.critique).toHaveBeenCalledTimes(1)
        // Handed back (by the ladder's next start, or by a person), it waits again and the next run reads it.
        await expect(subject.critic.retryFailed(WS, null)).resolves.toBe(1)
        expect(rowOf(subject)).toMatchObject({ state: "waiting", reason: null })
    })

    it("a new request (the reading ended again, a person's read again) makes it wait again too", async () => {
        const subject = await workshop()
        await expect(subject.critic.runWaiting(WS, claimedAiJob())).rejects.toBeInstanceOf(DossierReviewError)

        await expect(subject.critic.request(WS, SRC)).resolves.toBe(true)

        expect(rowOf(subject)).toMatchObject({ state: "waiting", reason: null, attempts: 0 })
    })

    it("an answer that was not the JSON asked for is asked ONCE more with that said, and unreadable again is a refusal (a dead letter), never a third ask", async () => {
        const subject = await workshop()
        subject.model.critique.mockImplementation(() => Promise.resolve(unreadable()))

        await expect(subject.critic.runWaiting(WS, claimedAiJob())).rejects.toMatchObject({ code: DossierReviewErrorCode.ModelRefused })

        expect(subject.model.critique).toHaveBeenCalledTimes(2)
        expect(subject.model.critique.mock.calls.map((call) => call[1])).toEqual([undefined, "unreadable"])
        expect(rowOf(subject)).toMatchObject({ state: "not_done", reason: "model" })
        // Unreviewed passages are not served to customers, and nothing of the truths waits on the critique.
        expect(subject.world.chunks.every((chunk) => !chunk.customerReady)).toBe(true)
        const gate = await subject.critic.truthGateOf(WS, SRC)
        expect(gate.held.size).toBe(0)
        expect(subject.world.facts.map((fact) => fact.status)).toEqual(["proposed", "proposed", "proposed"])
    })

    it("a cut answer is asked over half the passages (the next ask is a narrower one, never the same call again)", async () => {
        const subject = await workshop()
        subject.script.push(cut, () => answered([]))

        await expect(subject.critic.runWaiting(WS, claimedAiJob())).rejects.toMatchObject({ code: DossierReviewErrorCode.ModelUnavailable })

        // The cut try, then the narrower one that answered (a passage reviewed); the next call found the model down.
        expect((rowOf(subject).reviewedHashes as ReadonlyArray<string>).length).toBeGreaterThan(0)
        expect(subject.bundles[1]?.changed.length).toBeLessThan(subject.bundles[0]?.changed.length ?? 0)
    })

    it("each model call is keyed by the job and by what it reads: a run again after a crash answers no call twice", async () => {
        const subject = await workshop()
        subject.script.push(() => answered([]))
        const job = claimedAiJob()

        await expect(subject.critic.runWaiting(WS, job)).resolves.toBe(1)

        expect(subject.ledger.keys()).toHaveLength(1)
        expect(subject.ledger.keys()[0]).toMatch(/^job-1:critique:/u)
    })
})

describe("DocumentCriticService: what the upkeep tick moves on", () => {
    it("the empty credit pool is a typed end (no call was made): the critique is not done for credits and the tick resumes it once the pool has credits", async () => {
        const subject = await workshop()
        subject.usage.blockedBy.mockResolvedValue(true)

        await expect(subject.critic.runWaiting(WS, claimedAiJob())).resolves.toBe(1)

        expect(subject.model.critique).not.toHaveBeenCalled()
        expect(rowOf(subject)).toMatchObject({ state: "not_done", reason: "credits" })
        subject.usage.blockedBy.mockResolvedValue(false)
        subject.script.push(() => answered([]))
        await expect(tick(subject)).resolves.toBe(true)
        expect(rowOf(subject)).toMatchObject({ state: "done" })
    })

    it("a critique whose worker went silent is taken back by a resume only after 15 minutes", async () => {
        const subject = await workshop()
        Object.assign(rowOf(subject), { state: "running", startedAt: new Date(NOW.getTime() - 5 * 60_000) })
        await expect(subject.critic.request(WS, SRC, { resume: true })).resolves.toBe(false)
        expect(rowOf(subject)).toMatchObject({ state: "running" })

        rowOf(subject).startedAt = new Date(NOW.getTime() - 20 * 60_000)
        await expect(subject.critic.request(WS, SRC, { resume: true })).resolves.toBe(true)
        expect(rowOf(subject)).toMatchObject({ state: "waiting", reason: null })

        // A done critique, or one waiting already, is no resume's to move.
        rowOf(subject).state = "done"
        await expect(subject.critic.request(WS, SRC, { resume: true })).resolves.toBe(false)
        expect(rowOf(subject)).toMatchObject({ state: "done" })
    })
})

describe("DocumentCriticService: one long critique gives the turn to the workspace's other documents (D-V-3)", () => {
    const OTHER = "55555555-5555-4555-8555-555555555555"
    const LATE = "66666666-6666-4666-8666-666666666666"
    /** More passages than `callsPerCritique` calls of `changedChars` read: the first run ends a slice (`budget`) with progress. */
    const LONG = sectionsOf(1_000)

    /**
     * The in-memory table in the order the service reads it (`requestedAt` ascending; the world itself answers rows in insertion
     * order, so the spec sorts them as the table read does).
     */
    const ordered = (subject: Subject): void => {
        const at = (row: Row): number => (row.requestedAt instanceof Date ? row.requestedAt.getTime() : 0)
        subject.world.critiques.sort((left, right) => at(left) - at(right))
    }

    it("a slice that made progress (`budget`) waits again at the BACK; the documents that waited before it run first; it comes back after them", async () => {
        const subject = await buildCriticSubject()
        subject.world.upload(LONG)
        await subject.critic.request(WS, SRC)
        subject.model.critique.mockImplementation(() => Promise.resolve(answered([])))
        const waitingRow = (sourceId: string, minutesAgo: number): Row => ({
            id: `q-${sourceId}`,
            workspaceId: WS,
            sourceId,
            state: "waiting",
            reason: null,
            attempts: 0,
            reviewedHashes: subject.world.chunks.map((chunk) => passageTextHashOf(chunk.content)),
            verifiedTruths: [],
            modelCalls: 0,
            promptTokens: 0,
            requestedAt: new Date(NOW.getTime() - minutesAgo * 60_000),
            startedAt: null,
        })
        rowOf(subject).requestedAt = new Date(NOW.getTime() - 120 * 60_000)
        subject.world.critiques.push(waitingRow(OTHER, 60))
        ordered(subject)
        const order: Array<string> = []
        const real = subject.critic.critique.bind(subject.critic)
        jest.spyOn(subject.critic, "critique").mockImplementation((workspaceId, sourceId, job) => {
            order.push(sourceId)
            return real(workspaceId, sourceId, job)
        })

        await expect(subject.critic.runWaiting(WS, claimedAiJob())).resolves.toBe(2)
        // The slice made `callsPerCritique` calls and waits again, asked NOW (behind everything that waited), no reason, count 0.
        expect(subject.model.critique).toHaveBeenCalledTimes(CRITIC_CAPS.callsPerCritique)
        expect(rowOf(subject)).toMatchObject({ state: "waiting", reason: null, requestedAt: NOW })
        expect(await subject.critic.hasWaiting(WS)).toBe(true)
        // A document asked for meanwhile, before the slice's end, runs before the slice comes back.
        subject.world.critiques.push(waitingRow(LATE, 1))
        ordered(subject)

        await subject.critic.runWaiting(WS, claimedAiJob())

        expect(order).toEqual([SRC, OTHER, LATE, SRC])
        // Both batches read the waiting critiques the longest-waiting first, at most `perRun` of them.
        expect(subject.world.em.find).toHaveBeenCalledWith(
            SourceCritiqueEntity,
            expect.objectContaining({ where: { workspaceId: WS, state: "waiting" }, order: { requestedAt: "ASC" }, take: CRITIC_CAPS.perRun }),
        )
        expect(rowOf(subject)).toMatchObject({ state: "done", reason: null, waitingPassages: 0 })
        expect(await subject.critic.hasWaiting(WS)).toBe(false)
    })

    it("a critique that failed is NOT waiting: the workspace has nothing to follow up (no tight loop)", async () => {
        const subject = await workshop()

        await expect(subject.critic.runWaiting(WS, claimedAiJob())).rejects.toMatchObject({ code: DossierReviewErrorCode.ModelUnavailable })

        expect(rowOf(subject)).toMatchObject({ state: "not_done", reason: "model" })
        expect(await subject.critic.hasWaiting(WS)).toBe(false)
    })
})
