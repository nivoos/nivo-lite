import { mock } from "@starci/jest-preset"
import { CONTACTS_WORKSPACE as WS, MemoryContactMemory, MemoryContactsStore } from "@tests/fixtures/builders/contacts.builder"
import { ConversationContactsService } from "./conversation-contacts.service"
import { ContactsService } from "./contacts.service"
import { ContactToolsNativeService } from "../contact-tools/contact-tools-native.service"
import { ConnectionBindingsReadService } from "@modules/domain/connections"
import type { NativeCaller } from "@modules/domain/tools"
import { NativeViewService } from "@modules/domain/native-tools/native-view.service"

// GRAPH-CLEAN rule (engine words, owner ruling R67): ONE consent fact on the contact: may the shop write to this person on its own
// initiative (yes / no, when, by whom, why). Set by a person on the contact page, or by a node step's call of the engine's contact tool
// when the person asked to stop (the package decides WHEN; the engine reads no words); cleared only by a person; a merge keeps a "no".

const NOW = new Date("2026-11-14T10:00:00.000Z")
const OWNER = { kind: "member", memberId: "member-owner" } as const
const STEP = { kind: "step", agentId: "agent-1", stepKey: "care.stop", approvedBy: null } as const

const build = () => {
    const store = new MemoryContactsStore()
    const contacts = new ContactsService(store, { now: () => NOW }, new MemoryContactMemory())
    const views = mock<NativeViewService>()
    views.of.mockResolvedValue({ workspaceId: WS, module: "sales", audience: "customer", installationId: null, searchable: true })
    const tools = new ContactToolsNativeService(contacts, mock<ConversationContactsService>(), views, mock<ConnectionBindingsReadService>(), {
        now: () => NOW,
    })
    return { store, contacts, tools }
}

/** A run of a step that serves the person (a customer run): the tool reaches the run's own contact only. */
const customerRun = (contactId: string): NativeCaller => ({
    agentId: "agent-1",
    conversationId: null,
    graphStep: true,
    opKey: "care.stop",
    run: { turnId: "run-1", locale: "vi", origin: "customer", memberId: null, handedOffBy: null, contactId, leadId: null, stepTools: [] },
})

describe("ContactsService consent: the one fact", () => {
    it("reads a contact nobody set it on as allowed, and a missing contact as null", async () => {
        const { store, contacts } = build()
        const lan = store.seed(WS, "Lan")

        await expect(contacts.consentOf(WS, lan)).resolves.toEqual({ doNotContact: false, at: null, by: null, reason: null })
        await expect(contacts.consentOf(WS, "00000000-0000-4000-8000-0000000000ff")).resolves.toBeNull()
    })

    it("a person sets it (when, who, why, audited) and clears it; the same value again writes nothing", async () => {
        const { store, contacts } = build()
        const lan = store.seed(WS, "Lan")

        const set = await contacts.setConsent(WS, lan, { doNotContact: true, reason: "Khach xin dung nhan tin" }, OWNER)
        const again = await contacts.setConsent(WS, lan, { doNotContact: true, reason: null }, OWNER)
        const cleared = await contacts.setConsent(WS, lan, { doNotContact: false, reason: null }, OWNER)

        expect(set).toEqual({
            kind: "set",
            contactId: lan,
            consent: { doNotContact: true, at: NOW.toISOString(), by: OWNER, reason: "Khach xin dung nhan tin" },
        })
        expect(again).toMatchObject({ kind: "unchanged", consent: { reason: "Khach xin dung nhan tin" } })
        expect(cleared).toMatchObject({ kind: "set", consent: { doNotContact: false, by: OWNER } })
        expect(store.events.filter((event) => event.action === "consent_changed").map((event) => event.detail)).toEqual([
            { doNotContact: true, reason: true },
            { doNotContact: false, reason: false },
        ])
    })

    it("a step's call may set it but never clear it: a clear by anyone but a person is refused, nothing written", async () => {
        const { store, contacts } = build()
        const lan = store.seed(WS, "Lan")

        await expect(contacts.setConsent(WS, lan, { doNotContact: true, reason: "asked to stop" }, STEP)).resolves.toMatchObject({
            kind: "set",
            consent: { by: STEP },
        })
        await expect(contacts.setConsent(WS, lan, { doNotContact: false, reason: null }, STEP)).resolves.toEqual({
            kind: "refused",
            reason: "cleared_only_by_person",
        })
        await expect(contacts.setConsent(WS, lan, { doNotContact: true, reason: null }, { kind: "channel" })).resolves.toEqual({
            kind: "refused",
            reason: "cleared_only_by_person",
        })
        await expect(contacts.consentOf(WS, lan)).resolves.toMatchObject({ doNotContact: true, by: STEP })
    })

    it("refuses a missing contact, and a merge keeps a person's no on the survivor", async () => {
        const { store, contacts } = build()
        const lan = store.seed(WS, "Lan")
        const twin = store.seed(WS, "Lan Nguyen")

        await expect(contacts.setConsent(WS, "00000000-0000-4000-8000-0000000000ff", { doNotContact: true, reason: null }, OWNER)).resolves.toEqual({
            kind: "refused",
            reason: "contact_missing",
        })
        await contacts.setConsent(WS, twin, { doNotContact: true, reason: "asked on Telegram" }, OWNER)
        await expect(contacts.merge(WS, { into: lan, from: twin, by: OWNER })).resolves.toMatchObject({ kind: "merged" })

        await expect(contacts.consentOf(WS, lan)).resolves.toMatchObject({ doNotContact: true, reason: "asked on Telegram", by: OWNER })
        await expect(contacts.consentOf(WS, twin)).resolves.toMatchObject({ doNotContact: true })
    })
})

describe("nivo.tool.contact.update `doNotContact`: the engine's tool a node calls when the person asked to stop", () => {
    it("sets the run's own contact's fact with the step as who and the step's reason as why", async () => {
        const { store, contacts, tools } = build()
        const lan = store.seed(WS, "Lan")

        await expect(tools.invoke(WS, "update", { doNotContact: { reason: "Khach noi dung nhan nua" } }, customerRun(lan))).resolves.toEqual({
            updated: true,
            contactId: lan,
            doNotContact: true,
        })
        await expect(contacts.consentOf(WS, lan)).resolves.toEqual({
            doNotContact: true,
            at: NOW.toISOString(),
            by: { kind: "step", agentId: "agent-1", stepKey: "care.stop", approvedBy: null },
            reason: "Khach noi dung nhan nua",
        })
        // Naming only `doNotContact` writes no name or tag event of its own.
        expect(store.events.map((event) => event.action)).toEqual(["consent_changed"])
    })

    it("has no argument that clears it: a clear is refused by the schema, the fact stays", async () => {
        const { store, contacts, tools } = build()
        const lan = store.seed(WS, "Lan")
        await tools.invoke(WS, "update", { doNotContact: { reason: "stop" } }, customerRun(lan))

        await expect(tools.invoke(WS, "update", { doNotContact: false }, customerRun(lan))).rejects.toBeDefined()
        await expect(tools.invoke(WS, "update", { doNotContact: { reason: "" } }, customerRun(lan))).rejects.toBeDefined()
        await expect(contacts.consentOf(WS, lan)).resolves.toMatchObject({ doNotContact: true })
    })
})
