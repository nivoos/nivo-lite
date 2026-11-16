import type { SandboxCoverage } from "@modules/domain/provider-sandbox/sandbox-situations"

/*
 * THE GENERIC WEBHOOK'S SANDBOX COVERAGE (SBX standard 2026-11-15): a webhook account is an ENDPOINT outside systems post signed JSON to
 * (inbound: `agent-inbound/generic-webhook.adapter.ts`: the event type from the `x-event-type` header, else the body's `type`, else `event`;
 * the delivery key from the header, else the body's `id`, else the digest of the bytes) and a RECEIVER NIVO posts signed business events to
 * (act `deliver`: `webhook-events.service.ts`, the verdict of `deliveryVerdict`: 2xx delivered, 429 / 5xx / no answer retried, any other status refused).
 */
export const WEBHOOK_SANDBOX_COVERAGE: SandboxCoverage = {
    provider: "webhook",
    roles: [
        {
            role: "inbound",
            shapes: {
                typeInBody: ["WEBHOOK-1"],
                eventInBody: ["WEBHOOK-13"],
                namedInHeaders: ["WEBHOOK-3"],
                noDeliveryId: ["WEBHOOK-4"],
            },
            covers: {
                "inbound.unknown_sender": {
                    na: "a webhook delivery names no person: its actor is the endpoint itself (kind webhook, trusted as an outsider), so there is no sender NIVO could hold no contact for",
                },
                "inbound.not_a_line": {
                    na: "every body the door accepts is an event the agent's trigger can start on (a type and its data); the door has no accepted-but-empty answer, a body that is no event is refused (inbound.malformed)",
                },
                "inbound.malformed": { cases: ["WEBHOOK-5", "WEBHOOK-6"] },
                "inbound.withheld": {
                    na: "the generic webhook is webhook only (the door `api/inbound/<id>`): a system outside NIVO has no call NIVO could poll, so no poll can find a withheld delivery",
                },
            },
        },
        {
            role: "act",
            operation: "deliver",
            covers: {
                "act.final": {
                    na: "no tool declares a final refusal for an outgoing delivery: a receiver's refusal (400, 401, 410) is recorded on the connection for the owner, never a business answer",
                },
                // WEBHOOK-16: the receiver took the delivery (state `received`) and the answer never came.
                "act.unknown_applied": { cases: ["WEBHOOK-16"] },
                "act.confirm_read": {
                    na: "a delivery has no read: NIVO cannot ask a receiver whether it got an event; the queue sends it again under the same delivery id",
                },
                "act.replay": {
                    na: "honouring the delivery id (x-nivo-delivery) is the receiver's business, outside NIVO; the sandbox receiver keeps no idempotency of its own (rule 10)",
                },
                "act.partial": { na: "one delivery carries one event to one receiver: it has no parts that could be partly done" },
            },
        },
        {
            role: "connection",
            covers: {
                // The receiver refuses the signature (401): the owner must fix the receiver or the key.
                "connection.credential_refused": { cases: ["WEBHOOK-14"] },
                // 410 Gone: the receiver's endpoint was removed, every delivery is refused until the owner names a new address.
                "connection.revoked": { cases: ["WEBHOOK-15"] },
                "connection.refresh": { na: "a webhook account signs with a shared secret (HMAC): there is no token that expires or is refreshed by another worker" },
            },
        },
    ],
}
