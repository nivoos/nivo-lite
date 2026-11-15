import type { SandboxCoverage } from "@modules/domain/provider-sandbox/sandbox-situations"

/**
 * What payOS's NIVO Sandbox covers of the standard (provider-sandbox rule 18). Roles: it DELIVERS paid orders (the webhook only: payOS has no
 * transaction list), it moves MONEY in (exactly: a link is paid in full or not at all), it issues PAY LINKS and takes ACTS on them
 * (create, cancel) and a READ (get). Delivery modes: twice and late are the frame's; withheld does not apply (no poll).
 */
export const PAYOS_SANDBOX_COVERAGE: SandboxCoverage = {
    provider: "payos",
    roles: [
        {
            role: "inbound",
            shapes: { paid: ["PAYOS-3"], sample: ["PAYOS-17"], notPaid: ["PAYOS-18"] },
            covers: {
                "inbound.unknown_sender": { na: "a payOS delivery names an order code, never a person" },
                "inbound.not_a_line": { cases: ["PAYOS-17", "PAYOS-18"] },
                "inbound.malformed": { na: "payOS's door refuses only an unproven body (a sandbox account is proven by its key); a body with no amount or a code other than 00 is acknowledged and ignored, not refused" },
                "inbound.withheld": {
                    na: "payOS documents no webhook retry policy and has no transaction list (only a per-link read that needs link ids): the trigger is webhook only (its withoutPoll reason)",
                },
            },
        },
        {
            role: "money",
            covers: {
                "money.exact": { cases: ["PAYOS-3"] },
                "money.short": { na: "payOS pays a link exactly: a short payment is never reported, the link stays PENDING" },
                "money.over": { na: "payOS pays a link exactly: an over payment is never reported" },
                "money.no_reference": { na: "payOS's paid body always names the order code and the bank reference of the payment" },
                "money.stranger_reference": { cases: ["PAYOS-8"] },
                "money.out": { na: "payOS's webhook reports paid orders only: no money going out is ever reported" },
            },
        },
        {
            role: "paylink",
            covers: {
                "paylink.paid": { cases: ["PAYOS-3"] },
                "paylink.expired": { cases: ["PAYOS-10"] },
                "paylink.cancelled": { cases: ["PAYOS-9", "PAYOS-5"] },
                "paylink.paid_unknown": { cases: ["PAYOS-8"] },
                // PAYOS-3 sent after PAYOS-9 or PAYOS-10 names a closed link: the paid report goes out and the link stays as it was.
                "paylink.paid_after_close": { cases: ["PAYOS-3"] },
                "paylink.short_or_over": { na: "payOS pays a link exactly, so no link is paid with another amount than asked" },
            },
        },
        {
            role: "act",
            operation: "create",
            covers: {
                "act.final": { na: "no tool declares a final refusal for a payOS link create (the only refusal is a duplicate order code, PAYOS-2, a stop a person can resolve)" },
                "act.unknown_applied": { cases: ["PAYOS-19"] },
                "act.confirm_read": { cases: ["PAYOS-4"] },
                "act.replay": { na: "payOS honours no idempotency key: a create with an order code already used is REFUSED (PAYOS-2), never answered with the first result" },
                "act.partial": { na: "a create makes one link: it has no parts" },
            },
        },
        {
            role: "act",
            operation: "cancel",
            covers: {
                "act.final": { na: "no tool declares a final refusal for a payOS link cancel" },
                "act.unknown_applied": { cases: ["PAYOS-20"] },
                "act.confirm_read": { cases: ["PAYOS-4"] },
                "act.replay": { na: "payOS honours no idempotency key: cancelling a link already cancelled is REFUSED (PAYOS-7), never answered with the first result" },
                "act.partial": { na: "a cancel changes one link: it has no parts" },
            },
        },
        {
            role: "read",
            operation: "get",
            covers: {
                "read.not_found": { cases: ["PAYOS-6"] },
                "read.page": { na: "a get answers one link: it has no pages and no limit" },
            },
        },
    ],
}
