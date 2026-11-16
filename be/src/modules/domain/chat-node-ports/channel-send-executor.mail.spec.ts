import type { NodeTurn } from "@modules/domain/graph-nodes"
import { CALL, PERSON, TELEGRAM_ACCOUNT, TURN, build, contact, identity } from "@tests/fixtures/builders/channel-send-executor.builder"

// SEND-ONE rules SO-1..SO-3 (engine words): mail is a CHANNEL of the one customer send. What differs per channel is DECLARED (a subject
// line, the reply window, how a person is addressed); the send reads the declaration, never a channel's name. A person-level identity
// (a mail address) reaches the person through the account the agent is bound to; a send may name the address itself (the engine meets
// the person by it). Everything after the address is the same send: route, ledger, rights, consent, refusal facts.

type World = Awaited<ReturnType<typeof build>>

/** The workspace's mail account (provider `smtp`) the agent is attached to. */
const MAILBOX = "smtp-1"

/** A run that serves nobody and was woken on no route (a clock round, a team-chat turn). */
const NOBODY: NodeTurn = { ...TURN, conversationId: null, contactId: null }

/** The person's mail address, as the contact holds it (a person-level identity: no channel, no account). */
const mailOf = (value: string) =>
    identity({ id: "i-mail", kind: "email", provider: "", account: "", value, verified: false, verifiedBy: null, source: "step" })

const SUBJECT = "Bao gia gia han"
const TEXT = "Da em gui anh bao gia."

/** The agent is bound to the workspace's mail account for the send (the node lists `smtp`). */
const boundToMailbox = (world: World): void => {
    world.access.boundAccountsOf.mockResolvedValue([{ provider: "smtp", connectionId: MAILBOX }])
    world.access.judgeSend.mockResolvedValue({ kind: "allow", provider: "smtp", connectionId: MAILBOX })
    world.access.attachmentOf.mockResolvedValue({ kind: "allow", provider: "smtp", connectionId: MAILBOX })
}

describe("ChannelSendExecutorService: mail is a channel of the one send (rules SO-1..SO-3)", () => {
    it("a person known only by mail is told by mail: the subject goes with it, on a route of the mail entrance, kept in the ledger", async () => {
        const world = await build()
        boundToMailbox(world)
        world.contacts.get.mockResolvedValue(contact([mailOf("lan@example.vn")]))

        const told = await world.executor.execute(NOBODY, { contactId: PERSON, subject: SUBJECT, text: TEXT }, CALL)

        expect(told).toMatchObject({ kind: "message", facts: { delivered: true, channel: "email", accountId: MAILBOX, contactId: PERSON } })
        expect(world.delivery.deliverToPerson).toHaveBeenCalledWith(
            expect.objectContaining({ channel: "email", accountId: MAILBOX, userId: "lan@example.vn", subject: SUBJECT, text: TEXT }),
        )
        const route = await world.routes.find("ws-1", PERSON, { channel: "email", accountId: MAILBOX })
        expect(route).not.toBeNull()
        expect(world.ledger.rows).toEqual([
            expect.objectContaining({ sendKey: CALL.key, routeId: route?.id, channel: "email", accountId: MAILBOX, state: "delivered" }),
        ])
        // The rights are the attachment to THAT mail account, judged like every channel's.
        expect(world.access.judgeSend).toHaveBeenCalledWith(expect.objectContaining({ target: { provider: "smtp", connectionId: MAILBOX } }))
    })

    it("the mail channel declares a subject: a send without one is refused `subject_required` before any approval, nothing goes", async () => {
        const world = await build()
        boundToMailbox(world)
        world.contacts.get.mockResolvedValue(contact([mailOf("lan@example.vn")]))

        await expect(world.executor.refusalFor(NOBODY, { contactId: PERSON, text: TEXT }, CALL)).resolves.toMatchObject({
            kind: "refused",
            id: "subject_required",
        })
        expect(world.ledger.rows).toEqual([])
        await expect(world.executor.execute(NOBODY, { contactId: PERSON, text: TEXT }, CALL)).resolves.toMatchObject({
            kind: "refused",
            id: "subject_required",
        })
        expect(world.delivery.deliverToPerson).not.toHaveBeenCalled()
    })

    it("by ADDRESS: a person the workspace may not know yet is met by their mail address (the check writes nothing), then told", async () => {
        const world = await build()
        boundToMailbox(world)
        world.contacts.meetAddress.mockImplementation((_workspace, _kind, _value, make) => Promise.resolve(make ? PERSON : null))
        world.contacts.get.mockResolvedValue(contact([mailOf("new@example.vn")]))
        const send = { channel: "email", address: "new@example.vn", subject: SUBJECT, text: TEXT }

        await expect(world.executor.refusalFor(NOBODY, send, CALL)).resolves.toBeNull()
        expect(world.contacts.meetAddress).toHaveBeenLastCalledWith("ws-1", "email", "new@example.vn", false)
        expect(await world.routes.find("ws-1", PERSON, { channel: "email", accountId: MAILBOX })).toBeNull()

        await expect(world.executor.execute(NOBODY, send, CALL)).resolves.toMatchObject({ kind: "message", facts: { channel: "email" } })
        expect(world.contacts.meetAddress).toHaveBeenLastCalledWith("ws-1", "email", "new@example.vn", true)
        expect(world.delivery.deliverToPerson).toHaveBeenCalledWith(expect.objectContaining({ userId: "new@example.vn", subject: SUBJECT }))
    })

    it("an address on a channel that reaches people only by its own per-account ids is refused `address_not_accepted`", async () => {
        const world = await build()
        await expect(
            world.executor.execute(NOBODY, { channel: "telegram", address: "555", text: TEXT }, CALL),
        ).resolves.toMatchObject({ kind: "refused", id: "address_not_accepted", facts: { channel: "telegram" } })
        expect(world.contacts.meetAddress).not.toHaveBeenCalled()
        expect(world.delivery.deliverToPerson).not.toHaveBeenCalled()
    })

    it("no mail account bound to the agent: the person has no reach on mail (`no_channel_identity`), nothing claimed", async () => {
        const world = await build()
        world.access.boundAccountsOf.mockResolvedValue([])
        world.contacts.get.mockResolvedValue(contact([mailOf("lan@example.vn")]))
        await expect(
            world.executor.execute(NOBODY, { contactId: PERSON, subject: SUBJECT, text: TEXT }, CALL),
        ).resolves.toMatchObject({ kind: "refused", id: "no_channel_identity" })
        expect(world.ledger.rows).toEqual([])
    })

    it("SECOND KIND: a chat customer who also has a mail is answered on the chat route they wrote on, the subject not used", async () => {
        const world = await build()
        boundToMailbox(world)
        world.access.judgeSend.mockResolvedValue({ kind: "allow", provider: "telegram", connectionId: TELEGRAM_ACCOUNT })
        world.contacts.get.mockResolvedValue(contact([identity(), mailOf("lan@example.vn")]))

        await expect(world.executor.execute(TURN, { subject: SUBJECT, text: TEXT }, CALL)).resolves.toMatchObject({
            kind: "message",
            facts: { channel: "telegram", accountId: TELEGRAM_ACCOUNT },
        })
        const [[pushed]] = world.delivery.deliverToPerson.mock.calls
        expect(pushed).toMatchObject({ channel: "telegram", userId: "555" })
        expect(pushed).not.toHaveProperty("subject")
        // The mail reach was not even looked at: the person is on a chat and the call named no mail.
        expect(world.access.boundAccountsOf).not.toHaveBeenCalled()
    })

    it("the chat customer's mail is used when the call names the mail channel", async () => {
        const world = await build()
        boundToMailbox(world)
        world.contacts.get.mockResolvedValue(contact([identity(), mailOf("lan@example.vn")]))
        await expect(world.executor.execute(TURN, { channel: "email", subject: SUBJECT, text: TEXT }, CALL)).resolves.toMatchObject({
            kind: "message",
            facts: { channel: "email", accountId: MAILBOX },
        })
    })

    it("the reply window is the channel's DECLARATION: a Telegram person who last wrote days ago is still reachable (no window declared)", async () => {
        const world = await build()
        world.lines.lastHeardAt.mockResolvedValue(new Date("2026-10-01T00:00:00.000Z"))
        await expect(world.executor.execute(TURN, { text: TEXT }, CALL)).resolves.toMatchObject({ kind: "message" })
    })

    it("MAIL-IN rule MI-3: an account that is no ENTRANCE refuses `entrance_incomplete` before any approval, with the half it misses", async () => {
        const world = await build()
        boundToMailbox(world)
        world.contacts.get.mockResolvedValue(contact([mailOf("lan@example.vn")]))
        world.delivery.entranceOf.mockResolvedValue("inbound")
        const send = { contactId: PERSON, subject: SUBJECT, text: TEXT }

        await expect(world.executor.refusalFor(NOBODY, send, CALL)).resolves.toMatchObject({
            kind: "refused",
            id: "entrance_incomplete",
            facts: { accountId: MAILBOX, missing: "inbound" },
        })
        await expect(world.executor.execute(NOBODY, send, CALL)).resolves.toMatchObject({ kind: "refused", id: "entrance_incomplete" })
        expect(world.delivery.entranceOf).toHaveBeenCalledWith("ws-1", MAILBOX)
        expect(world.delivery.deliverToPerson).not.toHaveBeenCalled()
        expect(world.ledger.rows).toEqual([expect.objectContaining({ state: "refused", reason: "entrance_incomplete" })])
    })

    it("MAIL-IN rule MI-5: a channel that DECLARES it threads replies is handed the keys of the person's lines on the route, oldest first", async () => {
        const world = await build()
        boundToMailbox(world)
        world.contacts.get.mockResolvedValue(contact([mailOf("lan@example.vn")]))
        world.lines.threadOf.mockResolvedValue({
            rows: [
                { key: "email:<m2@x.test>", direction: "from_person" },
                { key: "send-key-1", direction: "to_person" },
                { key: "email:<m1@x.test>", direction: "from_person" },
            ] as unknown as Awaited<ReturnType<World["lines"]["threadOf"]>>["rows"],
            next: null,
        })

        await world.executor.execute(NOBODY, { contactId: PERSON, subject: SUBJECT, text: TEXT }, CALL)

        expect(world.delivery.deliverToPerson).toHaveBeenCalledWith(expect.objectContaining({ answers: ["email:<m1@x.test>", "email:<m2@x.test>"] }))
    })

    it("MAIL-IN rule MI-5: a chat channel declares no threading: no keys handed, no read of the route", async () => {
        const world = await build()

        await world.executor.execute(TURN, { text: TEXT }, CALL)

        expect(world.lines.threadOf).not.toHaveBeenCalled()
        expect(world.delivery.deliverToPerson.mock.calls[0]?.[0].answers).toBeUndefined()
    })
})
