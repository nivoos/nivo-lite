import type { SandboxCoverage } from "@modules/domain/provider-sandbox/sandbox-situations"

/**
 * What SePay's NIVO Sandbox covers of the standard (provider-sandbox rule 18). Roles: it DELIVERS bank movements (the feed webhook and the
 * transactions list the poll reads: every movement case is `polled`), it moves MONEY in and out, and its payment instruction is a READ
 * that calls nothing (it composes the VietQR address). Delivery modes (twice, late, withheld) are the frame's: SEPAY-6 is SEPAY-1 twice.
 * SEPAY-10 is one bank transfer reported twice under two transaction ids (the same reference code).
 */
export const SEPAY_SANDBOX_COVERAGE: SandboxCoverage = {
    provider: "sepay",
    roles: [
        {
            role: "inbound",
            shapes: { credit: ["SEPAY-1"], debit: ["SEPAY-5"], ping: ["SEPAY-11"] },
            covers: {
                "inbound.unknown_sender": { na: "a bank movement names no person, only a transfer content (SEPAY-7 is a content that names nothing)" },
                "inbound.not_a_line": { cases: ["SEPAY-11"] },
                "inbound.malformed": { cases: ["SEPAY-12"] },
            },
        },
        {
            role: "money",
            covers: {
                "money.exact": { cases: ["SEPAY-1"] },
                "money.short": { cases: ["SEPAY-2"] },
                "money.over": { cases: ["SEPAY-3"] },
                "money.no_reference": { cases: ["SEPAY-4"] },
                "money.stranger_reference": { cases: ["SEPAY-7"] },
                "money.out": { cases: ["SEPAY-5"] },
            },
        },
        {
            role: "read",
            operation: "transfer",
            covers: {
                "read.transient": { na: "the payment instruction calls nothing at SePay (it composes the VietQR address from the connection's own details), so no 5xx or 429 can happen" },
                "read.timeout": { na: "the payment instruction calls nothing at SePay, so no call can go unanswered" },
                "read.not_found": { na: "the payment instruction reads nothing at SePay: there is no thing that could be missing" },
                "read.page": { na: "the payment instruction answers one address: it has no pages and no limit" },
            },
        },
    ],
}
