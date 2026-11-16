// NEED (integrations owner): export `MailErrorCode` from the mail index; until then the enum is read from its file (the same `MailError` class).
import { classifySmtpFailure } from "@starci/mail"
import { MailError, MailErrorCode } from "@modules/integrations/mail/errors/mail.error"
import { mailErrorOf } from "@modules/integrations/mail/mail-error.policy"

/** What the sandbox says in the `detail` of a refusal: a server's words, never a real server. */
const RECIPIENT_DETAIL = "550 5.1.1 Recipient address rejected (sandbox)"
const AUTH_DETAIL = "535 5.7.8 Username and Password not accepted (sandbox)"
const TIMEOUT_DETAIL = "sandbox: no answer in time"

const failureOf = (code: MailErrorCode, detail: string): MailError => new MailError({ code, params: { detail } })

/** The server refused the recipient: the `MailError` the live relay throws (`MAIL_RECIPIENT`, invalid). */
export const smtpRecipientRefused = (): MailError => failureOf(MailErrorCode.Recipient, RECIPIENT_DETAIL)

/** The server refused the login: the live `MAIL_AUTH`. */
export const smtpAuthRefused = (): MailError => failureOf(MailErrorCode.Auth, AUTH_DETAIL)

/** The server never answered: the live `MAIL_TIMEOUT` (the outcome is unknown, as live). */
export const smtpTimedOut = (): MailError => failureOf(MailErrorCode.Timeout, TIMEOUT_DETAIL)

/**
 * What the live send throws for a server answer, built by the live path itself: the nodemailer-shaped failure goes through `@starci/mail`
 * `classifySmtpFailure` and the integration's `mailErrorOf`, exactly as `MailRelayService.sendThroughSmtp` maps it, so a case never
 * invents a code or a kind (an answer the live classifier reads differently fails the spec, not the case).
 */
// NEED (integrations owner): export `mailErrorOf` from the mail index; until then it is read from its file.
const liveFailureOf = (raw: { readonly code?: string; readonly responseCode?: number; readonly response?: string; readonly message: string }): MailError =>
    mailErrorOf(classifySmtpFailure(raw))

/** The server refused the connection (busy, down, full): the live `MAIL_CONNECT` (`unavailable`: nothing left, try later). */
export const smtpConnectionRefused = (): MailError => liveFailureOf({ code: "ECONNREFUSED", message: "connect ECONNREFUSED 203.0.113.25:587 (sandbox)" })

/** The provider's sending limit: the live `MAIL_LIMIT` (`rate-limited`: nothing left, try later). */
export const smtpSendingLimit = (): MailError =>
    liveFailureOf({ responseCode: 452, response: "452 4.2.1 Sending rate limit exceeded (sandbox)", message: "Data command failed: 452 4.2.1 Sending rate limit exceeded (sandbox)" })
