import { defineAccountDataType, type AccountDataTypeDef } from "@modules/domain/account-data"

/** The provider of a mailbox connection, as `connections.provider` names it. */
export const IMAP_PROVIDER = "imap"

/** The name of the mail type of a mailbox. */
export const IMAP_MAIL_TYPE = "imap.mail"

/** The name of the type that keeps how far each agent was handed the mails of a mailbox. */
export const IMAP_READ_CURSOR_TYPE = "imap.read-cursor"

/** The names of the credential members a mailbox connection holds (the IMAP login's password): no value of a mailbox type carries one. */
const IMAP_SECRET_FIELDS: ReadonlyArray<string> = ["password"]

/** The longest text of a mail the sync keeps (the data-sources `IMAP_MAX_TEXT`: 20 KB). */
export const IMAP_MAIL_TEXT_MAX: number = 20 * 1024

/** The longest mail id (`<folder>:<uidvalidity>:<uid>`) the account keeps, as the hub did; a longer one is not kept. */
export const IMAP_MAIL_ID_MAX = 300

/** The longest folder path a mailbox reads (the IMAP settings bound it to 200). */
export const IMAP_FOLDER_MAX = 200

/** The longest subject kept; a longer one is cut to it. */
export const IMAP_SUBJECT_MAX = 2000

/** The longest header id (`Message-ID`, `In-Reply-To`) kept; a longer one is cut to it. */
export const IMAP_HEADER_ID_MAX = 1000

/** The most ids of a `References` header kept (the newest end of a long thread is what threads a reply). */
export const IMAP_REFERENCES_MAX = 50

/** The longest raw header text kept of `Auto-Submitted`, `Precedence` and `Return-Path`. */
export const IMAP_HEADER_TEXT_MAX = 400

/**
 * One mail of a mailbox as the IMAP poll read it (read-only: EXAMINE, BODY.PEEK), keyed by `<folder>:<uidvalidity>:<uid>`, kept for good.
 * Append: the connection poll reads windows of time, and the intake's insert-or-nothing on this key IS the reconciliation (a mail read
 * twice is one row; the first copy stands). `attachments` holds name / type / size of each file, and the text of a small XML file (an
 * e-invoice) under `xml`. Version 2 (MAIL-IN): the thread keys (`references`) and the raw headers the standards define for mail no person
 * wrote (`autoSubmitted`, `precedence`, `returnPath`), and `wakes`: a NEW row of a mailbox that is a customer entrance wakes the mail
 * trigger (its translate reads the row; account-data rule 7).
 */
export const imapMail: AccountDataTypeDef = defineAccountDataType({
    name: IMAP_MAIL_TYPE,
    provider: IMAP_PROVIDER,
    version: 2,
    write: "append",
    fields: {
        externalId: { type: "text", required: true, maxLength: IMAP_MAIL_ID_MAX },
        folder: { type: "text", required: true, maxLength: IMAP_FOLDER_MAX },
        uid: { type: "integer", required: true },
        date: { type: "timestamp", required: false },
        from: { type: "json", required: false },
        to: { type: "json", required: false },
        cc: { type: "json", required: false },
        subject: { type: "text", required: true, maxLength: IMAP_SUBJECT_MAX },
        text: { type: "text", required: true, maxLength: IMAP_MAIL_TEXT_MAX },
        truncated: { type: "boolean", required: false },
        unreadable: { type: "boolean", required: false },
        attachments: { type: "json", required: true },
        messageId: { type: "text", required: false, maxLength: IMAP_HEADER_ID_MAX },
        inReplyTo: { type: "text", required: false, maxLength: IMAP_HEADER_ID_MAX },
        references: { type: "json", required: false },
        autoSubmitted: { type: "text", required: false, maxLength: IMAP_HEADER_TEXT_MAX },
        precedence: { type: "text", required: false, maxLength: IMAP_HEADER_TEXT_MAX },
        returnPath: { type: "text", required: false, maxLength: IMAP_HEADER_TEXT_MAX },
    },
    key: ["externalId"],
    occurredAt: "date",
    wakes: true,
    retention: "keep",
    indexes: [],
    secretFields: IMAP_SECRET_FIELDS,
    purpose: "mail.message",
})

/**
 * How far one agent was handed the mails of one mailbox (by `mail.message.list`), keyed by `<agent id>:<entity>`: NIVO's own bookkeeping,
 * never any content of a mail. `seenThrough` is `<created_at>~<row id>` of the last mail handed, the instant written fixed-width
 * (`YYYY-MM-DDTHH:MM:SS.ffffffZ`) so the text compares by code unit in the order the mails entered the store.
 */
export const imapReadCursor: AccountDataTypeDef = defineAccountDataType({
    name: IMAP_READ_CURSOR_TYPE,
    provider: IMAP_PROVIDER,
    version: 1,
    write: "advance",
    fields: {
        agentId: { type: "text", required: true, maxLength: 64 },
        entity: { type: "text", required: true, maxLength: 20 },
        seenThrough: { type: "text", required: true, maxLength: 100 },
    },
    key: ["agentId", "entity"],
    position: "seenThrough",
    wakes: false,
    retention: "keep",
    indexes: [],
    secretFields: IMAP_SECRET_FIELDS,
    purpose: "mail.read-position",
})

/** Every account data type of a mailbox connection, for the catalog. */
export const IMAP_DATA_TYPES: ReadonlyArray<AccountDataTypeDef> = [imapMail, imapReadCursor]
