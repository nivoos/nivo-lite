import type { SandboxOutcome } from "./provider-sandbox.contracts"

/*
 * THE SANDBOX STANDARD (owner order 2026-11-15 "bổ sung sandbox để vét cạn mọi case"; lane concept provider-sandbox rule 18): the CLOSED
 * list of situations every provider's NIVO Sandbox must offer, by the ROLE the provider plays for the engine, in engine words only. A
 * provider declares its roles and, for each situation of a role, the case ids that make it, or `na` with the reason it cannot happen at
 * that provider. Situations the FRAME makes for every case (a delivery mode) are not declared; situations named by an outbound OUTCOME are
 * covered by a case of the operation tagged with it (`SandboxCase.outcome`). The gate
 * (`provider-registry/provider-sandbox-situations.spec.ts`) walks every provider kind and fails on a provider with no coverage, a
 * situation with neither a case nor a reason, a case id the catalogue does not hold, or an operation of the catalogue no role names.
 */

/** The roles a provider plays for the engine. One provider may play several (a bank: `inbound` + `money`; payOS: `act` + `paylink`). */
export type SandboxRole = "inbound" | "money" | "paylink" | "act" | "read" | "pull" | "job" | "connection" | "model"

/**
 * Where a situation comes from:
 * - `declared`: the provider names its case ids, or `na` with a reason;
 * - `frame`: the frame makes it for every inbound case of the provider (a delivery mode); nothing to declare;
 * - `polled`: the frame's `withheld` mode, which needs an inbound case the provider's own poll reads back (`polled: true`); with none the
 *   provider declares `na` (its trigger has no poll);
 * - `outcome`: a case of the role's operation tagged with that outcome; with none the provider declares `na`.
 */
export type SandboxSituationSource =
    | { readonly from: "declared" }
    | { readonly from: "frame"; readonly mode: "twice" | "late" }
    | { readonly from: "polled" }
    | { readonly from: "outcome"; readonly outcome: SandboxOutcome }

/** One situation of the standard: its id `<role>.<name>`, what it is in engine words, and where it comes from. */
export interface SandboxSituation {
    readonly id: string
    readonly about: string
    readonly source: SandboxSituationSource
}

const declared = (id: string, about: string): SandboxSituation => ({ id, about, source: { from: "declared" } })
const frame = (id: string, mode: "twice" | "late", about: string): SandboxSituation => ({ id, about, source: { from: "frame", mode } })
const outcome = (id: string, of: SandboxOutcome, about: string): SandboxSituation => ({ id, about, source: { from: "outcome", outcome: of } })

/**
 * The roles whose coverage is per OPERATION of the provider's port (one entry per operation; the model's one operation is `call`, every
 * model call of a workspace). A long job's START operation is named twice: `job` (its life) and `act` (what the start call comes to).
 */
export const PER_OPERATION_ROLES: ReadonlySet<SandboxRole> = new Set<SandboxRole>(["act", "read", "pull", "job", "model"])

/** THE CLOSED LIST, by role. A new situation is added here (and to the concept) and every provider of the role then owes it. */
export const SANDBOX_SITUATIONS: Readonly<Record<SandboxRole, ReadonlyArray<SandboxSituation>>> = {
    inbound: [
        declared("inbound.unknown_sender", "an event from a sender NIVO holds no contact or identity for (a first contact)"),
        declared("inbound.not_a_line", "an event the door accepts that carries no customer line or record change (follow, unfollow, read receipt, delivery report, a test ping)"),
        declared("inbound.malformed", "a body the provider's door refuses with its typed refusal before anything is kept"),
        frame("inbound.duplicate", "twice", "the same event delivered two times: the door keeps it once"),
        frame("inbound.late", "late", "an event that happened long before it arrives (its own time is old)"),
        frame("inbound.out_of_order", "late", "an older event arriving after a newer one of the same subject"),
        { id: "inbound.withheld", about: "the webhook never comes; only the provider's poll finds the event", source: { from: "polled" } },
    ],
    money: [
        declared("money.exact", "money in with the reference and the exact amount asked"),
        declared("money.short", "money in with the reference, less than asked"),
        declared("money.over", "money in with the reference, more than asked"),
        declared("money.no_reference", "money in with no reference at all"),
        declared("money.stranger_reference", "money in whose reference names nothing that was asked"),
        declared("money.out", "money going out of the account (a debit, a reversal, a refund)"),
        frame("money.duplicate", "twice", "the same movement delivered two times"),
        frame("money.late", "late", "a movement that arrives long after it happened (after the wait for it expired)"),
    ],
    paylink: [
        declared("paylink.paid", "the provider reports a link paid"),
        declared("paylink.expired", "a link that expires unpaid"),
        declared("paylink.cancelled", "a link cancelled (by the payer, or by a cancel call), then read back as cancelled"),
        frame("paylink.paid_twice", "twice", "the paid report delivered two times"),
        declared("paylink.paid_unknown", "a paid report for a link the account never created"),
        declared("paylink.paid_after_close", "a paid report for a link already cancelled or expired"),
        declared("paylink.short_or_over", "a link paid with another amount than asked"),
    ],
    act: [
        outcome("act.ok", "ok", "the act is done (the operation's default case)"),
        outcome("act.refused", "refused", "a typed PERMANENT refusal: nothing done, a person must act"),
        outcome("act.final", "final", "a refusal the tool declares FINAL: nobody can make the act happen through this tool (a business answer)"),
        outcome("act.transient", "transient", "\"not now\" (5xx, 429, quota): nothing done, a retry may pass"),
        outcome("act.timeout", "timeout", "no answer: the outcome is UNKNOWN and nothing was applied"),
        declared("act.unknown_applied", "no answer, but the act WAS applied: the confirm read finds it done"),
        declared("act.confirm_read", "the read a `confirmBy` tool makes after an unknown outcome answers the truth (done, or not done)"),
        declared("act.replay", "the same act made again under the same idempotency key answers the first result (the provider honours the key)"),
        declared("act.partial", "a batch act where some parts are done and some are not"),
    ],
    read: [
        outcome("read.ok", "ok", "the read answers (the operation's default case)"),
        declared("read.not_found", "the thing read does not exist at the provider"),
        outcome("read.refused", "refused", "the read is refused permanently (no access, credential refused)"),
        outcome("read.transient", "transient", "the read fails \"not now\" (5xx, 429)"),
        outcome("read.timeout", "timeout", "the read never answers"),
        declared("read.page", "the answer is cut or paged: more than one page, or a limit reached"),
    ],
    pull: [
        declared("pull.first", "the first pull of a source (no cursor yet)"),
        declared("pull.new", "a pull after the cursor that brings only what is new"),
        declared("pull.changed", "a pull that brings again a thing already brought, changed"),
        declared("pull.page", "more than one pull's worth waiting: the pull takes its cap and says more is left"),
        declared("pull.partial", "some parts of the source refuse while others are brought"),
        outcome("pull.refused", "refused", "the pull is refused permanently (login, session, grant)"),
        outcome("pull.transient", "transient", "the source does not answer now"),
    ],
    job: [
        declared("job.done", "a long job accepted at start, seen progressing, then done with its result"),
        declared("job.failed", "a long job accepted, then failed with the provider's reason"),
        declared("job.never_finishes", "a long job accepted whose reads never reach an end"),
        declared("job.callback_done", "the provider's callback reports the job done"),
        declared("job.callback_failed", "the provider's callback reports the job failed"),
        declared("job.callback_lost", "the callback never comes; the status read finds the end"),
        declared("job.unknown_job", "a read of a job the account never started"),
    ],
    connection: [
        declared("connection.credential_refused", "the provider refuses the account's credential mid-run (expired, wrong)"),
        declared("connection.revoked", "the access was revoked at the provider: every call is refused until the owner connects again"),
        declared("connection.refresh", "the token refresh is refused or busy (another worker refreshes)"),
    ],
    model: [
        declared("model.answer", "a deterministic answer in the asked shape, with no real endpoint"),
        declared("model.tool_call", "a deterministic tool call, with no real endpoint"),
        declared("model.refusal", "the model refuses (no text)"),
        declared("model.malformed", "prose where a structured answer is asked"),
        declared("model.too_long", "the request is refused as longer than the context"),
        declared("model.rate_limited", "the provider answers its rate limit (429)"),
        declared("model.timeout", "no answer before the deadline"),
        declared("model.unavailable", "the provider fails (5xx)"),
        declared("model.cut", "the answer is cut at the token limit"),
        declared("model.cannot", "the model says it cannot decide, in the node's own protocol"),
    ],
}

/** How a provider covers one declared situation: the case ids that make it, or why it cannot happen at this provider. */
export type SandboxCover = { readonly cases: ReadonlyArray<string> } | { readonly na: string }

/** A provider's coverage of one role (of one operation, for the per-operation roles). */
export interface SandboxRoleCoverage {
    readonly role: SandboxRole
    /** The port operation (as the catalogue's cases name it), for `act`, `read`, `pull` and `job`. */
    readonly operation?: string | undefined
    /**
     * `inbound` only (a pulled source too: its events are the cases of its `pull` operations): every shape the provider's translate accepts (a text line, a picture, a file, a voice note, a follow event...), named
     * from the provider's own translate, with the inbound cases that send it; a shape with no case is `[]` and fails the gate until built.
     */
    readonly shapes?: Readonly<Record<string, ReadonlyArray<string>>> | undefined
    /** The declared situations of the role, and the `na` of a `polled` / `outcome` situation the provider cannot offer. */
    readonly covers: Readonly<Record<string, SandboxCover>>
}

/** A provider's whole coverage (exported as `<PROVIDER>_SANDBOX_COVERAGE` from `<provider>-sandbox.coverage.ts`). */
export interface SandboxCoverage {
    readonly provider: string
    readonly roles: ReadonlyArray<SandboxRoleCoverage>
}

/** The smallest reason the gate takes for an `na` (a reason is a sentence, not a word). */
export const SANDBOX_NA_MIN_LENGTH = 20
