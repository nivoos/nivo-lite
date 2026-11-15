import type { SandboxCase, SandboxCatalogue } from "@modules/domain/provider-sandbox"

/** The operation of a workspace SMTP send in the sandbox call log and in the account's next-case selector. */
export const SMTP_SEND_OPERATION = "send"

/** The provider key the SMTP connections carry. */
export const SMTP_SANDBOX_PROVIDER = "smtp"

/**
 * The outbound cases of the workspace SMTP send (R62: the account's NEXT CASE picks one, sticky; SMTP-1 answers while nothing is
 * picked). Whatever the case, the mail is recorded in the account's call log (to, subject, text, html) and never delivered.
 */
export const SMTP_SANDBOX_CATALOGUE_CASES: ReadonlyArray<SandboxCase> = [
    {
        id: "SMTP-1",
        label: "The mail is accepted: the server answers a message id (sbx-smtp-000001, running) and the recipient it accepted",
        operation: SMTP_SEND_OPERATION,
        outcome: "ok",
        default: true,
    },
    {
        id: "SMTP-2",
        label: "The mail is blocked: the server refuses the recipient address (MAIL_RECIPIENT)",
        operation: SMTP_SEND_OPERATION,
        outcome: "refused",
    },
    {
        id: "SMTP-3",
        label: "The mail is refused because the login is rejected (MAIL_AUTH)",
        operation: SMTP_SEND_OPERATION,
        outcome: "refused",
    },
    {
        id: "SMTP-4",
        label: "The mail times out: the server never answers, so the outcome is unknown (MAIL_TIMEOUT)",
        operation: SMTP_SEND_OPERATION,
        outcome: "timeout",
    },
    {
        // The live relay's answer for a server that refuses the connection (nodemailer `ECONNREFUSED`, classified by `@starci/mail`
        // `classifySmtpFailure`): `MAIL_CONNECT`, kind `unavailable`, which `mailDeliveryOf` throws as "not sent, try later" (SO-1).
        id: "SMTP-5",
        label: "A busy server: the mail server refuses the connection, so NOT SENT and nothing left (MAIL_CONNECT); the step parks on the retry ladder",
        operation: SMTP_SEND_OPERATION,
        outcome: "transient",
    },
    {
        // `classifySmtpFailure` reads a 452 / 4.2.1 answer as `MAIL_LIMIT`, kind `rate-limited`, which `mailDeliveryOf` throws as "not sent, try later".
        id: "SMTP-6",
        label: "The provider's sending limit is reached (452 4.2.1): NOT SENT, try later (MAIL_LIMIT)",
        operation: SMTP_SEND_OPERATION,
        outcome: "transient",
    },
    {
        id: "SMTP-7",
        label: "The server took the mail but the answer never came: the mail IS sent (kept in the account's state), the send says no answer in time (MAIL_TIMEOUT, outcome unknown)",
        operation: SMTP_SEND_OPERATION,
        outcome: "timeout",
    },
]

/** The SMTP sandbox catalogue the registration hands the Sandbox page's registry (its cases are the send's outbound cases above). */
export const SMTP_SANDBOX_CATALOGUE: SandboxCatalogue = { provider: SMTP_SANDBOX_PROVIDER, cases: SMTP_SANDBOX_CATALOGUE_CASES }
