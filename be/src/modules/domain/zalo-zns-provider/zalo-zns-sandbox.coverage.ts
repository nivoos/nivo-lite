import type { SandboxCoverage } from "@modules/domain/provider-sandbox/sandbox-situations"
import { ZALO_ZNS_SANDBOX_PROVIDER, ZNS_CASE, ZNS_SEND_OPERATION } from "./zalo-zns-sandbox.catalogue"

/**
 * Zalo ZNS's NIVO Sandbox as the standard asks it (lane concept provider-sandbox rule 18), for the ZNS capability of the `zalo_oa`
 * account: ZNS is a DELIVERY KIND of the Zalo OA behind the one customer send (`TemplateMessageRegistryService` registers it under
 * `PROVIDER.zaloOa`), so it is declared under the OA's key and merged by the gate with the OA's own coverage (`zalo-provider`, another
 * worker's: its inbound role, text send, profile reads). The `act` role of `sendTemplate` and the account's `connection` as the template
 * send meets it. ZNS plays no inbound role: no ZNS delivery report has a route, a parser or a trigger in NIVO yet, so there is nothing a
 * sandbox case could send through a live door.
 */
export const ZALO_ZNS_SANDBOX_COVERAGE: SandboxCoverage = {
    provider: ZALO_ZNS_SANDBOX_PROVIDER,
    roles: [
        {
            role: "act",
            operation: ZNS_SEND_OPERATION,
            covers: {
                "act.final": {
                    na: "ZNS sits behind nivo.tool.customer.message.send, whose final refusals (customer_opted_out, no_recipient, no_channel_identity) NIVO decides before the template send is asked; Zalo itself has no answer the tool declares final.",
                },
                "act.unknown_applied": { cases: [ZNS_CASE.appliedNoAnswer] },
                "act.confirm_read": {
                    na: "The template-message port has the single method sendTemplate and no read of a sent message, and the customer send is repeatable, not confirmBy, so nothing can confirm an unknown outcome through NIVO.",
                },
                "act.replay": {
                    na: "The template request carries a trackingId that the provider's events echo back: it is the caller's own tracking id, not an idempotency key, so a repeat is sent again; the engine's ledger proves the send repeatable.",
                },
                "act.partial": { na: "One template message goes to one phone number in one call: it is sent or it is not, there is no batch that could be partly done." },
            },
        },
        {
            role: "connection",
            covers: {
                "connection.credential_refused": { cases: [ZNS_CASE.authRefused] },
                "connection.revoked": { cases: [ZNS_CASE.authRefused] },
                "connection.refresh": {
                    na: "The live ZNS send is docs-missing and calls no token refresh of its own; the OA token's refresh refusal and busy answers are cases of the Zalo OA's send (ZALO-SEND-5/6) declared in its own coverage.",
                },
            },
        },
    ],
}
