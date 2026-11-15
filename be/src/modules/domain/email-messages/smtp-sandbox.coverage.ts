import type { SandboxCoverage } from "@modules/domain/provider-sandbox/sandbox-situations"

/*
 * THE MAILBOX'S SANDBOX COVERAGE, OUTBOUND HALF (SBX standard 2026-11-15): a sandbox mailbox account (provider `smtp`) answers the send and,
 * on the same account, the poll of its inbound half (see `data-hub/imap-sandbox.coverage.ts`: the pull role of the same provider key).
 * Roles here: `act` on `send` (one mail to one recipient through the account's own mail server) and `connection` (the account's login).
 * Words come from `@starci/mail` `classifySmtpFailure` (smtp.js) and the integration's `MailErrorCode`, through the same
 * `mailErrorOf` the live relay uses (smtp-sandbox.failures.ts); how the engine reads each is `mail-delivery.policy.ts` `mailDeliveryOf`.
 */
export const SMTP_SANDBOX_COVERAGE: SandboxCoverage = {
    provider: "smtp",
    roles: [
        {
            role: "act",
            operation: "send",
            covers: {
                "act.final": {
                    na: "the finalRefusals of the customer send (customer_opted_out, no_recipient, no_channel_identity) are NIVO's own answers before any mail server is asked; a mail server never gives a refusal the engine reads as final",
                },
                // SMTP-7: the server took the mail (kept in the account's state `sent`) and the answer was lost: MAIL_TIMEOUT, which mailDeliveryOf reads as ambiguous.
                "act.unknown_applied": { cases: ["SMTP-7"] },
                "act.confirm_read": {
                    na: "an SMTP account cannot be asked whether a mail it sent was sent (no sent-folder read at the sending account); the mail send is repeatable, sent again under the same key when the step runs again",
                },
                "act.replay": { na: "SMTP takes no idempotency key: a second send is a second mail; the engine's ledger proves the send repeatable" },
                "act.partial": {
                    na: "the send takes one recipient per call, and @starci/mail refuses the whole send (MAIL_RECIPIENT) when the server rejects the address: no part of a send is done while another is not",
                },
            },
        },
        {
            role: "connection",
            covers: {
                // SMTP-3 is MAIL_AUTH (the login rejected), IMAP-14 the mailbox's own login refusal; a password revoked at the provider answers exactly as a wrong one.
                "connection.credential_refused": { cases: ["SMTP-3", "IMAP-14"] },
                "connection.revoked": { cases: ["SMTP-3", "IMAP-14"] },
                "connection.refresh": { na: "a mailbox account holds a password (an app password), not a token: there is nothing to refresh, and no other worker refreshes it" },
            },
        },
    ],
}
