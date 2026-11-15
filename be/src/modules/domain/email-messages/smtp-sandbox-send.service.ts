import { Injectable } from "@nestjs/common"
import type { ConnectionRecord } from "@modules/domain/connections"
import { ProviderSandboxService } from "@modules/domain/provider-sandbox"
import type { SmtpOutgoing, SmtpSendPort, SmtpSent } from "./smtp-send.contracts"
import { SMTP_SANDBOX_PROVIDER, SMTP_SEND_OPERATION } from "./smtp-sandbox.catalogue"
import { smtpAuthRefused, smtpConnectionRefused, smtpRecipientRefused, smtpSendingLimit, smtpTimedOut } from "./smtp-sandbox.failures"

/** The digits of the running message id of an accepted mail. */
const ID_DIGITS = 6

@Injectable()
/**
 * The sandbox twin of the workspace SMTP send (`SMTP-1` .. `7`): the mail is RECORDED in the account's call log (to, subject, text, html,
 * the names of the attachments) and never delivered; the account needs no password. The account's next case answers: accepted (default,
 * a running message id `sbx-smtp-000001` and the accepted recipient), the recipient refused, the login refused, no answer in time, a busy server (`SMTP-5`, `MAIL_CONNECT`) or a sending limit (`SMTP-6`, `MAIL_LIMIT`), both NOT SENT, or the mail taken with the answer lost (`SMTP-7`: kept in state `sent`, then `MAIL_TIMEOUT`).
 * A failing case throws the SAME `MailError` the live relay throws for it.
 */
export class SmtpSandboxSendService implements SmtpSendPort {
    readonly provider = SMTP_SANDBOX_PROVIDER

    constructor(private readonly sandbox: ProviderSandboxService) {}

    /** Answers one send of a sandbox account from its next case; one logged call per send, holding the whole mail. */
    send(account: ConnectionRecord, _config: unknown, delivery: SmtpOutgoing): Promise<SmtpSent> {
        const { to, message } = delivery
        return this.sandbox.call(
            account,
            SMTP_SEND_OPERATION,
            {
                to,
                subject: message.subject,
                text: message.text,
                html: message.html ?? null,
                attachments: (message.attachments ?? []).map((file) => file.filename),
                // The thread the mail answers, recorded as the headers would carry it (MAIL-IN rule MI-5).
                inReplyTo: delivery.thread?.inReplyTo ?? null,
                references: delivery.thread?.references ?? [],
            },
            {
                key: to,
                answer: async (state): Promise<SmtpSent> => {
                    if (state.nextCase === "SMTP-2") throw smtpRecipientRefused()
                    if (state.nextCase === "SMTP-3") throw smtpAuthRefused()
                    if (state.nextCase === "SMTP-4") throw smtpTimedOut()
                    if (state.nextCase === "SMTP-5") throw smtpConnectionRefused()
                    if (state.nextCase === "SMTP-6") throw smtpSendingLimit()
                    if (state.nextCase === "SMTP-7") {
                        // The server took the mail and the answer was lost: the mail IS sent (the account's state keeps it), the caller hears no answer.
                        await state.write("sent", to, { subject: message.subject, at: state.seq + 1 })
                        throw smtpTimedOut()
                    }
                    return { messageId: `sbx-smtp-${String(state.seq + 1).padStart(ID_DIGITS, "0")}`, accepted: [to] }
                },
            },
        )
    }
}
