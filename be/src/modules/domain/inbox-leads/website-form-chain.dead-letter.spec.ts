import { Test } from "@nestjs/testing"
import { fakeTransaction, mock, mockEntityManager } from "@starci/jest-preset"
import { buildJobRunner, deliveryOf, refusedByNetwork } from "@tests/fixtures/builders/job-runner-harness.builder"
import { ContactsService } from "@modules/domain/contacts"
import type { ContactIdentity } from "@modules/domain/contacts"
import { ProviderTriggersService } from "@modules/domain/provider-triggers"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { DomainError } from "@modules/platform/errors"
import { FencedProcessor, type ClaimedJob } from "@modules/platform/jobs"
import { LOGGER } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { QueueError, QueueErrorCode, type QueueDelivery } from "@modules/platform/queue"
import { DELIVER_WEBSITE_FORM_JOB, WEBSITE_FORM_QUEUE, type WebsiteFormPayload } from "@modules/queues/website-form"
import { WebsiteLeadWakeService } from "./website-lead-wake.service"
import { WebsiteSubmissionDeliveryService } from "./website-submission-delivery.service"

const WS = "11111111-1111-4111-8111-111111111111"
const PAYLOAD: WebsiteFormPayload = {
    workspaceId: WS,
    siteId: "site-1",
    agentId: "agent-1",
    inboundEventId: "ev-1",
    visitorKey: "submission:sub-1",
    name: "Cam",
    phone: null,
    email: null,
    request: "roses",
    source: {},
    claims: [],
}
const delivery = (attempt: number): QueueDelivery => deliveryOf(WEBSITE_FORM_QUEUE, DELIVER_WEBSITE_FORM_JOB.name, PAYLOAD, attempt)
const WOKEN = { status: "delivered", events: 1, dropped: 0, sameFact: 0, woken: [], repeats: 0, untaken: 0, held: 0 } as const

class SubmissionRefused extends DomainError<"WEBSITE_FORM_REFUSED"> {}

const build = async () => {
    const tx = fakeTransaction(mockEntityManager({}))
    const triggers = mock<ProviderTriggersService>()
    triggers.deliver.mockResolvedValue(WOKEN)
    const contacts = mock<ContactsService>()
    contacts.meetChannel.mockResolvedValue("contact-1")
    contacts.linkIdentity.mockResolvedValue({ kind: "proposed", identity: mock<ContactIdentity>() })
    const moduleRef = await Test.createTestingModule({
        providers: [
            WebsiteLeadWakeService,
            WebsiteSubmissionDeliveryService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: tx.em },
            { provide: LOGGER, useValue: mock<Logger>() },
            { provide: ProviderTriggersService, useValue: triggers },
            { provide: ContactsService, useValue: contacts },
        ],
    }).compile()
    const service = moduleRef.get(WebsiteSubmissionDeliveryService)
    const processor = new (class extends FencedProcessor {
        override readonly queue = WEBSITE_FORM_QUEUE
        override readonly definition = DELIVER_WEBSITE_FORM_JOB
        async process(job: ClaimedJob): Promise<void> {
            await service.deliverJob(job.payload)
        }
    })()
    return { triggers, processor }
}

describe("website form chain: a delivery that fails ends as a bounded retry (transient only), then ONE dead letter, and a resume finishes", () => {
    it("a submission the pipeline refuses (input) parks at once with ONE item and no retry; after the cause is fixed the resume hands it over", async () => {
        const t = await build()
        const h = await buildJobRunner()
        h.claimed(PAYLOAD)
        t.triggers.deliver.mockRejectedValueOnce(new SubmissionRefused({ code: "WEBSITE_FORM_REFUSED" }))

        await h.runner.run(t.processor, delivery(1))

        expect(h.claims.fail).not.toHaveBeenCalled()
        expect(h.claims.park).toHaveBeenCalledTimes(1)
        expect(h.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "input", queue: WEBSITE_FORM_QUEUE }))
        expect(h.deadLetters.raise).toHaveBeenCalledTimes(1)
        expect(h.deadLetters.raise).toHaveBeenCalledWith(expect.objectContaining({ kind: "flow-parked", failureClass: "input", workspaceId: WS }))

        const resumed = await buildJobRunner(1)
        resumed.claimed(PAYLOAD)
        await resumed.runner.run(t.processor, delivery(1))

        expect(resumed.claims.complete).toHaveBeenCalledTimes(1)
        expect(resumed.deadLetters.raise).not.toHaveBeenCalled()
        expect(t.triggers.deliver).toHaveBeenCalledTimes(2)
    })

    it("a database that is away retries on the background ladder (5, 10, 20 s), then parks with ONE item; the resume delivers once", async () => {
        const t = await build()
        const h = await buildJobRunner()
        h.claimed(PAYLOAD)
        t.triggers.deliver.mockRejectedValue(refusedByNetwork())

        const pauses: Array<number> = []
        for (const attempt of [1, 2, 3]) {
            const thrown = await h.runner.run(t.processor, delivery(attempt)).catch((cause: unknown) => cause)
            expect(thrown).toBeInstanceOf(QueueError)
            expect(thrown).toMatchObject({ code: QueueErrorCode.RetryAfter })
            pauses.push((thrown as QueueError).params.seconds as number)
        }
        expect(pauses).toEqual([5, 10, 20])
        expect(h.claims.park).not.toHaveBeenCalled()

        await h.runner.run(t.processor, delivery(4))

        expect(h.claims.park).toHaveBeenCalledTimes(1)
        expect(h.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "transient" }))
        expect(h.deadLetters.raise).toHaveBeenCalledTimes(1)

        t.triggers.deliver.mockResolvedValue(WOKEN)
        const resumed = await buildJobRunner(1)
        resumed.claimed(PAYLOAD)
        await resumed.runner.run(t.processor, delivery(1))

        expect(resumed.claims.complete).toHaveBeenCalledTimes(1)
        expect(resumed.deadLetters.raise).not.toHaveBeenCalled()
    })
})
