import { Test } from "@nestjs/testing"
import { PROVIDER, TRIGGER } from "@nivo-lite/agent-sdk/names"
import { IMAP_MAIL_TRIGGER as realTrigger, writtenByMachine } from "./imap-mail.trigger"

const SUBJECT = Symbol("imap-mail.trigger")

const buildSubject = async (): Promise<typeof realTrigger> => {
    const moduleRef = await Test.createTestingModule({ providers: [{ provide: SUBJECT, useValue: realTrigger }] }).compile()
    return moduleRef.get<typeof realTrigger>(SUBJECT)
}

const ORIGIN = { connectionId: "mailbox-1" }

const row = {
    externalId: "INBOX:7:42",
    folder: "INBOX",
    uid: 42,
    date: "2026-11-14T01:00:00.000Z",
    from: [{ name: " Lan ", address: " Lan@B.test " }],
    subject: " Hoa don ",
    text: "Gui shop hoa don thang 10.",
    attachments: [{ name: "hd.xml", type: "text/xml", size: 10 }, { name: null, type: "image/png", size: 1 }],
    messageId: "<m1@b.test>",
    inReplyTo: "<m0@shop.test>",
    references: ["<m-1@shop.test>", "<m0@shop.test>"],
}

describe("the mailbox's trigger (MAIL-IN rule MI-4)", () => {
    it("is the mail verb, received by the poll, a person's line keyed by its subject and combined as a stream", async () => {
        const trigger = await buildSubject()

        expect([trigger.provider, trigger.name, trigger.verb, trigger.via, trigger.key, trigger.combine, trigger.dataType]).toEqual([
            PROVIDER.smtp,
            "mail.received",
            TRIGGER.mailMessageReceived,
            ["poll"],
            { by: "subject" },
            "stream",
            "imap.mail",
        ])
        expect(trigger.switch).toEqual({ decided: false, onByDefault: false })
        expect(trigger.settle).toEqual({ windowMs: 6000, maxWaitMs: 20_000 })
    })

    it("translates a stored mail row into the person's line: the sender's ADDRESS as a person-level subject, the words, the thread keys", async () => {
        const trigger = await buildSubject()
        const parsed = trigger.raw.parse(row)

        const event = trigger.translate(parsed, ORIGIN)

        expect(event).toEqual({
            id: "INBOX:7:42",
            subject: { channel: "email", id: "lan@b.test", identity: "email", name: "Lan" },
            data: {
                messageKey: "email:<m1@b.test>",
                text: "Hoa don\n\nGui shop hoa don thang 10.",
                at: "2026-11-14T01:00:00.000Z",
                mailId: "INBOX:7:42",
                folder: "INBOX",
                subject: "Hoa don",
                messageId: "<m1@b.test>",
                inReplyTo: "<m0@shop.test>",
                references: ["<m-1@shop.test>", "<m0@shop.test>"],
                attachments: ["hd.xml"],
            },
        })
        expect(trigger.data.safeParse(event?.data).success).toBe(true)
        expect(trigger.line?.(event?.data ?? trigger.data.parse({}))).toEqual({
            key: "email:<m1@b.test>",
            text: "Hoa don\n\nGui shop hoa don thang 10.",
            at: "2026-11-14T01:00:00.000Z",
        })
    })

    it("keys a mail with no Message-ID by its mailbox id, and gives no line for an empty key", async () => {
        const trigger = await buildSubject()
        const event = trigger.translate(trigger.raw.parse({ ...row, messageId: null, date: null }), ORIGIN)

        expect(event?.data).toMatchObject({ messageKey: "email:INBOX:7:42", at: null })
        expect(event?.data.messageId).toBeUndefined()
        expect(trigger.line?.({ ...(event?.data ?? trigger.data.parse({})), messageKey: "" })).toBeNull()
    })

    it("drops a row with no id, and a mail that names no sender (no person to meet)", async () => {
        const trigger = await buildSubject()

        expect(trigger.translate(trigger.raw.parse({ ...row, externalId: "" }), ORIGIN)).toBeNull()
        expect(trigger.translate(trigger.raw.parse({ ...row, from: [{ name: "x", address: " " }] }), ORIGIN)).toBeNull()
        expect(trigger.translate(trigger.raw.parse({ ...row, from: null }), ORIGIN)).toBeNull()
    })

    it.each([
        ["an auto-reply", { autoSubmitted: "auto-replied" }],
        ["a generated mail with parameters", { autoSubmitted: "Auto-Generated; owner-email=x" }],
        ["a list", { precedence: "list" }],
        ["a bulk mail", { precedence: " Bulk " }],
        ["junk", { precedence: "junk" }],
        ["a bounce (a null reverse path)", { returnPath: "< >" }],
    ])("no person wrote %s: decided by the headers the standards define, no event", async (_name, headers) => {
        const trigger = await buildSubject()

        expect(writtenByMachine({ ...row, ...headers })).toBe(true)
        expect(trigger.translate(trigger.raw.parse({ ...row, ...headers }), ORIGIN)).toBeNull()
    })

    it.each([
        ["Auto-Submitted: no", { autoSubmitted: "no" }],
        ["a first-class precedence", { precedence: "first-class" }],
        ["a return path", { returnPath: "<lan@b.test>" }],
        ["no header at all", {}],
    ])("a person wrote a mail with %s", async (_name, headers) => {
        const trigger = await buildSubject()

        expect(writtenByMachine({ ...row, ...headers })).toBe(false)
        expect(trigger.translate(trigger.raw.parse({ ...row, ...headers }), ORIGIN)).not.toBeNull()
    })

    it("never reads the words to decide: a person's text that SAYS it is automatic is a line", async () => {
        const trigger = await buildSubject()
        const event = trigger.translate(trigger.raw.parse({ ...row, subject: "Auto-reply: out of office", text: "This is an automatic reply" }), ORIGIN)

        expect(event).not.toBeNull()
    })
})
