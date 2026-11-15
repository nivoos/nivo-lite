import type { SandboxCase, SandboxCatalogue } from "@modules/domain/provider-sandbox"

/** The operation of the customer send in the sandbox call log and in the account's next-case selector. */
export const ZALO_SEND_OPERATION = "send"

/** The operation of the staff send (a text to a member of the team through the OA) in the sandbox call log and in the next-case selector. */
export const ZALO_STAFF_OPERATION = "sendToPerson"

/**
 * The outbound cases of the Zalo OA customer send (R62: the account's NEXT CASE picks one, sticky; ZALO-SEND-1 answers while nothing is
 * picked). The 48-hour window rule applies before any of them: a person whose last line is older than 48 hours is refused with the
 * window receipt whatever case is picked.
 */
export const ZALO_SEND_SANDBOX_CASES: ReadonlyArray<SandboxCase> = [
    {
        id: "ZALO-SEND-1",
        label: "The send is delivered: a consultation message acknowledged by Zalo",
        operation: ZALO_SEND_OPERATION,
        outcome: "ok",
        default: true,
    },
    {
        id: "ZALO-SEND-2",
        label: "The send is refused outside the window: Zalo says the 48-hour consultation window is closed (zalo_window_expired)",
        operation: ZALO_SEND_OPERATION,
        outcome: "refused",
    },
    {
        id: "ZALO-SEND-3",
        label: "The send is refused because the access token is rejected even after a refresh (zalo_token)",
        operation: ZALO_SEND_OPERATION,
        outcome: "refused",
    },
    {
        id: "ZALO-SEND-4",
        label: "The send times out: Zalo never answers, so the outcome is unknown (ambiguous)",
        operation: ZALO_SEND_OPERATION,
        outcome: "timeout",
    },
    {
        id: "ZALO-SEND-5",
        label: "The send is NOT SENT: Zalo says the OA's message quota is used up (zalo_quota): the port's not-sent answer CHANNELS_SEND_UNAVAILABLE, nothing went out, so the engine retries later",
        operation: ZALO_SEND_OPERATION,
        outcome: "transient",
    },
    {
        id: "ZALO-SEND-6",
        label: "The send is NOT SENT: another worker is refreshing the OA's access token (zalo_refresh_busy): the port's not-sent answer CHANNELS_SEND_UNAVAILABLE, thrown so the engine retries",
        operation: ZALO_SEND_OPERATION,
        outcome: "transient",
    },
    {
        id: "ZALO-SEND-7",
        label: "The text is DELIVERED but its picture (the payment QR) is not: an acknowledged receipt with the note qr_image_failed (a partly done act)",
        operation: ZALO_SEND_OPERATION,
        outcome: "ok",
    },
    {
        id: "ZALO-SEND-8",
        label: "The send times out, but the message WAS delivered: the same unknown receipt as ZALO-SEND-4; the person is kept in state `delivered`, so a resend shows as a duplicate",
        operation: ZALO_SEND_OPERATION,
        outcome: "timeout",
    },
]

/** The state name the persons a send reached are kept under (key = the person, value = how many sends reached them): what a tester reads after an unknown outcome. */
export const ZALO_SANDBOX_DELIVERED_STATE = "delivered"

/**
 * The outbound cases of the staff send (a text to a member of the team through the OA, no reply window): ZALO-STAFF-1 answers while
 * nothing is picked; ZALO-STAFF-2 throws what the live route throws when the OA holds no usable token.
 */
export const ZALO_STAFF_SANDBOX_CASES: ReadonlyArray<SandboxCase> = [
    {
        id: "ZALO-STAFF-1",
        label: "The staff text is sent: the OA's consultation route accepts it (nothing is returned)",
        operation: ZALO_STAFF_OPERATION,
        outcome: "ok",
        default: true,
    },
    {
        id: "ZALO-STAFF-2",
        label: "The staff text is refused: the OA holds no usable access token (CHANNELS_ZALO_NOT_AUTHORIZED)",
        operation: ZALO_STAFF_OPERATION,
        outcome: "refused",
    },
    {
        id: "ZALO-STAFF-3",
        label: "The staff text is NOT SENT: Zalo says the OA's message quota is used up (zalo_quota): the port's not-sent answer CHANNELS_SEND_UNAVAILABLE, thrown so the engine retries",
        operation: ZALO_STAFF_OPERATION,
        outcome: "transient",
    },
    {
        id: "ZALO-STAFF-4",
        label: "The staff text times out: Zalo never answers, so the outcome is unknown (a transport failure is thrown, no receipt)",
        operation: ZALO_STAFF_OPERATION,
        outcome: "timeout",
    },
]

/** The customer send and the staff text as one catalogue of the provider (registered beside the inbound one: the registry merges them by provider key). */
export const ZALO_SEND_SANDBOX_CATALOGUE: SandboxCatalogue = {
    provider: "zalo_oa",
    cases: [...ZALO_SEND_SANDBOX_CASES, ...ZALO_STAFF_SANDBOX_CASES],
}
