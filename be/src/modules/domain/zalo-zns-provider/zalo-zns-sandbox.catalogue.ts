import { PROVIDER } from "@nivo-lite/agent-sdk/names"
import type { SandboxCase, SandboxCatalogue } from "@modules/domain/provider-sandbox"

/**
 * The key the ZNS catalogue registers under: `zalo_oa`. ZNS is a DELIVERY KIND of the Zalo OA account (`ZaloZnsTemplateService` registers
 * on the template-message registry under `PROVIDER.zaloOa`), so a ZNS send reaches an account of kind `zalo_oa`, and the Sandbox page
 * lists a sandbox OA account's cases by that account's provider. The catalogue registry MERGES by case id under one key (as Meta's two
 * destinations do), so these `ZNS-<n>` cases sit beside the Zalo OA's own `ZALO-<n>` cases without replacing them.
 */
export const ZALO_ZNS_SANDBOX_PROVIDER: string = PROVIDER.zaloOa

/** The operation of the template send in the sandbox call log and in the account's next-case selector: the port's own method name. */
export const ZNS_SEND_OPERATION = "sendTemplate"

/** State name: the template messages the account's OA sent, by message id. */
export const ZNS_SENT_STATE = "sent"

/** The case ids by what they do, so the service and its specs name no bare number. */
export const ZNS_CASE = {
    sent: "ZNS-1",
    templateNotFound: "ZNS-2",
    quotaUsedUp: "ZNS-3",
    notNow: "ZNS-4",
    timeout: "ZNS-5",
    appliedNoAnswer: "ZNS-6",
    authRefused: "ZNS-7",
} as const

/** How a refusing case ends: the registry's refusal reason and the words that ride as the detail. */
export interface ZnsSandboxRefusal {
    readonly reason: "rejected" | "not_found" | "auth_refused"
    readonly detail: string
}

/** The refusing cases, by case id (picked by the account's next case; the request's template id picks nothing). */
export const ZNS_SANDBOX_REFUSALS: Readonly<Record<string, ZnsSandboxRefusal>> = {
    [ZNS_CASE.templateNotFound]: { reason: "not_found", detail: "template not found" },
    [ZNS_CASE.quotaUsedUp]: { reason: "rejected", detail: "template quota exceeded" },
    [ZNS_CASE.authRefused]: { reason: "auth_refused", detail: "access token" },
}

/**
 * Zalo ZNS's hardcoded sandbox cases (ruling R60, R62 next-case shape): ONE default, `ZNS-1`, answered while nothing is picked; every other
 * case is picked per account and STICKY. The live send is `docs-missing` (it refuses everything `not_available` until the official ZNS
 * pages are read: `ZaloZnsTemplateService`), so it has no real error shape of its own: every answer here is built only from the registry's
 * own generic words (`providerRefusal` reasons, `providerCallFailure` proofs) and NO Zalo error number or field is guessed. ZNS has no
 * inbound case: its delivery reports have no webhook route in NIVO yet (see the coverage).
 */
export const ZALO_ZNS_SANDBOX_CASES: ReadonlyArray<SandboxCase> = [
    {
        id: ZNS_CASE.sent,
        label: "A template sent to a phone number is accepted: a running message id SBX-ZNS-000001, 000002 ...",
        operation: ZNS_SEND_OPERATION,
        outcome: "ok",
        default: true,
    },
    {
        id: ZNS_CASE.templateNotFound,
        label: "The template is not a template of this OA: refused not_found, nothing sent",
        operation: ZNS_SEND_OPERATION,
        outcome: "refused",
    },
    {
        id: ZNS_CASE.quotaUsedUp,
        label: "The OA's template quota is used up: refused rejected, nothing sent",
        operation: ZNS_SEND_OPERATION,
        outcome: "refused",
    },
    {
        id: ZNS_CASE.notNow,
        label: "Zalo does not take the send now (its rate limit or an outage answered before anything went out): nothing sent, a retry may pass (the registry's not-sent failure)",
        operation: ZNS_SEND_OPERATION,
        outcome: "transient",
    },
    {
        id: ZNS_CASE.timeout,
        label: "No answer arrives: the outcome is unknown (the registry's unknown failure) and nothing was sent",
        operation: ZNS_SEND_OPERATION,
        outcome: "timeout",
    },
    {
        id: ZNS_CASE.appliedNoAnswer,
        label: "No answer arrives, but the template message WAS sent (kept in the account's sent messages): a second send sends again",
        operation: ZNS_SEND_OPERATION,
        outcome: "timeout",
    },
    {
        id: ZNS_CASE.authRefused,
        label: "Refused: the OA's access token is no longer valid (auth refused, nothing sent); sticky, so every send is refused until the owner picks another case",
        operation: ZNS_SEND_OPERATION,
        outcome: "refused",
    },
]

/** The hardcoded catalogue of the ZNS template send (registered under the OA's key `zalo_oa`): ids `ZNS-<n>`, identical on every machine. */
export const ZALO_ZNS_SANDBOX_CATALOGUE: SandboxCatalogue = { provider: ZALO_ZNS_SANDBOX_PROVIDER, cases: ZALO_ZNS_SANDBOX_CASES }
