import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { AgentRunsService, type RunSubject, type SubjectHolder } from "@modules/domain/agent-runs"
import { ContactsService } from "@modules/domain/contacts/contacts.service"
import { AgentGraphSubjectHoldsService } from "./agent-graph-subject-holds.service"

/*
 * Concept agent-data, "Contact and subject" (E-STREAM S5): a MERGE joins two contact ids into one person, so a run in flight keyed by either
 * id holds an event keyed by the other, whatever the data source of the event. Rule Q-1 otherwise unchanged.
 */

const WS = "ws-1"
const SURVIVOR = "contact-old"
const MERGED = "contact-new"
const RUN: SubjectHolder = { id: "run-1", workflowId: "wf-1", startedAt: "2026-11-15T01:00:00.000Z" }
const NONE = new Set<string>()

const build = async (withContacts: boolean) => {
    const runs = mock<AgentRunsService>()
    // The one run in flight is keyed by the person's SURVIVING id; nothing else is in flight.
    runs.inFlightOfSubject.mockImplementation((_ws: string, subject: RunSubject) =>
        Promise.resolve(subject.kind === "contactId" && subject.id === SURVIVOR ? [RUN] : []),
    )
    const contacts = mock<ContactsService>()
    contacts.aliasesOf.mockImplementation((_ws: string, id: string) =>
        Promise.resolve(id === SURVIVOR || id === MERGED ? [SURVIVOR, MERGED] : [id]),
    )
    const moduleRef = await Test.createTestingModule({
        providers: [
            AgentGraphSubjectHoldsService,
            { provide: AgentRunsService, useValue: runs },
            ...(withContacts ? [{ provide: ContactsService, useValue: contacts }] : []),
        ],
    }).compile()
    return { holds: moduleRef.get(AgentGraphSubjectHoldsService), runs, contacts }
}

describe("AgentGraphSubjectHoldsService: a person's subject covers every id merged into them", () => {
    it("holds a person's line (route + contact) keyed by the MERGED id behind the run keyed by the surviving id", async () => {
        const { holds } = await build(true)
        const subjects: ReadonlyArray<RunSubject> = [
            { kind: "routeId", id: "route-tele" },
            { kind: "contactId", id: MERGED },
        ]

        await expect(holds.holderOf(WS, subjects, { contactId: MERGED, routeId: "route-tele" }, NONE)).resolves.toEqual({
            id: "run-1",
            workflowId: "wf-1",
        })
    })

    it("holds a second kind (a workflow call keyed by the contact, no route) the same way", async () => {
        const { holds, runs } = await build(true)

        await expect(holds.holderOf(WS, [{ kind: "contactId", id: MERGED }], { contactId: MERGED, routeId: null }, NONE)).resolves.toEqual({
            id: "run-1",
            workflowId: "wf-1",
        })
        // Each id of the person asked once; a subject of another kind is never widened.
        expect(runs.inFlightOfSubject.mock.calls.map(([, subject]) => subject)).toEqual([
            { kind: "contactId", id: SURVIVOR },
            { kind: "contactId", id: MERGED },
        ])
    })

    it("widens nothing that is no person: a record-keyed or route-keyed subject is asked as it is", async () => {
        const { holds, runs, contacts } = await build(true)

        await expect(holds.holderOf(WS, [{ kind: "data.recordId", id: "rec-1" }], { contactId: null, routeId: null }, NONE)).resolves.toBeNull()
        expect(contacts.aliasesOf).not.toHaveBeenCalled()
        expect(runs.inFlightOfSubject).toHaveBeenCalledWith(WS, { kind: "data.recordId", id: "rec-1" })
    })

    it("in an app with no contacts asks the subjects as they are (no hold found through a merge)", async () => {
        const { holds } = await build(false)

        await expect(holds.holderOf(WS, [{ kind: "contactId", id: MERGED }], { contactId: MERGED, routeId: null }, NONE)).resolves.toBeNull()
    })
})
