import { Test } from "@nestjs/testing"
import { fakeIds, fakeTransaction, mock, mockEntityManager, recordingQueueOutbox } from "@starci/jest-preset"
import { AgentDirectoryService } from "@modules/domain/agents"
import { ConnectionsService } from "@modules/domain/connections"
import { ContactsService } from "@modules/domain/contacts"
import type { ContactIdentity } from "@modules/domain/contacts"
import { InboundEventsService } from "@modules/domain/inbound-events"
import { ProviderTriggersService, type DeliverResult } from "@modules/domain/provider-triggers"
import { WorkspaceMembersService } from "@modules/domain/workspace-members"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { IDS } from "@modules/platform/ids"
import { LOGGER } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { QUEUE_OUTBOX } from "@modules/platform/queue"
import { DELIVER_WEBSITE_FORM_JOB, WEBSITE_FORM_QUEUE } from "@modules/queues/website-form"
import { WEBSITE_AGENT as AGENT, WEBSITE_KEY as KEY, websiteSite as siteOf } from "@tests/fixtures/builders/website-site.builder"
import { websiteIntakeEntities } from "./persistence/entities"
import { WebsiteLeadWakeService } from "./website-lead-wake.service"
import { WebsiteOwnerService } from "./website-owner.service"
import { WebsiteSitesService, type WebsiteSubmission } from "./website-sites.service"
import { WebsiteSubmissionDeliveryService } from "./website-submission-delivery.service"

// The website form's chain: the door stores a submission and queues its delivery in ONE transaction; the job hands the stored submission to
// the one event pipeline. A kill between the store and the wake is a redelivery of the job, and the wake happens once.

const [WebsiteSiteEntity] = websiteIntakeEntities
const FORM: WebsiteSubmission = {
    name: "Cam",
    phone: "0900 000 101",
    email: null,
    message: "roses",
    pagePath: "/dat-hoa",
    campaign: null,
    device: null,
    visitor: null,
    submissionId: "sub-1",
}

/** The dedupe key a producer passed to the outbox (the 4th argument of the write, which the kit's double types as three). */
const dedupeKeyOf = (call: ReadonlyArray<unknown>): string | undefined => (call[3] as { readonly dedupeKey?: string } | undefined)?.dedupeKey

/** The process "dies" here: the error a call throws when its worker is gone before the call's outcome is known. */
const killed = (): Error => Object.assign(new Error("worker killed"), { code: "ECONNRESET" })

const build = async () => {
    const tx = fakeTransaction(mockEntityManager({ findOne: [WebsiteSiteEntity, siteOf({})] }))
    const inbound = mock<InboundEventsService>()
    // The input store keeps one row per event id: the same submission twice is the same stored input.
    const stored = new Map<string, string>()
    inbound.recordInputInTransaction.mockImplementation((input) => {
        const known = stored.get(input.eventId)
        if (known !== undefined) return Promise.resolve({ duplicate: true, inboundEventId: known })
        stored.set(input.eventId, `ev-${stored.size + 1}`)
        return Promise.resolve({ duplicate: false, inboundEventId: `ev-${stored.size}` })
    })
    const owners = mock<WebsiteOwnerService>()
    owners.agentOf.mockImplementation((_workspace, siteAgent) => Promise.resolve(siteAgent))
    const contacts = mock<ContactsService>()
    contacts.meetChannel.mockResolvedValue("contact-1")
    contacts.linkIdentity.mockResolvedValue({ kind: "proposed", identity: mock<ContactIdentity>() })
    // The one pipeline keeps an event id once: the first delivery of an id wakes, a repeat of it counts as a repeat and wakes nobody.
    const seen = new Set<string>()
    const woken: Array<string> = []
    const triggers = mock<ProviderTriggersService>()
    const commit = (id: string): DeliverResult => {
        const repeat = seen.has(id)
        seen.add(id)
        if (!repeat) woken.push(id)
        return {
            status: "delivered",
            events: repeat ? 0 : 1,
            dropped: 0,
            sameFact: 0,
            woken: repeat ? [] : [{ agentId: AGENT, workflowId: "wf-1", eventId: id, wakeId: `wake-${id}` }],
            repeats: repeat ? 1 : 0,
            untaken: 0,
            held: 0,
        }
    }
    triggers.deliver.mockImplementation((input) => Promise.resolve(commit(input.events[0]?.event.id ?? "")))
    const outbox = recordingQueueOutbox()
    const write = jest.spyOn(outbox, "write")
    const moduleRef = await Test.createTestingModule({
        providers: [
            WebsiteSitesService,
            WebsiteLeadWakeService,
            WebsiteSubmissionDeliveryService,
            { provide: WorkspaceMembersService, useValue: mock<WorkspaceMembersService>() },
            { provide: ConnectionsService, useValue: mock<ConnectionsService>() },
            { provide: AgentDirectoryService, useValue: mock<AgentDirectoryService>() },
            { provide: InboundEventsService, useValue: inbound },
            { provide: WebsiteOwnerService, useValue: owners },
            { provide: ContactsService, useValue: contacts },
            { provide: ProviderTriggersService, useValue: triggers },
            { provide: QUEUE_OUTBOX, useValue: outbox },
            { provide: LOGGER, useValue: mock<Logger>() },
            { provide: IDS, useValue: fakeIds() },
            { provide: PRIMARY_ENTITY_MANAGER, useValue: tx.em },
        ],
    }).compile()
    return {
        door: moduleRef.get(WebsiteSitesService),
        delivery: moduleRef.get(WebsiteSubmissionDeliveryService),
        triggers,
        woken,
        outbox,
        write,
        commit,
    }
}

describe("website form chain: a submission stored but never woken is recovered by the job, and the wake happens once", () => {
    it("the door writes the delivery as a queue outbox row in the transaction that stores the submission, keyed by the stored input", async () => {
        const t = await build()

        await t.door.submit(KEY, FORM)

        expect(t.outbox.allInTransaction).toBe(true)
        expect(t.outbox.jobsOf(WEBSITE_FORM_QUEUE)).toHaveLength(1)
        const payload = t.write.mock.calls[0]?.[2] as never
        expect(dedupeKeyOf(t.write.mock.calls[0] ?? [])).toBe(DELIVER_WEBSITE_FORM_JOB.onceKey(payload))
        // The door itself woke nobody: the wake is the job's.
        expect(t.triggers.deliver).not.toHaveBeenCalled()
    })

    it("a form the browser repeats under the same submissionId is stored once and queues the SAME job twice (one dedupe key); both runs wake once", async () => {
        const t = await build()

        const first = await t.door.submit(KEY, FORM)
        const again = await t.door.submit(KEY, FORM)

        expect(again).toEqual({ inboundEventId: first.inboundEventId, duplicate: true })
        const keys = t.write.mock.calls.map((call) => dedupeKeyOf(call))
        expect(keys[1]).toBe(keys[0])
        for (const job of t.outbox.jobs) await t.delivery.deliverJob(job.payload)
        expect(t.woken).toEqual([first.inboundEventId])
    })

    it("a kill between the store and the wake (the pipeline never committed): the redelivered job wakes the agent, once", async () => {
        const t = await build()
        await t.door.submit(KEY, FORM)
        const payload = t.outbox.jobs[0]?.payload as object

        t.triggers.deliver.mockRejectedValueOnce(killed())
        await expect(t.delivery.deliverJob(payload)).rejects.toMatchObject({ code: "ECONNRESET" })
        expect(t.woken).toEqual([])

        await t.delivery.deliverJob(payload)

        expect(t.woken).toEqual(["ev-1"])
    })

    it("a kill after the pipeline committed and before the job settled: the redelivered job hands the SAME event id again, counted as a repeat, nobody is woken twice", async () => {
        const t = await build()
        await t.door.submit(KEY, FORM)
        const payload = t.outbox.jobs[0]?.payload as object

        t.triggers.deliver.mockImplementationOnce((input) => {
            t.commit(input.events[0]?.event.id ?? "")
            return Promise.reject(killed())
        })
        await expect(t.delivery.deliverJob(payload)).rejects.toMatchObject({ code: "ECONNRESET" })
        await t.delivery.deliverJob(payload)

        const ids = t.triggers.deliver.mock.calls.map((call) => call[0].events[0]?.event.id)
        expect(ids).toEqual(["ev-1", "ev-1"])
        expect(t.woken).toEqual(["ev-1"])
    })
})
