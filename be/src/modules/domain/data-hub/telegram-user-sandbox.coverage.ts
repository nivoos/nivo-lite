import type { SandboxCoverage } from "@modules/domain/provider-sandbox/sandbox-situations"

/*
 * THE PERSONAL TELEGRAM SANDBOX COVERAGE (SBX standard 2026-11-15): the account is only PULLED (`telegram-user-sync.service.ts`: the new
 * messages of the picked chats from each chat's message-id cursor, at most MAX_PER_CHAT_PER_RUN a chat). Role `pull` (operation `pull`) and
 * `connection` (the MTProto session).
 */
export const TELEGRAM_USER_SANDBOX_COVERAGE: SandboxCoverage = {
    provider: "telegram_user",
    roles: [
        {
            // SBX-LEAD: the messages a pull brings are the provider's events (the gate reads the `pull` cases as them).
            role: "inbound",
            shapes: { "a text line in a group": ["TELEGRAM_USER-1"], "a text line in a private chat": ["TELEGRAM_USER-2"], "a picture": ["TELEGRAM_USER-1"] },
            covers: {
                "inbound.unknown_sender": { cases: ["TELEGRAM_USER-1"] },
                "inbound.not_a_line": {
                    na: "the pull stores every message it reads as a data-hub `message` row (`telegram-user-sync.service.ts`); it starts no run, so no event of it is a customer line either way",
                },
                "inbound.malformed": {
                    na: "the messages are read through the Telegram client library as typed objects, not a body NIVO parses: there is no door to refuse a malformed one",
                },
                "inbound.withheld": { na: "a user account never calls NIVO: it is only pulled, so every message is found by the pull and there is no webhook to withhold" },
            },
        },
        {
            role: "pull",
            operation: "pull",
            covers: {
                "pull.first": { cases: ["TELEGRAM_USER-1"] },
                "pull.new": { cases: ["TELEGRAM_USER-2"] },
                "pull.changed": {
                    na: "the pull reads each chat by message id after the cursor (`offsetId`): a message edited at Telegram keeps its id and is never read again, so the live pull has no changed message to bring",
                },
                "pull.page": { cases: ["TELEGRAM_USER-3"] },
                // TELEGRAM_USER-7: telegram-user.client.ts `readChats` skips a picked chat that is not among the dialogs (the owner left it) and reads the others.
                "pull.partial": { cases: ["TELEGRAM_USER-7"] },
            },
        },
        {
            role: "connection",
            covers: {
                "connection.credential_refused": { cases: ["TELEGRAM_USER-4"] },
                // Signed out in Telegram's Devices list: `checkAuthorization` is false and the client throws `revoked` (the same refusal as the credential's).
                "connection.revoked": { cases: ["TELEGRAM_USER-4"] },
                "connection.refresh": { na: "a Telegram session is a stored string, not an access token with a refresh: nothing is refreshed, and no other worker refreshes it" },
            },
        },
    ],
}
