import { PROVIDER, TRIGGER } from "@nivo-lite/agent-sdk/names"
import type { DeclaredLine, OptionalCanonicalEvent, TriggerDeclaration } from "@modules/domain/provider-triggers"
import { IMAP_MAIL_ROW_SCHEMA, MAIL_RECEIVED_DATA_SCHEMA } from "./imap-mail.schema"

/*
 * THE MAILBOX'S TRIGGER (stage 1 of the one event pipeline, concept triggers rule 13; MAIL-IN rule MI-4): one mail the connection poll
 * kept as a NEW `imap.mail` row of a mailbox (the INBOX: the account_data intake keyed by `<folder>:<uidvalidity>:<uid>`, so a mail read
 * twice is one row and the row is the evidence), as ONE canonical event: a PERSON'S LINE on the mail channel, like every customer
 * channel's message. Pure: the translate reads only its arguments, never the network. The person is the sender's ADDRESS, a person-level
 * identity (`identity: "email"`: the same person on every mailbox), so enrich meets them by it and keeps their route on the mailbox
 * account; a reply in the thread is the same person on the same entrance, the same route. A mail no person wrote is decided by the
 * headers the standards define for it, never by its words: `Auto-Submitted` other than `no` (RFC 3834 5), `Precedence` bulk / list / junk
 * (RFC 3834 3.1.8), a null reverse path `Return-Path: <>` (RFC 5321 4.5.5, a delivery status notice): no event, no line.
 */

/** The trigger's name inside the provider. */
export const MAIL_RECEIVED = "mail.received"

/** The channel of a person's mail address (the contact identity kind and the one send's channel). */
export const MAIL_CHANNEL = "email"

/** One person on a mail, as the stored row keeps them. */
export type MailPerson = {
    readonly name?: string | null | undefined
    readonly address?: string | null | undefined
}

/** One file of a mail as the stored row keeps it: its name, type and size (the bytes stay at the mailbox). */
export type MailFile = {
    readonly name?: string | null | undefined
    readonly type?: string | null | undefined
    readonly size?: number | null | undefined
}

/** The members of the stored `imap.mail` row value the translate reads (data-records imap.data-types.ts `imapMail`, version 2). */
export type ImapMailRow = {
    /** The mail's id in the inbox, `<folder>:<uidvalidity>:<uid>`. */
    readonly externalId: string
    /** The mailbox folder the mail sits in. */
    readonly folder: string
    /** The mail's UID inside its folder. */
    readonly uid: number
    /** When the mail was sent, as ISO text. */
    readonly date?: string | null | undefined
    /** Who wrote it. */
    readonly from?: ReadonlyArray<MailPerson> | null | undefined
    /** Its subject line. */
    readonly subject?: string | null | undefined
    /** Its text. */
    readonly text?: string | null | undefined
    /** Its files. */
    readonly attachments?: ReadonlyArray<MailFile> | null | undefined
    /** The mail's `Message-ID` header. */
    readonly messageId?: string | null | undefined
    /** The `Message-ID` it answers. */
    readonly inReplyTo?: string | null | undefined
    /** The ids of its thread. */
    readonly references?: ReadonlyArray<string> | null | undefined
    /** The raw `Auto-Submitted` header. */
    readonly autoSubmitted?: string | null | undefined
    /** The raw `Precedence` header. */
    readonly precedence?: string | null | undefined
    /** The raw `Return-Path` header. */
    readonly returnPath?: string | null | undefined
}

/** The data of one mail: a person's line on the mail channel with its thread keys. */
export type MailReceivedData = {
    /** The key the line is stored once under on the route: `email:<Message-ID>`, else `email:<mail id>`. */
    readonly messageKey: string
    /** The words as a step reads them: the subject line, then the text. */
    readonly text: string
    /** When the mail was sent (ISO 8601), or null when it carries no date. */
    readonly at: string | null
    /** The mail's id in the mailbox (the stored row's key). */
    readonly mailId: string
    /** The mailbox folder the mail sits in. */
    readonly folder: string
    /** The subject line, as written. */
    readonly subject: string
    /** The mail's `Message-ID` header. */
    readonly messageId?: string | undefined
    /** The `Message-ID` it answers. */
    readonly inReplyTo?: string | undefined
    /** The ids of its thread, oldest first. */
    readonly references: ReadonlyArray<string>
    /** The names of its files (their bytes stay at the mailbox). */
    readonly attachments: ReadonlyArray<string>
}

/** The `Precedence` values RFC 3834 3.1.8 names for mail sent to many or by a machine. */
const MASS_PRECEDENCE: ReadonlySet<string> = new Set(["bulk", "list", "junk"])

/** The first token of a header value (before a `;` parameter or a comment), lower-cased. */
const tokenOf = (value: string | null | undefined): string =>
    (value ?? "").split(/[;(]/u, 1).join("").trim().toLowerCase()

/** True when the headers the standards define say no person wrote the mail (an auto-reply, a list, a bounce). */
export const writtenByMachine = (row: ImapMailRow): boolean => {
    const submitted = tokenOf(row.autoSubmitted)
    if (submitted !== "" && submitted !== "no") return true
    if (MASS_PRECEDENCE.has(tokenOf(row.precedence))) return true
    return (row.returnPath ?? "").replaceAll(/\s/gu, "") === "<>"
}

/** The sender: the first `From` address, trimmed, with the name it gives; null when the mail names none. */
const senderOf = (row: ImapMailRow): { readonly address: string; readonly name: string } | null => {
    const first = (row.from ?? []).find((person) => typeof person.address === "string" && person.address.trim() !== "")
    if (first === undefined || typeof first.address !== "string") return null
    return { address: first.address.trim().toLowerCase(), name: (first.name ?? "").trim() }
}

/** The words of the line: the subject line, then the text, each as written. */
const wordsOf = (subject: string, text: string): string => [subject, text].filter((part) => part !== "").join("\n\n")

/** The translate: one person's line per stored mail; null for a mail no person wrote or one that names no sender. */
export const translateImapMailRow = (row: ImapMailRow): OptionalCanonicalEvent<MailReceivedData> => {
    if (row.externalId === "" || writtenByMachine(row)) return null
    const sender = senderOf(row)
    if (sender === null) return null
    const messageId = typeof row.messageId === "string" && row.messageId !== "" ? row.messageId : undefined
    const subject = (row.subject ?? "").trim()
    return {
        id: row.externalId,
        subject: { channel: MAIL_CHANNEL, id: sender.address, identity: "email", ...(sender.name === "" ? {} : { name: sender.name }) },
        data: {
            messageKey: `${MAIL_CHANNEL}:${messageId ?? row.externalId}`,
            text: wordsOf(subject, (row.text ?? "").trim()),
            at: typeof row.date === "string" ? row.date : null,
            mailId: row.externalId,
            folder: row.folder,
            subject,
            ...(messageId === undefined ? {} : { messageId }),
            ...(typeof row.inReplyTo === "string" && row.inReplyTo !== "" ? { inReplyTo: row.inReplyTo } : {}),
            references: (row.references ?? []).filter((one) => one !== ""),
            attachments: (row.attachments ?? []).flatMap((file) => (typeof file.name === "string" && file.name !== "" ? [file.name] : [])),
        },
    }
}

/** The line the person wrote, as the engine keeps it on the route: the mail's key, its words, its time. Pure. */
export const mailLineOf = (data: MailReceivedData): DeclaredLine | null =>
    data.messageKey === "" ? null : { key: data.messageKey, text: data.text, at: data.at }

/** A person's mail settles as a customer line does: the run starts once they are quiet for 6 s, 20 s after their first mail at most. */
const LINE_SETTLE = { windowMs: 6000, maxWaitMs: 20_000 } as const

/** The account_data type the mailbox's rows are kept as (data-records `IMAP_MAIL_TYPE`), written as a value: a declaration imports no value of another piece. */
const MAIL_DATA_TYPE = "imap.mail"

/** What the owner's pages say of the mailbox's trigger. */
const MAIL_WORDS: TriggerDeclaration["words"] = {
    title: { vi: "Hộp thư · thư mới", en: "Mailbox · new mail" },
    summary: {
        vi: "Một người gửi thư tới hộp thư: thư là một dòng của người đó trong cuộc trò chuyện của họ với hộp thư.",
        en: "A person mailed the mailbox: the mail is a line of theirs in their conversation with the mailbox.",
    },
    members: {
        subject: { vi: "Tiêu đề thư.", en: "The mail's subject line." },
        mailId: { vi: "Mã của thư trong hộp thư.", en: "The mail's id in the mailbox." },
        messageId: { vi: "Mã Message-ID của thư.", en: "The mail's Message-ID." },
        inReplyTo: { vi: "Mã của thư mà thư này trả lời.", en: "The Message-ID the mail answers." },
    },
}

/**
 * The mailbox's declaration: received by the connection poll, a person's line on the route of the mailbox account. It belongs to the
 * provider KIND of the account that receives it (owner R95 follow-up): the mailbox is ONE account of kind `smtp` (MAIL-IN rule MI-1) whose
 * inbound half (`imap.mail` rows, read by the `imap` poll receiver) feeds it, so a graph lists `smtp` alone. An `imap` account standing
 * alone is no entrance (MI-3): its mails are kept as data and its delivery is refused at the gate (it does not act as `smtp`).
 */
export const IMAP_MAIL_TRIGGER: TriggerDeclaration<ImapMailRow, MailReceivedData> = {
    provider: PROVIDER.smtp,
    name: MAIL_RECEIVED,
    verb: TRIGGER.mailMessageReceived,
    via: ["poll"],
    words: MAIL_WORDS,
    // A new inbound stream the owner approves per mailbox (triggers rule 6): off until switched on.
    switch: { decided: false, onByDefault: false },
    dataType: MAIL_DATA_TYPE,
    raw: IMAP_MAIL_ROW_SCHEMA,
    data: MAIL_RECEIVED_DATA_SCHEMA,
    translate: translateImapMailRow,
    line: mailLineOf,
    key: { by: "subject" },
    settle: LINE_SETTLE,
    // The person's mails append to the route's stream: held mails are ONE marker the workflow reads the stream from (rule Q-4).
    combine: "stream",
}
