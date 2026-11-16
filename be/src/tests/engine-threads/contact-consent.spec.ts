import type { GraphSpec } from "@nivo-lite/agent-sdk/graph"
import { INSTALLED } from "@modules/domain/installed-plugins"
import { ENDING_SEND, ENDING_TEXT } from "@tests/fixtures/builders/step-ending-plugin.builder"
import { NUDGE_AGENT, NUDGE_GRAPH } from "@tests/fixtures/builders/node-settings-plugin.builder"
import {
    CONTACT,
    CONV,
    FRONT,
    WS,
    ZALO,
    customersSay,
    processOf,
    refOf,
    startThread,
    stopsOf,
    threadDbOf,
    type ThreadDb,
    type ThreadProcess,
} from "./thread-world"
import { chatServicesOf } from "./thread-world-intake"

// GRAPH-CLEAN item 3 (owner ruling R67): "do not contact" is ONE consent fact of the contact. GENERAL RULE (engine words): a message that
// ANSWERS the person on the route they wrote on is always allowed; a message the shop STARTS (a reminder, a nudge, a round, a campaign) is
// refused `customer_opted_out` when the fact says no, and is reported like every refused send (the step's declared ending: ONE notice).
// Run by the REAL engine on threads and the REAL customer send executor over the world's stores, reading the REAL ContactsService
// (`consentOf`) over the contacts store double. Exposing kind: a reminder (the step-ending fixture's send step, started with no route).
// Second kind: a clock-started round to a list of people (the nudge fixture, one run per person) where one of them opted out.
jest.mock("@nivo-lite/plugin-registry", () => {
    const parts: typeof import("@tests/fixtures/builders/installation-parts.builder") = jest.requireActual(
        "@tests/fixtures/builders/installation-parts.builder",
    )
    const desk: typeof import("@tests/fixtures/builders/thread-desk-plugin.builder") = jest.requireActual(
        "@tests/fixtures/builders/thread-desk-plugin.builder",
    )
    const ending: typeof import("@tests/fixtures/builders/step-ending-plugin.builder") = jest.requireActual(
        "@tests/fixtures/builders/step-ending-plugin.builder",
    )
    const nudge: typeof import("@tests/fixtures/builders/node-settings-plugin.builder") = jest.requireActual(
        "@tests/fixtures/builders/node-settings-plugin.builder",
    )
    return { installed: parts.installationWith([desk.DESK_PLUGIN, ending.ENDING_PLUGIN, nudge.NUDGE_PLUGIN], "contact-consent") }
})

const CODE = "DH-0077"
const NOTICE_KEY = "step-ending:"
const OWNER = { kind: "member", memberId: "member-owner" } as const

/** The installed template graph of an id, as an adopted workflow stores it. */
const flowOf = (id: string): GraphSpec => {
    const graph = INSTALLED.templateOf(id)?.versions[0]?.graph
    if (graph === undefined) throw new Error(`no template ${id}`)
    return graph
}

/** A run woken on the person's own route (the person wrote): what the send step says there is an ANSWER. */
const answerTrigger = {
    eventId: "zalo:m-consent-1",
    routeId: CONV,
    contactId: CONTACT,
    accountId: ZALO,
    subject: { channel: "zalo", id: "zalo-user-1" },
    data: { text: "Shop oi", messageKey: "zalo:m-consent-1" },
    text: ENDING_TEXT,
    code: CODE,
    locale: "vi",
}

/** A reminder the shop STARTS (a clock, a care rule): the run names the person and no route, so its send is unprompted. */
const reminderTrigger = { eventId: "clock:remind-1", contactId: CONTACT, text: ENDING_TEXT, code: CODE, locale: "vi" }

/** The person said "stop" and a person of the shop recorded it on the contact page. */
const optOut = async (db: ThreadDb, contactId: string = CONTACT): Promise<void> => {
    const outcome = await chatServicesOf(db).contacts.setConsent(WS, contactId, { doNotContact: true, reason: "Khach xin dung nhan tin" }, OWNER)
    expect(outcome).toMatchObject({ kind: "set" })
}

const stepsOf = async (process: ThreadProcess, runId: string): Promise<Readonly<Record<string, unknown>>> =>
    (await process.threads.stateOf(refOf(runId)))?.state.steps ?? {}

const noticesOf = (db: ThreadDb) => db.team.filter((message) => message.key.startsWith(NOTICE_KEY))

const sendOn = async (process: ThreadProcess, trigger: Readonly<Record<string, unknown>>, number: number) => {
    const started = await startThread(process, { flow: flowOf(ENDING_SEND), versionId: `tmend:send-on@${String(number)}`, workflowId: `wf:${ENDING_SEND}`, trigger })
    expect(started.error).toBeNull()
    return started.runId ?? ""
}

describe("the contact's consent fact at the send door (exposing kind: a reminder)", () => {
    it("a reminder to a person who opted out is refused `customer_opted_out`, nothing is sent, and the team is told ONCE", async () => {
        const db = threadDbOf()
        const process = await processOf(db)
        await customersSay(process, [{ text: "Shop oi", key: "m-consent-0" }])
        await optOut(db)

        const runId = await sendOn(process, reminderTrigger, 1)

        expect(await stepsOf(process, runId)).toMatchObject({ tell: { output: { sent: false, refusal: "customer_opted_out" } } })
        expect(db.lines.map((line) => line.text)).not.toContain(ENDING_TEXT)
        expect(noticesOf(db)).toHaveLength(1)
        expect(JSON.stringify(noticesOf(db)[0]?.versions.at(-1))).toContain("customer_opted_out")
        expect(await stopsOf(process, runId)).toEqual([])
    })

    it("an ANSWER on the person's own line still goes although they opted out: the fact is never read for a reply", async () => {
        const db = threadDbOf()
        const process = await processOf(db)
        await customersSay(process, [{ text: "Shop oi", key: "m-consent-0" }])
        await optOut(db)

        const runId = await sendOn(process, answerTrigger, 1)

        expect(await stepsOf(process, runId)).toMatchObject({ tell: { output: { sent: true, refusal: null } } })
        expect(db.lines.map((line) => line.text)).toEqual(expect.arrayContaining([ENDING_TEXT]))
        expect(noticesOf(db)).toEqual([])
    })

    it("control: the same reminder to a person who did not opt out is sent, and a person's clear lets the next reminder go", async () => {
        const db = threadDbOf()
        const process = await processOf(db)
        await customersSay(process, [{ text: "Shop oi", key: "m-consent-0" }])

        const sent = await sendOn(process, reminderTrigger, 1)
        await optOut(db)
        const refused = await sendOn(process, { ...reminderTrigger, eventId: "clock:remind-2" }, 2)
        await chatServicesOf(db).contacts.setConsent(WS, CONTACT, { doNotContact: false, reason: null }, OWNER)
        const again = await sendOn(process, { ...reminderTrigger, eventId: "clock:remind-3" }, 3)

        expect(await stepsOf(process, sent)).toMatchObject({ tell: { output: { sent: true } } })
        expect(await stepsOf(process, refused)).toMatchObject({ tell: { output: { sent: false, refusal: "customer_opted_out" } } })
        expect(await stepsOf(process, again)).toMatchObject({ tell: { output: { sent: true } } })
    })
})

describe("the contact's consent fact at the send door (second kind: a clock-started round to a list)", () => {
    it("the round tells every person of the list but the one who opted out, whose run records the typed refusal", async () => {
        const db = threadDbOf({ modules: { [FRONT]: NUDGE_AGENT } })
        const process = await processOf(db)
        await customersSay(process, [])
        const minh = await chatServicesOf(db).contacts.meetChannel(WS, { channel: "zalo", account: ZALO, userId: "8800110099", name: "Minh" })
        await optOut(db, CONTACT)
        const text = "Tuan nay shop co hoa moi a."

        // The clock's round: one run per person of the list (the engine runs one run per subject), each started with no route.
        const runs = []
        for (const [index, contactId] of [CONTACT, minh].entries()) {
            const started = await startThread(process, {
                flow: flowOf(NUDGE_GRAPH),
                versionId: `${NUDGE_GRAPH}@${String(index + 1)}`,
                workflowId: `wf:${NUDGE_GRAPH}`,
                trigger: { eventId: `clock:round-1:${contactId}`, contactId, text },
            })
            expect(started.error).toBeNull()
            runs.push(started.runId ?? "")
        }

        expect(await stepsOf(process, runs[0] ?? "")).toMatchObject({ nudge: { output: { told: false, reason: "customer_opted_out" } } })
        expect(await stepsOf(process, runs[1] ?? "")).toMatchObject({ nudge: { output: { told: true, reason: null } } })
        expect(db.chat.ledger.rows.filter((row) => row.text === text).map((row) => [row.contactId, row.state])).toEqual([
            [CONTACT, "refused"],
            [minh, expect.any(String)],
        ])
    })
})
