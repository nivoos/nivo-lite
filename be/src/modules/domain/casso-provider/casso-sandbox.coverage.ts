import type { SandboxCoverage } from "@modules/domain/provider-sandbox/sandbox-situations"

/**
 * What Casso's NIVO Sandbox covers of the standard (provider-sandbox rule 18). Casso is a BANK FEED received by its WEBHOOK only: it plays
 * the `inbound` role (the delivery of a movement) and the `money` role (the movement is money in or out of the bank account). NIVO makes no
 * call to Casso (it holds no Casso API key: the connection keeps the integration's secure key, which proves the webhook, not a read), so
 * there is no act, read, pull, job or connection role. Shapes come from the door's own reading (`billing/casso.policy.ts`
 * `cassoCredits` / `isCassoError`, `billing/webhook-body.policy.ts` `parseJsonObject`) and the V2 body the catalogue builds. The twin of
 * SePay's feed: the SAME seven meanings (CASSO-1..7 / SEPAY-1..7); SePay's folder belongs to another worker and is not touched here.
 */
export const CASSO_SANDBOX_COVERAGE: SandboxCoverage = {
    provider: "casso",
    roles: [
        {
            role: "inbound",
            shapes: {
                // Webhook V2: `data` is ONE object (reference, accountNumber, transactionDateTime).
                v2Transaction: ["CASSO-1", "CASSO-2", "CASSO-3", "CASSO-4", "CASSO-5", "CASSO-6", "CASSO-7"],
                // Webhook V1: `data` is an ARRAY of rows (tid, bank_sub_acc_id, when).
                v1Transactions: ["CASSO-11"],
                // An `error` other than 0 (isCassoError): acknowledged and ignored.
                errorNotice: ["CASSO-8"],
            },
            covers: {
                // A bank delivery carries the payer only as a counter account (empty in the sandbox) and the transfer content: with no content, or a content
                // naming nothing asked, nobody NIVO holds a contact for can be told from it.
                "inbound.unknown_sender": { cases: ["CASSO-4", "CASSO-7"] },
                "inbound.not_a_line": { cases: ["CASSO-8", "CASSO-10"] },
                "inbound.malformed": { cases: ["CASSO-9"] },
                "inbound.withheld": {
                    na: "Casso's trigger is `via: [webhook]` and declares `withoutPoll` (CASSO_WITHOUT_POLL, bank-transaction.words.ts): Casso re-sends a failed webhook itself (first retry after 1 minute, Fibonacci, up to 17 attempts) and NIVO holds no Casso API key to read a list, so there is no poll that could find a withheld event",
                },
            },
        },
        {
            role: "money",
            covers: {
                "money.exact": { cases: ["CASSO-1"] },
                "money.short": { cases: ["CASSO-2"] },
                "money.over": { cases: ["CASSO-3"] },
                "money.no_reference": { cases: ["CASSO-4"] },
                "money.stranger_reference": { cases: ["CASSO-7"] },
                "money.out": { cases: ["CASSO-5"] },
            },
        },
    ],
}
