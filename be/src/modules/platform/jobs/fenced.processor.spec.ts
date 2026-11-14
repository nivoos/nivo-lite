import { Test } from "@nestjs/testing"
import type { ClaimedJob } from "./jobs.contracts"
import { FencedProcessor } from "./fenced.processor"
import { defineJob } from "./job-definition"

const claimedJob: ClaimedJob = {
    jobId: "job-1",
    kind: "mail",
    fencingToken: 3,
    currentStep: null,
    payload: { messageId: "message-1" },
}

class MailProcessor extends FencedProcessor {
    readonly queue = "mail"
    readonly processed: Array<ClaimedJob> = []

    process(job: ClaimedJob): Promise<void> {
        this.processed.push(job)
        return Promise.resolve()
    }
}

const isMessage = (value: unknown): value is { readonly messageId: string } =>
    typeof value === "object" && value !== null && "messageId" in value && typeof value.messageId === "string"
const MAIL_JOB = defineJob({
    name: "mail.send",
    queue: "mail",
    ladder: "waited",
    payload: isMessage,
    onceKey: (payload) => `mail.send:${payload.messageId}`,
    next: [],
    effects: [],
})

class DeclaredMailProcessor extends FencedProcessor {
    readonly queue = "mail"
    override readonly definition = MAIL_JOB

    process(): Promise<void> {
        return Promise.resolve()
    }
}

const build = async () => {
    const moduleRef = await Test.createTestingModule({
        providers: [{ provide: FencedProcessor, useClass: MailProcessor }],
    }).compile()
    return moduleRef.get<MailProcessor>(FencedProcessor)
}

describe("FencedProcessor", () => {
    it("lets a processor declare its queue and process a claimed job", async () => {
        const processor = await build()

        await processor.process(claimedJob)

        expect(processor.queue).toBe("mail")
        expect(processor.processed).toEqual([claimedJob])
    })

    it("takes every job of its queue and the app default concurrency unless it says otherwise", async () => {
        const processor = await build()

        expect([processor.job, processor.concurrency]).toEqual([undefined, undefined])
    })

    it("names no definition unless the processor declares its job: the runner then uses the background ladder and checks no payload", async () => {
        const processor = await build()

        expect(processor.definition).toBeUndefined()
    })

    it("declares its job by naming the definition, whose ladder, guard and once key the runner and the producer read", () => {
        const processor = new DeclaredMailProcessor()

        expect(processor.definition?.name).toBe("mail.send")
        expect(processor.definition?.ladder).toBe("waited")
        expect(processor.definition?.payload({ messageId: "message-1" })).toBe(true)
        expect(processor.definition?.payload({})).toBe(false)
        expect(MAIL_JOB.onceKey({ messageId: "message-1" })).toBe("mail.send:message-1")
        expect(Object.isFrozen(MAIL_JOB)).toBe(true)
    })

    it("does nothing when a job ends as failed, unless the processor writes the failure", async () => {
        const delivery = {
            id: "k-1",
            queue: "mail",
            job: "mail",
            payload: {},
            attempt: 4,
            signal: new AbortController().signal,
        }

        const processor = await build()
        await expect(processor.onFailed(delivery, new Error("gave up"))).resolves.toBeUndefined()
    })
})
