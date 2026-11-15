import type { SandboxCoverage } from "@modules/domain/provider-sandbox/sandbox-situations"

/**
 * What Zalo OA's NIVO Sandbox covers of the standard (provider-sandbox rule 18). Roles: it DELIVERS events (the OA's webhook and its inbox
 * poll), it takes ACTS (the customer send, the staff text), answers a READ (the customer's profile) and holds a CREDENTIAL (an OAuth token
 * pair). Delivery modes (twice, late, withheld) are the frame's: ZALO-1 and ZALO-3 are `polled` (the OA's inbox poll reads texts back).
 */
export const ZALO_SANDBOX_COVERAGE: SandboxCoverage = {
    provider: "zalo_oa",
    roles: [
        {
            role: "inbound",
            // The shapes the OA's message trigger and door accept: text, picture and file lines; follow / unfollow keep the person only.
            shapes: { text: ["ZALO-1"], picture: ["ZALO-2"], file: ["ZALO-6"], follow: ["ZALO-10"], unfollow: ["ZALO-11"] },
            covers: {
                "inbound.unknown_sender": { cases: ["ZALO-1"] },
                // Zalo's video, voice and sticker events are accepted by the door and read as no customer line (the trigger translate drops them).
                "inbound.not_a_line": { cases: ["ZALO-7", "ZALO-8", "ZALO-9"] },
                "inbound.malformed": {
                    na: "Zalo's door keeps every body untouched (a body that is no JSON object is kept as text) and refuses nothing typed before keeping it; a bad proof is the guard's refusal, not a payload",
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
                "act.unknown_applied": { cases: ["ZALO-SEND-8"] },
                "act.confirm_read": { na: "Zalo OA has no read of a message already sent: the engine resends a repeatable customer send under the same key, never confirms it by a read" },
                "act.replay": { na: "Zalo OA takes no idempotency key: a resend is a second message, which the engine's repeatable ledger accounts for" },
                "act.partial": { cases: ["ZALO-SEND-7"] },
            },
        },
        {
            role: "act",
            operation: "sendToPerson",
            covers: {
                "act.final": { na: "the staff text is a notice to the team with no declared final refusal of its own" },
                "act.unknown_applied": {
                    na: "the staff text is a notice nobody reads back: a lost answer cannot be told from a failure (ZALO-STAFF-4), so an applied variant would show the engine nothing different",
                },
                "act.confirm_read": { na: "Zalo OA has no read of a message already sent" },
                "act.replay": { na: "Zalo OA takes no idempotency key for a staff text" },
                "act.partial": { na: "a staff text is one text: it has no parts that can be done in part" },
            },
        },
        {
            role: "read",
            operation: "profileOf",
            covers: {
                "read.not_found": { cases: ["ZALO-4"] },
                "read.page": { na: "a profile read answers one person: it has no pages and no limit" },
            },
        },
        {
            role: "connection",
            covers: {
                "connection.credential_refused": { cases: ["ZALO-SEND-3"] },
                "connection.revoked": { cases: ["ZALO-STAFF-2"] },
                "connection.refresh": { cases: ["ZALO-SEND-6"] },
            },
        },
    ],
}
