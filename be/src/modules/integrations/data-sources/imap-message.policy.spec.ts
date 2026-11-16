import { Test } from "@nestjs/testing"
import type { AddressObject, Attachment, ParsedMail } from "mailparser"
import {
    IMAP_MAX_TEXT,
    isInvoiceXml as realIsInvoiceXml,
    messageToRow as realMessageToRow,
    unreadableRow as realUnreadableRow,
} from "./imap-message.policy"

const SUBJECT = Symbol("imap-message.policy")

const buildSubject = async () => {
    const moduleRef = await Test.createTestingModule({
        providers: [
            {
                provide: SUBJECT,
                useValue: {
                    isInvoiceXml: realIsInvoiceXml,
                    messageToRow: realMessageToRow,
                    unreadableRow: realUnreadableRow,
                },
            },
        ],
    }).compile()
    return moduleRef.get<{
        isInvoiceXml: typeof realIsInvoiceXml
        messageToRow: typeof realMessageToRow
        unreadableRow: typeof realUnreadableRow
    }>(SUBJECT)
}

const registerMessageFields = () => {
    it("keeps the text, the people and the attachment names", async () => {
        const subject = await buildSubject()

        const sent = new Date("2026-01-02T03:04:05.000Z")
        const row = subject.messageToRow(
            "INBOX",
            "9",
            4,
            mail({
                text: " Hello ",
                subject: "Order",
                date: sent,
                from: address([
                    { name: "Ada", address: "ada@example.com" },
                    { name: "", address: "" },
                ]),
                to: [address([{ name: "Bo" }])],
                attachments: [attachment({ contentType: "image/png", size: 8 })],
                messageId: "<m@example.com>",
                inReplyTo: "<previous@example.com>",
            }),
            null,
        )

        expect(row).toEqual({
            externalId: "INBOX:9:4",
            title: "Order",
            occurredAt: sent,
            data: {
                folder: "INBOX",
                uid: 4,
                from: [
                    { name: "Ada", address: "ada@example.com" },
                    { name: null, address: null },
                ],
                to: [{ name: "Bo", address: null }],
                cc: [],
                subject: "Order",
                text: "Hello",
                truncated: false,
                attachments: [{ name: null, type: "image/png", size: 8 }],
                messageId: "<m@example.com>",
                inReplyTo: "<previous@example.com>",
                references: [],
                autoSubmitted: null,
                precedence: null,
                returnPath: null,
            },
        })
    })

    it("MAIL-IN: keeps the thread's ids and the raw headers the standards define for mail no person wrote, as the message carries them", async () => {
        const subject = await buildSubject()

        const row = subject.messageToRow(
            "INBOX",
            "9",
            6,
            mail({
                references: ["<a@example.com>", "<b@example.com>"],
                headerLines: [
                    { key: "auto-submitted", line: "Auto-Submitted:  auto-replied" },
                    { key: "precedence", line: "Precedence: bulk" },
                    { key: "return-path", line: "Return-Path: <>" },
                ],
            }),
            null,
        )

        expect(row.data).toMatchObject({
            references: ["<a@example.com>", "<b@example.com>"],
            autoSubmitted: "auto-replied",
            precedence: "bulk",
            returnPath: "<>",
        })
        expect(subject.messageToRow("INBOX", "9", 7, mail({ references: "<only@example.com>" }), null).data.references).toEqual([
            "<only@example.com>",
        ])
    })
}

const registerHtmlEdgeCases = () => {
    it.each<[string, string]>([
        ["İ<ſCRIPT>hidden</SCRIPT><STYLE>css</style><p>shown</p>", "İ shown"],
        ["<script>unclosed<b>visible</b>", "unclosed visible"],
        ["<><b>shown</b><unfinished", "<> shown <unfinished"],
        ["<script".repeat(10_000), "<script".repeat(10_000).slice(0, IMAP_MAX_TEXT)],
        ["<".repeat(100_000), "<".repeat(IMAP_MAX_TEXT)],
        ["<script>one</script><script>two</script>tail", "tail"],
    ])("extracts HTML text without rescanning unmatched openings (%#)", async (html, expected) => {
        const subject = await buildSubject()
        const row = subject.messageToRow("INBOX", "1", 1, mail({ html }), null)
        expect(row.data.text).toBe(expected)
    })
}

const registerMessageFallbacks = () => {
    it("reads HTML when there is no text, cuts a long body and falls back to the received date", async () => {
        const subject = await buildSubject()

        const received = new Date("2026-02-03T00:00:00.000Z")
        const body = `${"a".repeat(IMAP_MAX_TEXT)}tail`
        const row = subject.messageToRow(
            "Sent",
            "1",
            2,
            mail({
                html: "<style>x</style><script>y</script>Hi&nbsp;&amp;&lt;b&gt; <b>there</b>",
                date: new Date(Number.NaN),
                attachments: [attachment({ filename: "a.txt", contentType: "text/plain", size: 1 })],
            }),
            received,
        )

        expect(row.title).toBe("")
        expect(row.occurredAt).toEqual(received)
        expect(row.data.from).toEqual([])
        expect(row.data.to).toEqual([])
        expect(row.data.cc).toEqual([])
        expect(row.data.text).toBe("Hi &<b> there")
        expect(row.data.truncated).toBe(false)
        expect(row.data.messageId).toBeNull()
        expect(row.data.inReplyTo).toBeNull()
        expect(row.data.attachments).toEqual([{ name: "a.txt", type: "text/plain", size: 1 }])

        const long = subject.messageToRow("Sent", "1", 3, mail({ text: body }), "not-a-date")
        expect(long.data.text).toBe("a".repeat(IMAP_MAX_TEXT))
        expect(long.data.truncated).toBe(true)
        expect(long.occurredAt).toBeNull()
    })

    it("keeps an empty parsed message with no date, addresses or body", async () => {
        const subject = await buildSubject()

        expect(subject.messageToRow("INBOX", "9", 5, mail({}), null)).toEqual({
            externalId: "INBOX:9:5",
            title: "",
            occurredAt: null,
            data: {
                folder: "INBOX",
                uid: 5,
                from: [],
                to: [],
                cc: [],
                subject: "",
                text: "",
                truncated: false,
                attachments: [],
                messageId: null,
                inReplyTo: null,
                references: [],
                autoSubmitted: null,
                precedence: null,
                returnPath: null,
            },
        })
    })
}

const address = (value: AddressObject["value"]): AddressObject => ({ value, html: "", text: "" })

const mail = (partial: Partial<ParsedMail>): ParsedMail => ({
    attachments: [],
    headers: new Map(),
    headerLines: [],
    html: false,
    ...partial,
})

const attachment = (fields: Pick<Attachment, "contentType" | "size"> & Partial<Attachment>): Attachment => ({
    type: "attachment",
    partId: null,
    headers: new Map(),
    content: Buffer.alloc(0),
    release: null,
    checksum: "",
    ...fields,
})

const registerInvoiceXml = () => {
    it("keeps the text of a small XML e-invoice attachment and only the name, type and size of the rest", async () => {
        const subject = await buildSubject()

        const xml = "<HDon><TTChung>1</TTChung></HDon>"
        const row = subject.messageToRow(
            "INBOX",
            "1",
            5,
            mail({
                attachments: [
                    attachment({
                        filename: "HD001.XML",
                        contentType: "application/octet-stream",
                        size: 40,
                        content: Buffer.from(xml),
                    }),
                    attachment({
                        contentType: "text/xml",
                        size: 40,
                        content: Buffer.from(xml),
                    }),
                    attachment({ filename: "big.xml", contentType: "application/xml", size: 200_001 }),
                ],
            }),
            new Date("2026-02-03T00:00:00.000Z"),
        )

        expect(row.data.attachments).toEqual([
            { name: "HD001.XML", type: "application/octet-stream", size: 40, xml },
            { name: null, type: "text/xml", size: 40, xml },
            { name: "big.xml", type: "application/xml", size: 200_001 },
        ])
        expect(subject.isInvoiceXml("a.pdf", "application/pdf", 10)).toBe(false)
        expect(subject.isInvoiceXml("a.xml", "application/pdf", 200_000)).toBe(true)
    })
}

describe("imap message policy", () => {
    describe("messageToRow", () => {
        registerHtmlEdgeCases()
        registerMessageFields()
        registerMessageFallbacks()
        registerInvoiceXml()
    })

    describe("unreadableRow", () => {
        it("keeps the cursor identity and the received date when the message cannot be parsed", async () => {
            const subject = await buildSubject()

            const received = new Date("2026-04-05T00:00:00.000Z")

            expect(subject.unreadableRow("INBOX", "9", 4, received)).toEqual({
                externalId: "INBOX:9:4",
                title: "",
                occurredAt: received,
                data: { folder: "INBOX", uid: 4, subject: "", text: "", unreadable: true, attachments: [] },
            })
            expect(subject.unreadableRow("INBOX", "9", 4, undefined).occurredAt).toBeNull()
        })
    })
})
