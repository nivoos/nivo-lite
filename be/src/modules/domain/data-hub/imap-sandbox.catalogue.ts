import type { DataRecordInput } from "@modules/domain/data-records"
import type { SandboxCase, SandboxCatalogue } from "@modules/domain/provider-sandbox"

/** The provider key of a mailbox's inbound half standing alone. */
export const IMAP_SANDBOX_PROVIDER = "imap"

/** The provider key of a mailbox account that holds its inbound half (MAIL-IN rule MI-1): the same cases answer its inbound half. */
export const MAILBOX_SANDBOX_PROVIDER = "smtp"

/** The operation of the mailbox pull in the sandbox call log and in the account's next-case selector. */
export const IMAP_PULL_OPERATION = "pull"

/** The sandbox state name that keeps which sets the account was already handed (key: the set's case id; the value: where the set sits in the INBOX). */
export const IMAP_SANDBOX_DELIVERED_STATE = "imap-delivered"

/** The sandbox state name that keeps the last UID the account handed out (key: the folder). */
export const IMAP_SANDBOX_UID_STATE = "imap-uid"

/** The only folder of a sandbox mailbox. */
export const IMAP_SANDBOX_FOLDER = "INBOX"

/** The UIDVALIDITY of the sandbox mailbox (fixed: the sandbox mailbox is never rebuilt). */
export const IMAP_SANDBOX_UID_VALIDITY = "1"

/** The mailbox the mails are addressed to. */
const MAILBOX = { name: "Cua hang", address: "shop@example.com" }

/** The domain the sandbox message ids live under. */
const MESSAGE_ID_DOMAIN = "sandbox.nivo"

/** One minute, the gap between two mails of a set. */
const MINUTE_MS = 60_000

/** One file of a mail as the live parser keeps it: name, type and size only (`imap-message.policy.ts` `messageToRow`); the bytes stay at the mailbox. */
interface SandboxMailFile {
    readonly name: string
    readonly type: string
    readonly size: number
}

/** One mail of a set, as the sender wrote it (the UID, the date and the message id are the account's and the pull's). */
interface SandboxMail {
    readonly fromName: string
    readonly fromAddress: string
    readonly subject: string
    readonly text: string
    /** The `Message-ID` of the mail this one answers (a renewal notice NIVO sent), or null. */
    readonly inReplyTo: string | null
    /** The raw `Auto-Submitted` header, when the mail carries one (an auto-reply). */
    readonly autoSubmitted?: string
    /** The raw `Return-Path` header, when the mail carries one (`<>` on a delivery status notice, RFC 5321 4.5.5). */
    readonly returnPath?: string
    /** The files of the mail. */
    readonly attachments?: ReadonlyArray<SandboxMailFile>
    /** True for a message the live parser cannot read: the live client keeps `unreadableRow` for it (no head, no text, no sender). */
    readonly unreadable?: true
}

/** The notice a renewal reply answers (a fixed id: the sandbox keeps no sent mail). */
const RENEWAL_NOTICE = `<renewal-notice-1@${MESSAGE_ID_DOMAIN}>`

/** The shop's answer an in-thread reply answers (a fixed id: the sandbox SMTP's first accepted mail). */
const SHOP_ANSWER = "<sbx-smtp-000001@sandbox.nivo>"

/** The size of the burst of IMAP-7: one customer asking after an order each, in a fixed order. */
const BURST_SIZE = 30

/**
 * How many mails the busy mailbox of IMAP-16 holds: more than one poll page (`POLL_PAGE_SIZE`, 200 mails of `connection-poll`; a spec holds
 * the two together), so the walk meets a full page and reads an older one.
 */
export const IMAP_SANDBOX_BUSY_SIZE = 230

const burstOf = (): ReadonlyArray<SandboxMail> =>
    Array.from({ length: BURST_SIZE }, (_, index) => ({
        fromName: `Khach ${index + 1}`,
        fromAddress: `khach${index + 1}@example.com`,
        subject: `Hoi don hang so ${index + 1}`,
        text: `Chao shop, don hang so ${index + 1} cua minh bao gio giao a?`,
        inReplyTo: null,
    }))

const busyOf = (): ReadonlyArray<SandboxMail> =>
    Array.from({ length: IMAP_SANDBOX_BUSY_SIZE }, (_, index) => ({
        fromName: `Khach ${index + 1}`,
        fromAddress: `khach${index + 1}@example.com`,
        subject: `Hoi hang so ${index + 1}`,
        text: `Chao shop, minh hoi ve hang so ${index + 1}.`,
        inReplyTo: null,
    }))

/** The mails of each named set, by case id: fixed, identical on every machine. */
const SETS: Readonly<Record<string, ReadonlyArray<SandboxMail>>> = {
    "IMAP-1": [
        {
            fromName: "Nguyen Van An",
            fromAddress: "an.nguyen@example.com",
            subject: "Website bi loi khi thanh toan",
            text: "Chao shop, minh bam thanh toan tren website thi bao loi va khong len don. Nho shop kiem tra giup minh.",
            inReplyTo: null,
        },
    ],
    "IMAP-2": [
        {
            fromName: "Tran Thi Binh",
            fromAddress: "binh.tran@example.com",
            subject: "Hoi gia goi dich vu",
            text: "Chao shop, ben minh co cac goi dich vu nao va gia bao nhieu a? Minh can goi cho mot cua hang nho.",
            inReplyTo: null,
        },
    ],
    "IMAP-3": [
        {
            fromName: "Le Van Cuong",
            fromAddress: "cuong.le@example.com",
            subject: "Re: Gia han ten mien shop-cua-cuong.vn",
            text: "Dong y, gia han giup minh.",
            inReplyTo: RENEWAL_NOTICE,
        },
    ],
    "IMAP-4": [
        {
            fromName: "Pham Thi Dung",
            fromAddress: "dung.pham@example.com",
            subject: "Re: Gia han ten mien shop-cua-dung.vn",
            text: "Khong, minh khong gia han nua. Cam on.",
            inReplyTo: RENEWAL_NOTICE,
        },
    ],
    "IMAP-5": [
        {
            fromName: "",
            fromAddress: "nguoi.la@khong-ro.example.net",
            subject: "Hop tac quang cao",
            text: "Chao ban, ben toi muon de nghi hop tac quang cao. Ban vui long goi lai so 0900 000 000.",
            inReplyTo: null,
        },
    ],
    "IMAP-6": [
        {
            fromName: "Hoang Van Em",
            fromAddress: "em.hoang@example.com",
            subject: "Re: Gia han ten mien shop-cua-em.vn",
            text: "Dong y gia han ten mien. Nhung cho minh hoi them: phi hosting nam nay co tang khong, va bao gio xuat hoa don?",
            inReplyTo: RENEWAL_NOTICE,
        },
    ],
    "IMAP-7": burstOf(),
    "IMAP-8": [
        {
            fromName: "Nguyen Van An",
            fromAddress: "an.nguyen@example.com",
            subject: "Tra loi tu dong: Website bi loi khi thanh toan",
            text: "Toi dang nghi phep den het tuan, se tra loi khi quay lai.",
            inReplyTo: SHOP_ANSWER,
            autoSubmitted: "auto-replied",
        },
    ],
    "IMAP-9": [
        {
            fromName: "Nguyen Van An",
            fromAddress: "an.nguyen@example.com",
            subject: "Re: Website bi loi khi thanh toan",
            text: "Cam on shop, minh thu lai van loi o buoc chon phuong thuc thanh toan.",
            inReplyTo: SHOP_ANSWER,
        },
    ],
    "IMAP-10": [
        {
            fromName: "Nguyen Van An",
            fromAddress: "an.nguyen@example.com",
            subject: "Anh chup man hinh loi thanh toan",
            text: "Chao shop, minh gui kem anh chup man hinh luc bi loi.",
            inReplyTo: null,
            attachments: [{ name: "loi-thanh-toan.jpg", type: "image/jpeg", size: 245_760 }],
        },
    ],
    "IMAP-11": [
        {
            fromName: "Tran Thi Binh",
            fromAddress: "binh.tran@example.com",
            subject: "Hoa don can doi chieu",
            text: "Chao shop, minh gui hoa don thang 10 de shop doi chieu giup minh.",
            inReplyTo: null,
            attachments: [{ name: "hoa-don-thang-10.pdf", type: "application/pdf", size: 183_204 }],
        },
    ],
    "IMAP-12": [
        {
            fromName: "Le Van Cuong",
            fromAddress: "cuong.le@example.com",
            subject: "Hoi lich giao hang",
            text: "Chao shop, bao gio shop giao hang cho minh a?",
            inReplyTo: null,
        },
        // `imap.client.ts` `toRow` keeps `unreadableRow` for a message `simpleParser` cannot read: no sender, no subject, no text.
        { fromName: "", fromAddress: "", subject: "", text: "", inReplyTo: null, unreadable: true },
    ],
    "IMAP-13": [
        {
            fromName: "Mail Delivery System",
            fromAddress: "mailer-daemon@mx.example.net",
            subject: "Undelivered Mail Returned to Sender",
            text: "This is the mail system at host mx.example.net. Your message could not be delivered to one or more recipients.",
            inReplyTo: SHOP_ANSWER,
            autoSubmitted: "auto-generated",
            returnPath: "<>",
        },
    ],
    "IMAP-16": busyOf(),
}

/** The ids of the failing cases of the pull (no set of mails: the poll throws what the live reader throws). */
export const IMAP_CASE = { loginRefused: "IMAP-14", unreachable: "IMAP-15" } as const

/** The default set: answered while the account's selector names nothing. */
export const IMAP_SANDBOX_DEFAULT_SET = "IMAP-1"

/** The set a pull answers: the account's next case when it names a set, else the default (the first). */
export const imapSetIdOf = (nextCase: string | null): string =>
    nextCase !== null && Object.hasOwn(SETS, nextCase) ? nextCase : IMAP_SANDBOX_DEFAULT_SET

/** How many mails a set holds (the poll's window and page apply to a set larger than one page). */
export const imapSetSizeOf = (setId: string): number => SETS[setId]?.length ?? 0

/**
 * The hub rows of one set as the live client delivers them (`externalId` `<folder>:<uidvalidity>:<uid>`, the subject as title, the
 * sender's date, `data` with folder, uid, from, to, cc, subject, text, attachments, messageId, inReplyTo). The UIDs run from `firstUid`;
 * the dates are derived from `at` (the pull's moment: the last mail of the set is `at`, each earlier one a minute before).
 */
export const imapRowsOf = (setId: string, firstUid: number, at: Date): ReadonlyArray<DataRecordInput> => {
    const mails = SETS[setId] ?? []
    return mails.map((mail, index) => {
        const uid = firstUid + index
        const externalId = `${IMAP_SANDBOX_FOLDER}:${IMAP_SANDBOX_UID_VALIDITY}:${uid}`
        const occurredAt = new Date(at.getTime() - (mails.length - 1 - index) * MINUTE_MS)
        if (mail.unreadable === true) {
            // The row the live client keeps for a message it cannot parse (`unreadableRow`, imap-message.policy.ts).
            return { externalId, title: "", occurredAt, data: { folder: IMAP_SANDBOX_FOLDER, uid, subject: "", text: "", unreadable: true, attachments: [] } }
        }
        return {
            externalId,
            title: mail.subject,
            occurredAt,
            data: {
                folder: IMAP_SANDBOX_FOLDER,
                uid,
                from: [{ name: mail.fromName === "" ? null : mail.fromName, address: mail.fromAddress }],
                to: [MAILBOX],
                cc: [],
                subject: mail.subject,
                text: mail.text,
                truncated: false,
                attachments: mail.attachments ?? [],
                messageId: `<sbx-imap-${uid}@${MESSAGE_ID_DOMAIN}>`,
                inReplyTo: mail.inReplyTo,
                references: mail.inReplyTo === null ? [] : [mail.inReplyTo],
                ...(mail.autoSubmitted === undefined ? {} : { autoSubmitted: mail.autoSubmitted }),
                ...(mail.returnPath === undefined ? {} : { returnPath: mail.returnPath }),
            },
        }
    })
}

/** The outbound cases of the mailbox pull: the account's NEXT CASE picks the set the next poll delivers; IMAP-1 answers while nothing is picked. */
export const IMAP_SANDBOX_CASES: ReadonlyArray<SandboxCase> = [
    { id: "IMAP-1", label: "A support request: one customer reports the checkout failing", operation: IMAP_PULL_OPERATION, outcome: "ok", default: true },
    { id: "IMAP-2", label: "An enquiry: one prospect asks the price of the plans", operation: IMAP_PULL_OPERATION, outcome: "ok" },
    { id: "IMAP-3", label: "A renewal reply yes: a customer agrees to renew the domain, answering a renewal notice", operation: IMAP_PULL_OPERATION, outcome: "ok" },
    { id: "IMAP-4", label: "A renewal reply no: a customer declines to renew the domain, answering a renewal notice", operation: IMAP_PULL_OPERATION, outcome: "ok" },
    { id: "IMAP-5", label: "An unknown sender: a stranger's mail that matches no customer", operation: IMAP_PULL_OPERATION, outcome: "ok" },
    { id: "IMAP-6", label: "A mail meaning two things: agrees to renew and asks about hosting fees and invoicing in the same mail", operation: IMAP_PULL_OPERATION, outcome: "ok" },
    { id: "IMAP-7", label: "A burst: thirty customers each ask after their own order at once", operation: IMAP_PULL_OPERATION, outcome: "ok" },
    {
        id: "IMAP-8",
        label: "An auto-reply: the customer's out-of-office answers the shop's mail (Auto-Submitted: auto-replied); no line, no run",
        operation: IMAP_PULL_OPERATION,
        outcome: "ok",
    },
    {
        id: "IMAP-9",
        label: "A reply in the thread: the IMAP-1 customer answers the shop's mail (In-Reply-To the shop's answer)",
        operation: IMAP_PULL_OPERATION,
        outcome: "ok",
    },
    {
        id: "IMAP-10",
        label: "A picture attached: a customer sends a screenshot (image/jpeg; name, type and size are kept, the bytes stay at the mailbox)",
        operation: IMAP_PULL_OPERATION,
        outcome: "ok",
    },
    {
        id: "IMAP-11",
        label: "A PDF attached: a customer sends an invoice to check (application/pdf; name, type and size are kept)",
        operation: IMAP_PULL_OPERATION,
        outcome: "ok",
    },
    {
        id: "IMAP-12",
        label: "One mail cannot be read: the mailbox holds a readable mail and one the parser cannot read (kept as an unreadable row: no sender, no text, no line); the readable one is brought",
        operation: IMAP_PULL_OPERATION,
        outcome: "ok",
    },
    {
        id: "IMAP-13",
        label: "A bounce: a delivery status notice from the mail system (Return-Path: <>, Auto-Submitted: auto-generated); no line, no run",
        operation: IMAP_PULL_OPERATION,
        outcome: "ok",
    },
    {
        id: IMAP_CASE.loginRefused,
        label: "The mailbox login is refused (wrong or revoked app password): the poll is refused for good, only the owner can fix the credential (the live DataSourcesError Rejected)",
        operation: IMAP_PULL_OPERATION,
        outcome: "refused",
    },
    {
        id: IMAP_CASE.unreachable,
        label: "The mail server refuses the connection (busy or down): nothing is read, the poll is tried again (the live DataSourcesError Unavailable)",
        operation: IMAP_PULL_OPERATION,
        outcome: "transient",
    },
    {
        id: "IMAP-16",
        label: "A busy mailbox: 230 mails wait, more than one page: the poll takes the newest 200 and says more is left, the walk then reads the older 30",
        operation: IMAP_PULL_OPERATION,
        outcome: "ok",
    },
]

/** The inbound half's hardcoded catalogue, registered at boot. */
export const IMAP_SANDBOX_CATALOGUE: SandboxCatalogue = { provider: IMAP_SANDBOX_PROVIDER, cases: IMAP_SANDBOX_CASES }

/** The same cases under a mailbox account (MI-1): merged with its outbound `SMTP-*` cases, one account answers both halves. */
export const MAILBOX_INBOUND_SANDBOX_CATALOGUE: SandboxCatalogue = { provider: MAILBOX_SANDBOX_PROVIDER, cases: IMAP_SANDBOX_CASES }
