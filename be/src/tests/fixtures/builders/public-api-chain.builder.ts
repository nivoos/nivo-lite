import { Test } from "@nestjs/testing"
import { FakeClock, mock } from "@starci/jest-preset"
import { ChannelDeliveryService } from "@modules/domain/channels"
import type { ContactIdentity, ContactWithIdentities } from "@modules/domain/contacts"
import { ContactsService } from "@modules/domain/contacts"
import { ChannelDeliveriesService } from "@modules/domain/customer-routes"
import { EventsService } from "@modules/domain/events"
import { PublicMessageDeliveryService } from "@modules/domain/public-api/public-message-delivery.service"
import type { PendingMessageDelivery } from "@modules/domain/public-api/public-api.contracts"
import { CLOCK } from "@modules/platform/clock"
import type { ClaimedJob } from "@modules/platform/jobs"
import { PublicApiQueueJob } from "@modules/queues/public-api"
import { MemoryChannelDeliveryStore } from "./customer-routes-stores.builder"

/** The workspace of the public API chain. */
export const API_WS = "11111111-1111-4111-8111-111111111111"
const AT = "2026-11-14T03:00:00.000Z"

/** The reply one accepted API message owes: what the send job carries. */
export const OWED_REPLY: PendingMessageDelivery = {
    workspaceId: API_WS,
    sendKey: "api.message:request-1",
    routeId: "route-1",
    contactId: "contact-1",
    agentId: "agent-1",
    channel: "zalo",
    accountId: "conn-1",
    text: "Hello from the API",
}

/** The claimed send job (a resume is `resumeCount` 1 and above). */
export const sendJob = (extra: Partial<ClaimedJob> = {}): ClaimedJob => ({
    jobId: "job-1",
    kind: PublicApiQueueJob.Send,
    fencingToken: 1,
    currentStep: null,
    payload: OWED_REPLY,
    ...extra,
})

const identity: ContactIdentity = {
    id: "identity-1",
    contactId: "contact-1",
    kind: "channel",
    provider: "zalo",
    account: "conn-1",
    value: "user-1",
    verified: true,
    verifiedBy: "channel",
    source: "channel",
    joinedBy: null,
    at: AT,
}

const person: ContactWithIdentities = {
    id: "contact-1",
    workspaceId: API_WS,
    displayName: null,
    tags: [],
    state: "active",
    createdAt: AT,
    updatedAt: AT,
    identities: [identity],
}

/**
 * The send of an API reply: the real delivery service over the real delivery ledger (an in-memory store) and a channel the spec
 * scripts. The send job's processor is `process(job)`: the step's one call, with the resume flag the step reads from the job.
 */
export const buildPublicApiChain = async () => {
    const store = new MemoryChannelDeliveryStore()
    const people = mock<ContactsService>()
    people.current.mockImplementation((_workspace, id) => Promise.resolve(id))
    people.get.mockResolvedValue(person)
    const ledger = new ChannelDeliveriesService(store, people)
    const channels = mock<ChannelDeliveryService>()
    channels.deliverToPerson.mockResolvedValue({ delivered: true, failure: null, outcome: "acknowledged" })
    const events = mock<EventsService>()
    const moduleRef = await Test.createTestingModule({
        providers: [
            PublicMessageDeliveryService,
            { provide: ChannelDeliveriesService, useValue: ledger },
            { provide: ChannelDeliveryService, useValue: channels },
            { provide: ContactsService, useValue: people },
            { provide: EventsService, useValue: events },
            { provide: CLOCK, useValue: new FakeClock(AT) },
        ],
    }).compile()
    const service = moduleRef.get(PublicMessageDeliveryService)
    return {
        service,
        ledger,
        channels,
        events,
        /** What the send job's step does: the one domain call (the job carries the reply and whether it is a resume). */
        process: (job: ClaimedJob): Promise<void> => service.sendJob(job),
    }
}
