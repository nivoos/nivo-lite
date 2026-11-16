import type { MailThread } from "./smtp-send.contracts"
import type { DeliveryResult } from "@modules/domain/channels"
import { ChannelsError, ChannelsErrorCode } from "@modules/domain/channels"
import { MAIL_ERROR_KINDS } from "@modules/integrations/mail"
// NEED (integrations owner): export `MailErrorCode` from the mail index; until then the enum is read from its file (as smtp-sandbox.failures).
import { MailErrorCode } from "@modules/integrations/mail/errors/mail.error"
import type { SendEmailResult } from "./email-messages.contracts"

/**
 * The mail integration's codes after which nobody knows whether the mail left: the server stopped answering (or answered something this
 * client does not know) after the request may have reached it. The one send reads them as an outcome unknown (repeatable: sent again
 * under the same key when the step runs again).
 */
const OUTCOME_UNKNOWN_CODES: ReadonlySet<string> = new Set([MailErrorCode.Timeout, MailErrorCode.Unknown])

/** The provider's own failure word of a code, for the ledger: `MAIL_RECIPIENT` -> `mail_recipient`. */
const wordOf = (code: string): string => code.toLowerCase()

const rejected = (failure: string): DeliveryResult => ({ delivered: false, failure, outcome: "rejected" })

/** The port's one channel-neutral "nothing was sent, try later" (rule QB-SEND), with the provider's own word. */
const notSent = (reason: string): ChannelsError => new ChannelsError({ code: ChannelsErrorCode.SendUnavailable, params: { reason } })

/** The typed kind of a mail code, or null for a code the integration does not declare. */
const kindOf = (code: string): string | null => Object.entries(MAIL_ERROR_KINDS).find(([known]) => known === code)?.[1] ?? null

/**
 * What one workspace mail send answered, as the customer send port answers it (rule SO-1: mail maps its own typed answers onto the port's
 * classes, reading only the typed status and code, never a server's words): sent = delivered; the workspace's own hourly limit, a
 * provider limit (`rate-limited`) or a server that could not be reached (`unavailable`: nothing left) = THROWN "not sent, try later"
 * (`CHANNELS_SEND_UNAVAILABLE`, the step parks on the retry ladder); a timeout or an unknown answer = an unknown outcome (`ambiguous`);
 * no mail account, a bad recipient, a refused login or sender = a refusal (`rejected`, the provider's word for the ledger).
 */
export const mailDeliveryOf = (sent: SendEmailResult): DeliveryResult => {
    if (sent.status === "sent") return { delivered: true, failure: null, outcome: "acknowledged" }
    if (sent.status === "rate_limited") throw notSent("mail_rate_limited")
    if (sent.status === "no_smtp") return rejected("mail_not_connected")
    if (sent.status === "blocked") return rejected(`mail_${sent.failure ?? "blocked"}`)
    const { code } = sent
    if (code === undefined) return { delivered: false, failure: "mail_failed", outcome: "ambiguous" }
    if (OUTCOME_UNKNOWN_CODES.has(code)) return { delivered: false, failure: wordOf(code), outcome: "ambiguous" }
    const kind = kindOf(code)
    if (kind === "rate-limited" || kind === "unavailable") throw notSent(wordOf(code))
    return rejected(wordOf(code))
}

/** The key prefix of a person's mail on a route: the mail trigger keeps each one as `email:<Message-ID>` (data-hub `imap-mail.trigger`). */
const MAIL_LINE_PREFIX = "email:"

/**
 * The thread a reply answers (RFC 5322 3.6.4; MAIL-IN rule MI-5), from the keys of the person's mails on the route, oldest first: `In-Reply-To`
 * = the newest one's `Message-ID`, `References` = every one's, oldest first. A key that is no mail's (a mail with no `Message-ID` is keyed by
 * its mailbox id) is left out; null when none is left.
 */
export const mailThreadOf = (answers: ReadonlyArray<string>): MailThread | null => {
    const ids = answers.filter((key) => key.startsWith(MAIL_LINE_PREFIX)).map((key) => key.slice(MAIL_LINE_PREFIX.length)).filter((id) => id.startsWith("<"))
    const newest = ids.at(-1)
    return newest === undefined ? null : { inReplyTo: newest, references: ids }
}
