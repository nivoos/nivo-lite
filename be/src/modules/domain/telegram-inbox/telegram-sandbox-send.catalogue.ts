import type { SandboxCase, SandboxCatalogue } from "@modules/domain/provider-sandbox"

/** The operation of the customer send in the sandbox call log and in the account's next-case selector. */
export const TELEGRAM_SEND_OPERATION = "send"

/** The operation of the staff send (a text to a member of the team through the bot). */
export const TELEGRAM_STAFF_OPERATION = "sendToPerson"

/** The operation of "typing" in the person's chat; it has no case (it always shows). */
export const TELEGRAM_TYPING_OPERATION = "showTyping"

/**
 * The outbound cases of the Telegram customer send (R62: the account's NEXT CASE picks one, sticky; TELEGRAM-SEND-1 answers while nothing
 * is picked). Telegram has NO reply window: no case depends on how long ago the person wrote.
 */
export const TELEGRAM_SEND_SANDBOX_CASES: ReadonlyArray<SandboxCase> = [
    {
        id: "TELEGRAM-SEND-1",
        label: "The send is delivered: Telegram accepts the text (and the pictures that follow it)",
        operation: TELEGRAM_SEND_OPERATION,
        outcome: "ok",
        default: true,
    },
    {
        id: "TELEGRAM-SEND-2",
        label: "The send is refused by Telegram (a blocked bot): the typed refusal TELEGRAM_REJECTED, a definite not-delivered receipt",
        operation: TELEGRAM_SEND_OPERATION,
        outcome: "refused",
    },
    {
        id: "TELEGRAM-SEND-3",
        label: "The send times out, or Telegram answers a 5xx: either proves nothing about the effect, so the outcome is unknown (ambiguous receipt)",
        operation: TELEGRAM_SEND_OPERATION,
        outcome: "timeout",
    },
    {
        id: "TELEGRAM-SEND-4",
        label: "The send is NOT SENT: Telegram answers too many requests (error_code 429, retry_after 30): the port's not-sent answer CHANNELS_SEND_UNAVAILABLE, so the engine retries later",
        operation: TELEGRAM_SEND_OPERATION,
        outcome: "transient",
    },
    {
        id: "TELEGRAM-SEND-5",
        label: "The send gets no answer, but the message WAS delivered: the same unknown receipt as TELEGRAM-SEND-3; the person is kept in state `delivered`, so a resend shows as a duplicate",
        operation: TELEGRAM_SEND_OPERATION,
        outcome: "timeout",
    },
]

/** The state name the persons a send reached are kept under (key = the person, value = how many sends reached them): what a tester reads after an unknown outcome. */
export const TELEGRAM_SANDBOX_DELIVERED_STATE = "delivered"

/**
 * The outbound cases of the staff send: TELEGRAM-STAFF-1 answers while nothing is picked; TELEGRAM-STAFF-2 throws what the live route
 * throws when the bot of the connection is gone.
 */
export const TELEGRAM_STAFF_SANDBOX_CASES: ReadonlyArray<SandboxCase> = [
    {
        id: "TELEGRAM-STAFF-1",
        label: "The staff text is sent: Telegram accepts it (nothing is returned)",
        operation: TELEGRAM_STAFF_OPERATION,
        outcome: "ok",
        default: true,
    },
    {
        id: "TELEGRAM-STAFF-2",
        label: "The staff text is refused: the connection's bot is gone (CHANNELS_CONNECTION_NOT_FOUND)",
        operation: TELEGRAM_STAFF_OPERATION,
        outcome: "refused",
    },
    {
        id: "TELEGRAM-STAFF-3",
        label: "The staff text is NOT SENT: Telegram answers too many requests (429, retry_after 30): the port's not-sent answer CHANNELS_SEND_UNAVAILABLE, thrown so the engine retries",
        operation: TELEGRAM_STAFF_OPERATION,
        outcome: "transient",
    },
    {
        id: "TELEGRAM-STAFF-4",
        label: "The staff text times out: Telegram never answers, so the outcome is unknown (a transport failure is thrown, no receipt)",
        operation: TELEGRAM_STAFF_OPERATION,
        outcome: "timeout",
    },
]

/** The customer send and the staff text as one catalogue of the provider (registered beside the inbound one: the registry merges them by provider key). */
export const TELEGRAM_SEND_SANDBOX_CATALOGUE: SandboxCatalogue = {
    provider: "telegram",
    cases: [...TELEGRAM_SEND_SANDBOX_CASES, ...TELEGRAM_STAFF_SANDBOX_CASES],
}
