import type { SandboxCase, SandboxCatalogue } from "@modules/domain/provider-sandbox"

/** The operation of the customer send in the sandbox call log and in the account's next-case selector. */
export const META_SEND_OPERATION = "send"

/**
 * The state name of what each person received from the Page: key = the person's id, value = how many messages (parts) reached them. Written
 * by the cases that deliver (`META-SEND-1`, the delivered part of `-8`, the lost answer of `-9`), so a repeat after an unknown outcome can be
 * seen to duplicate (the tool is `repeatable`: the worst case is a duplicate line).
 */
export const META_SANDBOX_DELIVERED_STATE = "delivered"

/** The case ids by what they do, so the service and its specs name no bare number. */
export const META_SEND_CASE = {
    delivered: "META-SEND-1",
    windowClosed: "META-SEND-2",
    timeout: "META-SEND-3",
    rateLimited: "META-SEND-4",
    unavailable: "META-SEND-5",
    tokenRefused: "META-SEND-6",
    recipientUnavailable: "META-SEND-7",
    partial: "META-SEND-8",
    appliedNoAnswer: "META-SEND-9",
} as const

/**
 * The outbound cases of the Meta customer send, Messenger and Instagram (R62: the account's NEXT CASE picks one, sticky; META-SEND-1
 * answers while nothing is picked). The 24-hour window rule applies before any of them: a person whose last line is older than 24 hours is
 * refused whatever case is picked. The live sender answers only yes or no, so a refusal and a timeout reach the engine as the same
 * unknown-outcome receipt (`MetaCustomerSendService`); only a refusal FOR NOW with nothing taken (Meta's rate limit, "temporarily
 * unavailable") is the port's not-sent answer (`CHANNELS_SEND_UNAVAILABLE`), and only when no part of a long text went out. Words: the Graph
 * error table of `integrations/meta/meta-failure.policy.ts` (190 token, 4 / 17 / 32 / 613 rate, 2 temporarily unavailable, 551 recipient
 * unavailable, 10 / 2018278 window) and the sender's `partsSent`.
 */
export const META_SEND_SANDBOX_CASES: ReadonlyArray<SandboxCase> = [
    {
        id: META_SEND_CASE.delivered,
        label: "The send is delivered: the Page's message is accepted by Meta",
        operation: META_SEND_OPERATION,
        outcome: "ok",
        default: true,
    },
    {
        id: META_SEND_CASE.windowClosed,
        label: "The send is refused outside the window: Meta says the 24-hour messaging window is closed (the live sender's no: an unknown-outcome receipt)",
        operation: META_SEND_OPERATION,
        outcome: "refused",
    },
    {
        id: META_SEND_CASE.timeout,
        label: "The send times out: Meta never answers, so the outcome is unknown (ambiguous receipt)",
        operation: META_SEND_OPERATION,
        outcome: "timeout",
    },
    {
        id: META_SEND_CASE.rateLimited,
        label: "The send is NOT SENT: Meta answers its rate limit (Graph code 613) before any part went out: the port's not-sent answer CHANNELS_SEND_UNAVAILABLE, so the engine retries later",
        operation: META_SEND_OPERATION,
        outcome: "transient",
    },
    {
        id: META_SEND_CASE.unavailable,
        label: "The send is NOT SENT: Meta answers \"temporarily unavailable\" (Graph code 2) before any part went out: CHANNELS_SEND_UNAVAILABLE (meta_unavailable), so the engine retries later",
        operation: META_SEND_OPERATION,
        outcome: "transient",
    },
    {
        id: META_SEND_CASE.tokenRefused,
        label: "The send is refused: Meta refuses the Page token (Graph code 190, expired or revoked): the live sender's no, an unknown-outcome receipt; sticky, so every send is refused until the owner picks another case",
        operation: META_SEND_OPERATION,
        outcome: "refused",
    },
    {
        id: META_SEND_CASE.recipientUnavailable,
        label: "The send is refused: Meta says the person cannot be reached (Graph code 551): the live sender's no, an unknown-outcome receipt",
        operation: META_SEND_OPERATION,
        outcome: "refused",
    },
    {
        id: META_SEND_CASE.partial,
        label: "A long text goes out in parts: the first part is delivered, then Meta's rate limit stops the rest: NOT a not-sent answer (a part went out), an unknown-outcome receipt",
        operation: META_SEND_OPERATION,
        outcome: "timeout",
    },
    {
        id: META_SEND_CASE.appliedNoAnswer,
        label: "The send times out, but Meta DID deliver it (the person's delivered count goes up): an unknown-outcome receipt; the engine's repeat then delivers a second time",
        operation: META_SEND_OPERATION,
        outcome: "timeout",
    },
]

/** The Meta customer-send catalogue the registration hands the Sandbox page's registry (its cases are the send's outbound cases above). */
export const META_SEND_SANDBOX_CATALOGUE: SandboxCatalogue = { provider: "meta", cases: META_SEND_SANDBOX_CASES }
