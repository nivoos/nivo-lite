import type { SandboxCoverage } from "@modules/domain/provider-sandbox/sandbox-situations"

/**
 * What the Telegram bot's NIVO Sandbox covers of the standard (provider-sandbox rule 18). Roles: it DELIVERS updates (the bot's webhook; a
 * bot with a webhook cannot be polled), it takes ACTS (the customer send, the staff text) and holds a bot token. Delivery modes: twice and
 * late are the frame's; withheld does not apply (no poll).
 */
export const TELEGRAM_SANDBOX_COVERAGE: SandboxCoverage = {
    provider: "telegram",
    roles: [
        {
            role: "inbound",
            // The shapes the bot's message trigger reads as a line: text (a /start command is a text), a photo, a PDF or image document.
            shapes: { text: ["TELEGRAM-1"], photo: ["TELEGRAM-2"], document: ["TELEGRAM-3"], command: ["TELEGRAM-5"] },
            covers: {
                "inbound.unknown_sender": { cases: ["TELEGRAM-1"] },
                // A voice, an edited message and a sticker are accepted updates the trigger translate reads as no line.
                "inbound.not_a_line": { cases: ["TELEGRAM-4", "TELEGRAM-6", "TELEGRAM-7"] },
                "inbound.malformed": { na: "Telegram's door answers every proven update 200: the secret-token proof is the only refusal before keeping, and a sandbox account is proven by its key" },
                "inbound.withheld": {
                    na: "Telegram refuses getUpdates while the bot has a webhook, so no poll returns the update; Telegram itself keeps and re-sends an undelivered update for at most 24 hours (the trigger's withoutPoll reason)",
                },
            },
        },
        {
            role: "act",
            operation: "send",
            covers: {
                "act.final": {
                    na: "the customer send's declared final refusals (customer_opted_out, no_recipient, no_channel_identity) are decided by the engine before the channel port is called: the port has no final answer",
                },
                "act.unknown_applied": { cases: ["TELEGRAM-SEND-5"] },
                "act.confirm_read": { na: "the Bot API has no read of a message already sent: the engine resends a repeatable customer send under the same key" },
                "act.replay": { na: "the Bot API sendMessage takes no idempotency key: a resend is a second message, which the engine's repeatable ledger accounts for" },
                "act.partial": {
                    na: "the live port sends the text, then the pictures, and answers one receipt: a picture that fails after the text went out THROWS instead of answering a partial receipt, so there is no partial answer to reproduce (a finding for the port, not a case)",
                },
            },
        },
        {
            role: "act",
            operation: "sendToPerson",
            covers: {
                "act.final": { na: "the staff text is a notice to the team with no declared final refusal of its own" },
                "act.unknown_applied": { na: "the staff text is a notice nobody reads back: a lost answer cannot be told from a failure (TELEGRAM-STAFF-4)" },
                "act.confirm_read": { na: "the Bot API has no read of a message already sent" },
                "act.replay": { na: "the Bot API sendMessage takes no idempotency key" },
                "act.partial": { na: "a staff text is one text: it has no parts that can be done in part" },
            },
        },
        {
            role: "connection",
            covers: {
                "connection.credential_refused": { na: "a bot token is a static secret with no expiry: a bot Telegram no longer knows is TELEGRAM-STAFF-2, there is no separate mid-run refusal" },
                "connection.revoked": { cases: ["TELEGRAM-STAFF-2"] },
                "connection.refresh": { na: "a bot token is never refreshed, so no refresh can be refused or busy" },
            },
        },
    ],
}
