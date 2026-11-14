import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { ContactsService } from "@modules/domain/contacts"
import type { ContactIdentity } from "@modules/domain/contacts"
import type { WebsiteFormPayload } from "@modules/queues/website-form"
import { WebsiteLeadWakeService } from "./website-lead-wake.service"
import { WebsiteSubmissionDeliveryService } from "./website-submission-delivery.service"

const WORKSPACE = "11111111-1111-4111-8111-111111111111"
const AGENT = "44444444-4444-4444-8444-444444444444"
const SITE = "site-1"
const VISITOR = "visitor:7c9e6679-7425-40de-944b-e07fc1f90ae7"

const PAYLOAD: WebsiteFormPayload = {
    workspaceId: WORKSPACE,
    siteId: SITE,
    agentId: AGENT,
    inboundEventId: "ev-1",
    visitorKey: "submission:sub-1",
    name: "Cam",
    phone: "84900000101",
    email: null,
    request: "roses",
    source: { page: "/dat-hoa", device: "mobile" },
    claims: [{ kind: "phone", value: "84900000101" }],
}

const build = async () => {
    const contacts = mock<ContactsService>()
    const wakes = mock<WebsiteLeadWakeService>()
    contacts.meetChannel.mockResolvedValue("contact-1")
    contacts.linkIdentity.mockResolvedValue({ kind: "proposed", identity: mock<ContactIdentity>() })
    wakes.wake.mockResolvedValue(true)
    const moduleRef = await Test.createTestingModule({
        providers: [
            WebsiteSubmissionDeliveryService,
            { provide: ContactsService, useValue: contacts },
            { provide: WebsiteLeadWakeService, useValue: wakes },
        ],
    }).compile()
    return { delivery: moduleRef.get(WebsiteSubmissionDeliveryService), contacts, wakes }
}

describe("WebsiteSubmissionDeliveryService deliverJob", () => {
    it("meets the core contact by the site's id of the visitor, links the typed phone as a claim, then wakes the owning agent with the stored submission", async () => {
        const { delivery, contacts, wakes } = await build()

        await delivery.deliverJob(PAYLOAD)

        expect(contacts.meetChannel).toHaveBeenCalledWith(WORKSPACE, { channel: "website", account: SITE, userId: "submission:sub-1", name: "Cam" })
        expect(contacts.linkIdentity).toHaveBeenCalledTimes(1)
        expect(contacts.linkIdentity).toHaveBeenCalledWith(WORKSPACE, "contact-1", { kind: "phone", value: "84900000101" }, { kind: "channel" })
        expect(wakes.wake).toHaveBeenCalledWith(WORKSPACE, AGENT, {
            contactId: "contact-1",
            siteId: SITE,
            inboundEventId: "ev-1",
            visitorKey: "submission:sub-1",
            name: "Cam",
            phone: "84900000101",
            email: null,
            request: "roses",
            source: { page: "/dat-hoa", device: "mobile" },
        })
        expect(contacts.meetChannel.mock.invocationCallOrder[0]).toBeLessThan(contacts.linkIdentity.mock.invocationCallOrder[0] ?? 0)
        expect(contacts.linkIdentity.mock.invocationCallOrder[0]).toBeLessThan(wakes.wake.mock.invocationCallOrder[0] ?? 0)
    })

    it("links the email claim, and claims nothing for a visitor who left neither", async () => {
        const email = await build()
        await email.delivery.deliverJob({ ...PAYLOAD, phone: null, email: "cam@shop.test", claims: [{ kind: "email", value: "cam@shop.test" }] })
        expect(email.contacts.linkIdentity).toHaveBeenCalledWith(WORKSPACE, "contact-1", { kind: "email", value: "cam@shop.test" }, { kind: "channel" })

        const none = await build()
        await none.delivery.deliverJob({ ...PAYLOAD, name: null, phone: null, claims: [], visitorKey: VISITOR })
        expect(none.contacts.linkIdentity).not.toHaveBeenCalled()
        expect(none.contacts.meetChannel.mock.calls[0]?.[1]).toMatchObject({ userId: VISITOR, name: null })
    })

    it("meets the same contact for the same visitor key run twice (a redelivery), under the same site", async () => {
        const known = new Map<string, string>()
        const { delivery, contacts, wakes } = await build()
        contacts.meetChannel.mockImplementation((_workspace, person) => {
            const key = `${person.account}|${person.userId}`
            const found = known.get(key) ?? `contact-${known.size + 1}`
            known.set(key, found)
            return Promise.resolve(found)
        })

        await delivery.deliverJob({ ...PAYLOAD, visitorKey: VISITOR })
        await delivery.deliverJob({ ...PAYLOAD, visitorKey: VISITOR, phone: "84911111111", claims: [{ kind: "phone", value: "84911111111" }] })
        await delivery.deliverJob({ ...PAYLOAD, siteId: "site-2", visitorKey: VISITOR })

        expect(wakes.wake.mock.calls.map((call) => call[2].contactId)).toEqual(["contact-1", "contact-1", "contact-2"])
    })

    it("lets a failure of the contact or of the wake throw: the job runner judges it (retry, dead letter), nothing is swallowed here", async () => {
        const met = await build()
        met.contacts.meetChannel.mockRejectedValueOnce(new Error("contacts down"))
        await expect(met.delivery.deliverJob(PAYLOAD)).rejects.toThrow("contacts down")
        expect(met.wakes.wake).not.toHaveBeenCalled()

        const woke = await build()
        woke.wakes.wake.mockRejectedValueOnce(new Error("pipeline down"))
        await expect(woke.delivery.deliverJob(PAYLOAD)).rejects.toThrow("pipeline down")
    })

    it("ends a job whose payload is no submission doing nothing (only the form door writes the job)", async () => {
        const { delivery, contacts, wakes } = await build()

        await delivery.deliverJob({ workspaceId: WORKSPACE })
        await delivery.deliverJob({ ...PAYLOAD, claims: [{ kind: "token", value: "x" }] })

        expect(contacts.meetChannel).not.toHaveBeenCalled()
        expect(wakes.wake).not.toHaveBeenCalled()
    })
})
