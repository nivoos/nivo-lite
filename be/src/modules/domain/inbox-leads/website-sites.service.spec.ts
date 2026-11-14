import { Test } from "@nestjs/testing"
import { fakeIds, fakeTransaction, mock, mockEntityManager, recordingQueueOutbox } from "@starci/jest-preset"
import { AgentDirectoryService } from "@modules/domain/agents"
import type { AgentCard } from "@modules/domain/agents"
import { ConnectionsService } from "@modules/domain/connections"
import { EntityEngineErrorCode } from "@modules/domain/entity-engine"
import { InboundEventsService } from "@modules/domain/inbound-events"
import { WorkspaceMembersService } from "@modules/domain/workspace-members"
import type { WorkspaceMember } from "@modules/domain/workspace-members"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { IDS } from "@modules/platform/ids"
import { QUEUE_OUTBOX } from "@modules/platform/queue"
import { DELIVER_WEBSITE_FORM_JOB, WEBSITE_FORM_QUEUE } from "@modules/queues/website-form"
import {
    WEBSITE_AGENT as AGENT,
    WEBSITE_KEY as KEY,
    WEBSITE_WORKSPACE as WORKSPACE,
    websiteSite as siteOf,
} from "@tests/fixtures/builders/website-site.builder"
import { websiteIntakeEntities } from "./persistence/entities"
import { WebsiteOwnerService } from "./website-owner.service"
import { WebsiteSitesService } from "./website-sites.service"
import type { WebsiteSubmission } from "./website-sites.service"

const [WebsiteSiteEntity] = websiteIntakeEntities
const SITE = "site-1"
const VISITOR = "7c9e6679-7425-40de-944b-e07fc1f90ae7"

const FORM: WebsiteSubmission = {
    name: " Cam ",
    phone: "0900 000 101",
    email: null,
    message: "roses",
    pagePath: "/dat-hoa",
    campaign: " ",
    device: "mobile",
    visitor: null,
    submissionId: "sub-1",
}

/** The service is built with no entity engine at all: the intake cannot write a record of any agent. The manager runs `transaction` as a fake one. */
const build = async (em = mockEntityManager()) => {
    fakeTransaction(em)
    const members = mock<WorkspaceMembersService>()
    const connections = mock<ConnectionsService>()
    const directory = mock<AgentDirectoryService>()
    const inbound = mock<InboundEventsService>()
    const owners = mock<WebsiteOwnerService>()
    members.require.mockResolvedValue(mock<WorkspaceMember>())
    connections.publicOrigin.mockReturnValue("https://nivo.example")
    inbound.recordInputInTransaction.mockResolvedValue({ duplicate: false, inboundEventId: "ev-1" })
    const outbox = recordingQueueOutbox()
    const write = jest.spyOn(outbox, "write")
    owners.agentOf.mockImplementation((_workspace, siteAgent) => Promise.resolve(siteAgent))
    const moduleRef = await Test.createTestingModule({
        providers: [
            WebsiteSitesService,
            { provide: WorkspaceMembersService, useValue: members },
            { provide: ConnectionsService, useValue: connections },
            { provide: AgentDirectoryService, useValue: directory },
            { provide: InboundEventsService, useValue: inbound },
            { provide: WebsiteOwnerService, useValue: owners },
            { provide: QUEUE_OUTBOX, useValue: outbox },
            { provide: IDS, useValue: fakeIds() },
            { provide: PRIMARY_ENTITY_MANAGER, useValue: em },
        ],
    }).compile()
    return {
        sites: moduleRef.get(WebsiteSitesService),
        members,
        connections,
        directory,
        inbound,
        owners,
        outbox,
        write,
        em,
    }
}

describe("WebsiteSitesService view", () => {
    it("shows the intake with the address of the hosted form", async () => {
        const { sites } = await build(mockEntityManager({ findOne: [WebsiteSiteEntity, siteOf({})] }))

        await expect(sites.view("user-1", WORKSPACE)).resolves.toMatchObject({
            siteKey: KEY,
            agentId: AGENT,
            formUrl: `https://nivo.example/form/${KEY}`,
        })
    })

    it("issues the key on the first read and falls back to the site origin when no public one is set", async () => {
        const em = mockEntityManager({
            findOne: [WebsiteSiteEntity, null],
            save: [WebsiteSiteEntity, siteOf({ agentId: null })],
        })
        const { sites, connections } = await build(em)
        connections.publicOrigin.mockReturnValue(null)
        connections.siteBase.mockReturnValue("https://site.example")

        const view = await sites.view("user-1", WORKSPACE)

        expect(em.save.mock.calls[0]?.[1]).toMatchObject({ workspaceId: WORKSPACE, agentId: null })
        expect(view).toMatchObject({ agentId: null, formUrl: `https://site.example/form/${KEY}` })
    })
})

describe("WebsiteSitesService save", () => {
    it("saves what the owner changed, as an owner or a manager", async () => {
        const site = siteOf({})
        const em = mockEntityManager({ findOne: [WebsiteSiteEntity, site], save: [WebsiteSiteEntity, site] })
        const { sites, members, directory } = await build(em)
        directory.find.mockResolvedValueOnce(mock<AgentCard>())

        const view = await sites.save("user-1", WORKSPACE, {
            isEnabled: false,
            chatEnabled: false,
            formEnabled: false,
            pricesEnabled: true,
            agentId: AGENT,
        })

        expect(members.require).toHaveBeenCalledWith("user-1", WORKSPACE, ["owner", "manager"])
        expect(view).toMatchObject({ isEnabled: false, chatEnabled: false, formEnabled: false, pricesEnabled: true })
    })

    it("leaves alone what the change leaves out, and clears the agent on null", async () => {
        const site = siteOf({ isEnabled: false })
        const em = mockEntityManager({ findOne: [WebsiteSiteEntity, site], save: [WebsiteSiteEntity, site] })
        const { sites, directory } = await build(em)

        const view = await sites.save("user-1", WORKSPACE, { agentId: null })

        expect(directory.find).not.toHaveBeenCalled()
        expect(view).toMatchObject({ isEnabled: false, chatEnabled: true, agentId: null })
    })

    it("changes one switch and nothing else", async () => {
        const site = siteOf({ isEnabled: false })
        const em = mockEntityManager({ findOne: [WebsiteSiteEntity, site], save: [WebsiteSiteEntity, site] })
        const { sites } = await build(em)

        await expect(sites.save("user-1", WORKSPACE, { isEnabled: true })).resolves.toMatchObject({
            isEnabled: true,
            agentId: AGENT,
        })
    })

    it("refuses an agent the workspace does not know", async () => {
        const { sites, directory } = await build()
        directory.find.mockResolvedValueOnce(null)

        await expect(sites.save("user-1", WORKSPACE, { agentId: AGENT })).rejects.toMatchObject({
            code: "INBOX_LEADS_AGENT_UNKNOWN",
        })
    })
})

describe("WebsiteSitesService adoptFrontDoor", () => {
    it("writes the installed front door onto a site that names no agent", async () => {
        const site = siteOf({ agentId: null })
        const em = mockEntityManager({ findOne: [WebsiteSiteEntity, site], save: [WebsiteSiteEntity, site] })
        const { sites, members } = await build(em)

        const view = await sites.adoptFrontDoor("user-1", WORKSPACE, "sales-1")

        expect(members.require).toHaveBeenCalledWith("user-1", WORKSPACE, ["owner", "manager"])
        expect(em.save.mock.calls[0]?.[1]).toMatchObject({ agentId: "sales-1" })
        expect(view.agentId).toBe("sales-1")
    })

    it("replaces an agent that was deleted, and keeps one that still exists", async () => {
        const gone = siteOf({})
        const goneEm = mockEntityManager({ findOne: [WebsiteSiteEntity, gone], save: [WebsiteSiteEntity, gone] })
        const first = await build(goneEm)
        first.directory.find.mockResolvedValueOnce(null)
        await expect(first.sites.adoptFrontDoor("user-1", WORKSPACE, "sales-1")).resolves.toMatchObject({
            agentId: "sales-1",
        })

        const kept = siteOf({})
        const keptEm = mockEntityManager({ findOne: [WebsiteSiteEntity, kept], save: [WebsiteSiteEntity, kept] })
        const second = await build(keptEm)
        second.directory.find.mockResolvedValueOnce(mock<AgentCard>())
        await expect(second.sites.adoptFrontDoor("user-1", WORKSPACE, "sales-1")).resolves.toMatchObject({
            agentId: AGENT,
        })
        expect(keptEm.save).not.toHaveBeenCalled()
    })
})

/** The dedupe key a producer passed to the outbox (the 4th argument of the write). */
const dedupeKeyOf = (call: ReadonlyArray<unknown>): string | undefined => (call[3] as { readonly dedupeKey?: string } | undefined)?.dedupeKey

describe("WebsiteSitesService submit", () => {
    it("stores the raw submission as one input and writes its delivery job as a queue outbox row in the SAME transaction", async () => {
        const { sites, inbound, outbox, write, em } = await build(mockEntityManager({ findOne: [WebsiteSiteEntity, siteOf({})] }))

        await expect(sites.submit(KEY, FORM)).resolves.toEqual({ inboundEventId: "ev-1", duplicate: false })

        expect(inbound.recordInputInTransaction).toHaveBeenCalledWith(
            {
                workspaceId: WORKSPACE,
                channel: "website",
                kind: "message",
                senderName: "Cam",
                senderContact: "84900000101",
                body: "roses",
                externalRef: null,
                eventId: `${KEY}:sub-1`,
                customerKey: "phone:84900000101",
                source: { page: "/dat-hoa", device: "mobile" },
            },
            expect.anything(),
        )
        expect(em.transaction).toHaveBeenCalledTimes(1)
        // The store and the job went through the one transaction view: neither is left to a second, separate commit.
        expect(inbound.recordInputInTransaction.mock.calls[0]?.[1]).toBe(write.mock.calls[0]?.[0])
        expect(outbox.allInTransaction).toBe(true)
        expect(outbox.jobsOf(WEBSITE_FORM_QUEUE)).toEqual([
            {
                queue: WEBSITE_FORM_QUEUE,
                payload: {
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
                },
            },
        ])
        expect(dedupeKeyOf(write.mock.calls[0] ?? [])).toBe("website-form:ev-1")
        expect(dedupeKeyOf(write.mock.calls[0] ?? [])).toBe(DELIVER_WEBSITE_FORM_JOB.onceKey(write.mock.calls[0]?.[2] as never))
        // The door meets no contact and wakes nobody: the job does (the intake owns no ContactsService any more).
    })

    it("the same submission twice is one stored input and the SAME job: same event id, same dedupe key, the repeat answers duplicate", async () => {
        const { sites, inbound, write } = await build(mockEntityManager({ findOne: [WebsiteSiteEntity, siteOf({})] }))
        inbound.recordInputInTransaction.mockResolvedValueOnce({ duplicate: false, inboundEventId: "ev-1" })
        inbound.recordInputInTransaction.mockResolvedValueOnce({ duplicate: true, inboundEventId: "ev-1" })

        await sites.submit(KEY, FORM)
        await expect(sites.submit(KEY, FORM)).resolves.toMatchObject({ duplicate: true, inboundEventId: "ev-1" })

        expect(inbound.recordInputInTransaction.mock.calls[1]?.[0].eventId).toBe(inbound.recordInputInTransaction.mock.calls[0]?.[0].eventId)
        expect(write.mock.calls.map((call) => dedupeKeyOf(call))).toEqual(["website-form:ev-1", "website-form:ev-1"])
        expect(write.mock.calls[1]?.[2]).toEqual(write.mock.calls[0]?.[2])
    })

    it("a failed store writes no job: the visitor is refused and sends it again", async () => {
        const { sites, inbound, outbox } = await build(mockEntityManager({ findOne: [WebsiteSiteEntity, siteOf({})] }))
        inbound.recordInputInTransaction.mockRejectedValueOnce(new Error("store failed"))

        await expect(sites.submit(KEY, FORM)).rejects.toThrow("store failed")

        expect(outbox.jobs).toEqual([])
    })

    it("a failed job write fails the whole transaction (the store is not left alone): the error reaches the visitor", async () => {
        const { sites, outbox } = await build(mockEntityManager({ findOne: [WebsiteSiteEntity, siteOf({})] }))
        outbox.failNext("write", new Error("outbox down"))

        await expect(sites.submit(KEY, FORM)).rejects.toThrow("outbox down")
    })
})

describe("WebsiteSitesService submit visitor and claims", () => {
    const payloadOf = async (form: WebsiteSubmission, site = siteOf({})) => {
        const built = await build(mockEntityManager({ findOne: [WebsiteSiteEntity, site] }))
        await built.sites.submit(KEY, form)
        return { ...built, payload: built.outbox.jobs[0]?.payload as Record<string, unknown> }
    }

    it("names the visitor by the id the page keeps for them, lower-cased: the same browser is the same visitor key", async () => {
        const one = await payloadOf({ ...FORM, visitor: VISITOR, submissionId: "a" })
        const upper = await payloadOf({ ...FORM, visitor: VISITOR.toUpperCase(), submissionId: "b" })

        expect(one.payload).toMatchObject({ visitorKey: `visitor:${VISITOR}`, siteId: SITE })
        expect(upper.payload).toMatchObject({ visitorKey: `visitor:${VISITOR}` })
    })

    it("names a visitor the page did not name by the submission: a new visitor key for every submission id", async () => {
        const first = await payloadOf({ ...FORM, visitor: null, submissionId: "a" })
        const second = await payloadOf({ ...FORM, visitor: null, submissionId: "b" })

        expect(first.payload["visitorKey"]).toBe("submission:a")
        expect(second.payload["visitorKey"]).toBe("submission:b")
    })

    it("treats a malformed visitor id as none and still accepts the submission", async () => {
        for (const bad of ["v-1", "x".repeat(100), "7c9e6679-7425-40de-944b-e07fc1f90ae", "' or 1=1 --", "  "]) {
            const built = await payloadOf({ ...FORM, visitor: bad, submissionId: "bad" })
            expect(built.payload).toMatchObject({ visitorKey: "submission:bad" })
            expect(built.inbound.recordInputInTransaction.mock.lastCall?.[0]).toMatchObject({ customerKey: "phone:84900000101" })
        }
    })

    it("keeps an email as a claim, and claims nothing for a visitor who left neither", async () => {
        const first = await payloadOf({ ...FORM, phone: null, email: "Cam@Shop.test", message: null, submissionId: null })
        expect(first.payload["claims"]).toEqual([{ kind: "email", value: "cam@shop.test" }])
        expect(first.payload).toMatchObject({ visitorKey: "submission:00000000-0000-4000-8000-000000000001", request: null })

        const second = await payloadOf({ ...FORM, phone: null, name: null, visitor: VISITOR, submissionId: null })
        expect(second.payload["claims"]).toEqual([])
        expect(second.payload).toMatchObject({ name: null, visitorKey: `visitor:${VISITOR}` })
        expect(second.inbound.recordInputInTransaction.mock.calls[0]?.[0]).toMatchObject({
            customerKey: `web:${VISITOR}`,
            eventId: `${KEY}:00000000-0000-4000-8000-000000000001`,
            senderName: null,
            senderContact: null,
        })
    })
})

describe("WebsiteSitesService submit names the agent", () => {
    it("names the agent of the site in the job; no agent record is written", async () => {
        const { sites, owners, outbox } = await build(mockEntityManager({ findOne: [WebsiteSiteEntity, siteOf({})] }))

        await sites.submit(KEY, FORM)

        expect(owners.agentOf).toHaveBeenCalledWith(WORKSPACE, AGENT)
        expect(outbox.jobs[0]?.payload).toMatchObject({ agentId: AGENT })
    })

    it("names the installed front door when the site names none", async () => {
        const { sites, outbox, owners } = await build(mockEntityManager({ findOne: [WebsiteSiteEntity, siteOf({ agentId: null })] }))
        owners.agentOf.mockResolvedValueOnce("front-door-1")

        await sites.submit(KEY, FORM)

        expect(outbox.jobs[0]?.payload).toMatchObject({ agentId: "front-door-1" })
    })

    it("refuses the form when no agent owns the site: nothing is stored and no job is written", async () => {
        const { sites, inbound, outbox, owners } = await build(mockEntityManager({ findOne: [WebsiteSiteEntity, siteOf({ agentId: null })] }))
        owners.agentOf.mockResolvedValueOnce(null)

        await expect(sites.submit(KEY, FORM)).rejects.toMatchObject({ code: EntityEngineErrorCode.AgentMissing })

        expect(inbound.recordInputInTransaction).not.toHaveBeenCalled()
        expect(outbox.jobs).toEqual([])
    })
})

describe("WebsiteSitesService submit refusals", () => {
    it("refuses a key nobody holds, and an intake that is off", async () => {
        const unknown = await build(mockEntityManager({ findOne: [WebsiteSiteEntity, null] }))
        await expect(unknown.sites.submit("nope", FORM)).rejects.toMatchObject({ code: "INBOX_LEADS_SITE_UNKNOWN" })

        const off = await build(mockEntityManager({ findOne: [WebsiteSiteEntity, siteOf({ isEnabled: false })] }))
        await expect(off.sites.submit(KEY, FORM)).rejects.toMatchObject({ code: "INBOX_LEADS_SITE_OFF" })

        const noForm = await build(mockEntityManager({ findOne: [WebsiteSiteEntity, siteOf({ formEnabled: false })] }))
        await expect(noForm.sites.submit(KEY, FORM)).rejects.toMatchObject({ code: "INBOX_LEADS_SITE_OFF" })
    })

    it("refuses a form with nothing to answer before anything is written", async () => {
        const { sites, inbound, outbox } = await build(mockEntityManager({ findOne: [WebsiteSiteEntity, siteOf({})] }))

        await expect(sites.submit(KEY, { ...FORM, phone: null, message: " ", email: null })).rejects.toMatchObject({
            code: "INBOX_LEADS_SUBMISSION_EMPTY",
        })

        expect(inbound.recordInputInTransaction).not.toHaveBeenCalled()
        expect(outbox.jobs).toEqual([])
    })
})

describe("WebsiteSitesService frontDoorSiteOf", () => {
    it("names the site key when the workspace's switched-on site names the agent: nobody else answers it", async () => {
        const em = mockEntityManager({ findOne: [WebsiteSiteEntity, siteOf({})] })
        const { sites } = await build(em)

        await expect(sites.frontDoorSiteOf(WORKSPACE, AGENT)).resolves.toEqual({ siteKey: KEY })
        expect(em.findOne).toHaveBeenCalledWith(WebsiteSiteEntity, { where: { workspaceId: WORKSPACE, agentId: AGENT, isEnabled: true } })
    })

    it("names nothing when no switched-on site names the agent, and creates no site by asking", async () => {
        const em = mockEntityManager({ findOne: [WebsiteSiteEntity, null] })
        const { sites } = await build(em)

        await expect(sites.frontDoorSiteOf(WORKSPACE, AGENT)).resolves.toBeNull()
        expect(em.save).not.toHaveBeenCalled()
    })
})

describe("WebsiteSitesService themeOf", () => {
    const THEME = { hue: 150, chroma: 0.17, lightness: 0.62, base: 0.6, font: "lexend", radius: "large", mode: null }

    it("answers the theme parameters of the workspace behind a switched-on site key, and nothing else of the workspace", async () => {
        const em = mockEntityManager()
        em.findOne.mockResolvedValueOnce(siteOf({ isEnabled: true })).mockResolvedValueOnce({ id: WORKSPACE, theme: { ...THEME, extra: 1 } })
        const { sites } = await build(em)
        await expect(sites.themeOf(KEY)).resolves.toEqual(THEME)
    })

    it("answers null while the workspace wears the NIVO default", async () => {
        const em = mockEntityManager()
        em.findOne.mockResolvedValueOnce(siteOf({ isEnabled: true })).mockResolvedValueOnce({ id: WORKSPACE, theme: null })
        const { sites } = await build(em)
        await expect(sites.themeOf(KEY)).resolves.toBeNull()
    })

    it("refuses an unknown site key and a switched-off site before reading any workspace", async () => {
        const unknown = await build(mockEntityManager({ findOne: [WebsiteSiteEntity, null] }))
        await expect(unknown.sites.themeOf(KEY)).rejects.toMatchObject({ code: "INBOX_LEADS_SITE_UNKNOWN" })
        const off = await build(mockEntityManager({ findOne: [WebsiteSiteEntity, siteOf({ isEnabled: false })] }))
        await expect(off.sites.themeOf(KEY)).rejects.toMatchObject({ code: "INBOX_LEADS_SITE_OFF" })
    })
})
