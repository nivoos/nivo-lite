import { eventOfJobId, jobParkedViewOf, type JobParkedWords } from "./jobParked"

const words: JobParkedWords = {
    nivoName: "NIVO",
    chip: "chip",
    titleOf: (job) => `title:${job}`,
    nameOf: (job) => `name:${job}`,
    classOf: (failureClass) => `class:${failureClass}`,
    labels: { resume: "resume", close: "close", closeReasonLabel: "reason", closeSubmit: "submit", cancel: "cancel" },
    detailsLabel: "details",
    factsLabel: "facts",
    factJob: "Job",
    factClass: "Class",
    factReason: "Reason",
    factSince: "Since",
    timeOf: (iso) => `time:${iso}`,
    sinceOf: (iso) => `since:${iso}`,
}

const card = {
    job: "knowledge.index",
    jobId: "5f1b0c52-2f5f-4f5e-9d0e-0c8f9b1d2a33",
    failureClass: "input",
    reason: "KNOWLEDGE_UNREADABLE",
    episode: 0,
    since: "2026-11-14T10:00:00Z",
}

describe("eventOfJobId", () => {
    it("splits a buried event's id at the last colon: the queue holds none", () => {
        expect(eventOfJobId("event:zalo_inbound:ev:9")).toEqual({ queue: "zalo_inbound:ev", eventId: "9" })
        expect(eventOfJobId("event:meta-inbound:abc")).toEqual({ queue: "meta-inbound", eventId: "abc" })
    })

    it("is none for a job id and for a malformed event id", () => {
        expect(eventOfJobId(card.jobId)).toBeNull()
        expect(eventOfJobId("event:onlyqueue")).toBeNull()
        expect(eventOfJobId("event:queue:")).toBeNull()
    })
})

describe("jobParkedViewOf", () => {
    it("words the job and its class and keeps the raw codes in the folded facts only", () => {
        const view = jobParkedViewOf(card, words)
        expect(view).toMatchObject({
            author: "NIVO",
            title: "title:knowledge.index",
            message: "class:input",
            meta: "name:knowledge.index · time:2026-11-14T10:00:00Z",
            jobId: card.jobId,
            canClose: true,
        })
        expect(view.facts.map((fact) => fact.value)).toEqual(["knowledge.index", "input", "KNOWLEDGE_UNREADABLE", "since:2026-11-14T10:00:00Z"])
        expect(JSON.stringify({ ...view, facts: [] })).not.toContain("KNOWLEDGE_UNREADABLE")
    })

    it("offers no close for a buried event (it can only be put back on its queue)", () => {
        expect(jobParkedViewOf({ ...card, jobId: "event:meta-inbound:abc" }, words).canClose).toBe(false)
    })
})
