import type { AddressObject, ParsedMail } from "mailparser"
import type { ImapAddress, ImapMessageRow } from "./imap-mailbox.contracts"

/** The most text kept from one message. */
export const IMAP_MAX_TEXT: number = 20 * 1024

/** The raw text of a header as the message carries it (the first one of its name), trimmed; null when the message has none. */
const headerOf = (mail: ParsedMail, name: string): string | null => {
    const line = mail.headerLines.find((one) => one.key === name)?.line
    if (line === undefined) return null
    const colon = line.indexOf(":")
    const value = (colon < 0 ? "" : line.slice(colon + 1)).replaceAll(/\s+/gu, " ").trim()
    return value === "" ? null : value
}

/** The ids of the `References` header, in order (the thread the message belongs to). */
const referencesOf = (mail: ParsedMail): ReadonlyArray<string> => {
    const value = mail.references
    if (value === undefined) return []
    return (Array.isArray(value) ? value : [value]).filter((one) => one.trim() !== "")
}

const addresses = (value: AddressObject | Array<AddressObject> | undefined): Array<ImapAddress> => {
    if (value === undefined) return []
    const list = Array.isArray(value) ? value.flatMap((entry) => entry.value) : value.value
    return list.map((entry) => ({
        name: entry.name === "" ? null : entry.name,
        address: entry.address === undefined || entry.address === "" ? null : entry.address,
    }))
}

const stripBlocks = (html: string): string => {
    const lower = html.replaceAll(/[A-Z]/gu, (letter) => letter.toLowerCase()).replaceAll("ſ", "s")
    const ends = { script: lower.indexOf("</script>"), style: lower.indexOf("</style>") }
    const parts: Array<string> = []
    let start = 0
    let cursor = 0
    while (cursor < html.length) {
        const index = cursor
        cursor += 1
        if (html[index] !== "<") continue
        const kind = lower.startsWith("script", index + 1) ? "script" : "style"
        if (!lower.startsWith(kind, index + 1)) continue
        if (ends[kind] >= 0 && ends[kind] < index) ends[kind] = lower.indexOf(`</${kind}>`, index)
        if (ends[kind] < 0) continue
        parts.push(html.slice(start, index), " ")
        cursor = ends[kind] + kind.length + 3
        start = cursor
    }
    parts.push(html.slice(start))
    return parts.join("")
}

const stripTags = (withoutBlocks: string): string => {
    const text: Array<string> = []
    let start = 0
    let open = withoutBlocks.indexOf("<")
    while (open >= 0) {
        const end = withoutBlocks.indexOf(">", open + 1)
        if (end < 0) break
        if (end > open + 1) {
            text.push(withoutBlocks.slice(start, open), " ")
            start = end + 1
        }
        open = withoutBlocks.indexOf("<", end + 1)
    }
    text.push(withoutBlocks.slice(start))
    return text.join("")
}

const stripHtml = (html: string): string =>
    stripTags(stripBlocks(html))
        .replaceAll("&nbsp;", " ")
        .replaceAll("&amp;", "&")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll(/\s+/gu, " ")
        .trim()

type MailDate = Date | string | null | undefined

const validDate = (value: MailDate): Date | null => {
    if (value === null || value === undefined) return null
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
}

/** The largest XML attachment kept whole: an e-invoice (TT78) is a few kilobytes. */
const INVOICE_XML_MAX = 200_000

/** True for a small XML attachment, the shape of a Vietnamese e-invoice (TT78), whose text the e-invoice tools read. */
export const isInvoiceXml = (filename: string, contentType: string, size: number): boolean =>
    size <= INVOICE_XML_MAX && (filename.toLowerCase().endsWith(".xml") || contentType.includes("xml"))

/** One parsed email as a hub row: 20 KB of text, attachments as name/type/size only (a small XML e-invoice also keeps its text). */
export const messageToRow = (
    folder: string,
    uidValidity: string,
    uid: number,
    mail: ParsedMail,
    fallbackDate: MailDate,
): ImapMessageRow => {
    const body = (mail.text ?? (typeof mail.html === "string" ? stripHtml(mail.html) : "")).trim()
    return {
        externalId: `${folder}:${uidValidity}:${uid}`,
        title: mail.subject ?? "",
        occurredAt: validDate(mail.date) ?? validDate(fallbackDate),
        data: {
            folder,
            uid,
            from: addresses(mail.from),
            to: addresses(mail.to),
            cc: addresses(mail.cc),
            subject: mail.subject ?? "",
            text: body.slice(0, IMAP_MAX_TEXT),
            truncated: body.length > IMAP_MAX_TEXT,
            attachments: mail.attachments.map((attachment) => ({
                name: attachment.filename ?? null,
                type: attachment.contentType,
                size: attachment.size,
                ...(isInvoiceXml(attachment.filename ?? "", attachment.contentType, attachment.size)
                    ? { xml: attachment.content.toString("utf8") }
                    : {}),
            })),
            messageId: mail.messageId ?? null,
            inReplyTo: mail.inReplyTo ?? null,
            references: referencesOf(mail),
            // The headers the standards define for mail no person wrote (RFC 3834 Auto-Submitted and Precedence, RFC 5321 null reverse
            // path): kept as the message carries them; what they mean is the mail trigger's translate's to decide.
            autoSubmitted: headerOf(mail, "auto-submitted"),
            precedence: headerOf(mail, "precedence"),
            returnPath: headerOf(mail, "return-path"),
        },
    }
}

/** The row for a message that could not be parsed. */
export const unreadableRow = (
    folder: string,
    uidValidity: string,
    uid: number,
    fallbackDate: MailDate,
): ImapMessageRow => ({
    externalId: `${folder}:${uidValidity}:${uid}`,
    title: "",
    occurredAt: validDate(fallbackDate),
    data: { folder, uid, subject: "", text: "", unreadable: true, attachments: [] },
})
