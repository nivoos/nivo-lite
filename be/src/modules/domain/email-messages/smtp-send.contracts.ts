import type { ConnectionRecord } from "@modules/domain/connections"
import type { MailMessage, SentMail, SmtpConfig } from "@modules/integrations/mail"

/**
 * Where a mail sits in a thread (RFC 5322 3.6.4; MAIL-IN rule MI-5): the `Message-ID` it answers and the ids of the thread, oldest first, so
 * the person's mail client shows it under the mails it answers.
 */
export interface MailThread {
    /** The `Message-ID` the mail answers. */
    readonly inReplyTo: string
    /** The ids of the thread, oldest first (the answered one last). */
    readonly references: ReadonlyArray<string>
}

/** One message and the mailbox it goes to, as a workspace SMTP account sends it. */
export interface SmtpOutgoing {
    /** The recipient. */
    readonly to: string
    /** The subject, the bodies and the attachments. */
    readonly message: MailMessage
    /** The thread the message answers, when it answers one. */
    readonly thread?: MailThread | undefined
}

/** What the account's mail server answered for an accepted message: its message id and the recipients it accepted. */
export type SmtpSent = SentMail

/**
 * The send of one workspace SMTP account, resolved by `SmtpSendRegistryService.portFor(account)` (THE ONE SWITCH): the live port sends
 * through the account's own mail server; the sandbox port only records the mail in the account's call log. A refusal or a failure is
 * thrown as the integration's own `MailError`.
 */
export interface SmtpSendPort {
    /** The provider key of the account (`smtp`, as `connections.provider` names it). */
    readonly provider: string
    /** Sends one message for the account; `config` carries the account's settings, with no password for a sandbox account. */
    send(account: ConnectionRecord, config: SmtpConfig, delivery: SmtpOutgoing): Promise<SmtpSent>
}
