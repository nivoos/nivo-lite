import type { DomainPeriodPrice } from "@modules/domain/provider-registry"
import type { SandboxCase, SandboxCatalogue, SandboxOutcome } from "@modules/domain/provider-sandbox"
import { TINO_PROVIDER } from "./tino-connection-fields.policy"

/**
 * THE FIXED DAY of the Tino sandbox catalogue (ruling R60: the same answer on every machine and every day, no clock): every expiry below
 * is written from it (`d.vn` is 30 days after it).
 */
export const TINO_SANDBOX_CATALOGUE_DATE = "2026-11-14"

/** The fixed price of one year of renewal at the sandbox Tino (VND): a receipt's total is the years times this. */
export const TINO_SANDBOX_RENEWAL_PRICE = 450_000

/** The prices a lookup quotes (Tino states them per period in its lookup answer). */
export const TINO_SANDBOX_PERIODS: ReadonlyArray<DomainPeriodPrice> = [
    { years: 1, register: 350_000, renew: TINO_SANDBOX_RENEWAL_PRICE, transfer: 350_000 },
    { years: 2, register: 700_000, renew: 2 * TINO_SANDBOX_RENEWAL_PRICE, transfer: 700_000 },
]

/** The operation the renewal cases answer in the sandbox call log and in the account's next-case selector. */
export const TINO_RENEW_OPERATION = "renew"

/** One domain the sandbox account holds: fixed data `find`, `details` and `list` answer from (no case is tied to a domain). */
export interface TinoSandboxDomain {
    /** The domain name (lower case). */
    readonly name: string
    /** Tino's own id of the domain (`providerId`). */
    readonly id: string
    /** The expiry before any renewal (`YYYY-MM-DD`), written from `TINO_SANDBOX_CATALOGUE_DATE`. */
    readonly expiresOn: string
}

/** The domains the sandbox account holds, in catalogue order (the order `list` pages). */
export const TINO_SANDBOX_DOMAINS: ReadonlyArray<TinoSandboxDomain> = [
    { name: "d.vn", id: "820001", expiresOn: "2026-12-14" },
    { name: "b.vn", id: "820002", expiresOn: "2026-11-24" },
    { name: "e.vn", id: "820003", expiresOn: "2026-11-17" },
    { name: "far2.vn", id: "820004", expiresOn: "2026-12-15" },
]

/** The nameservers every catalogue domain holds. */
export const TINO_SANDBOX_NAMESERVERS: ReadonlyArray<string> = ["ns1.tino.vn", "ns2.tino.vn"]

/** The catalogue domain of a name (case-insensitive), or null. */
export const tinoSandboxDomainOf = (name: string): TinoSandboxDomain | null =>
    TINO_SANDBOX_DOMAINS.find((domain) => domain.name === name.trim().toLowerCase()) ?? null

/** The ids of the renewal cases the implementation answers (the same ids as in `TINO_SANDBOX_CASES`). */
export const TINO_CASE = {
    renewed: "TINO-1",
    insufficientBalance: "TINO-2",
    pending: "TINO-3",
    locked: "TINO-4",
    alreadyRenewed: "TINO-5",
    appliedTimedOut: "TINO-6",
    flaky: "TINO-7",
    unreachable: "TINO-8",
    auth: "TINO-9",
    notFound: "TINO-10",
} as const

/**
 * What a case DOES, by effect (the service reads it by the case id the account's selector names): `ok` the answer the live adapter gives;
 * `empty` a find that answers null whatever the name; `not_found` the refusal `rejected` (`domain_not_held`, the sandbox's own word: Tino
 * publishes none); `auth` Tino refuses the token at its gateway (401 `invalid_token`, not sent); `server` a 5xx (unknown); `timeout` no
 * answer and nothing applied (unknown); `applied_timeout` the write is applied, then no answer (unknown); `refused` the route's business
 * refusal of the operation (`rejected` with the route's code).
 */
export type TinoCaseEffect = "ok" | "empty" | "not_found" | "auth" | "server" | "timeout" | "applied_timeout" | "refused"

/** One step of an operation's ladder: what it does, the generic outcome it is a NAME for, and what it proves. */
interface TinoStep {
    readonly effect: TinoCaseEffect
    readonly outcome: SandboxOutcome
    readonly label: string
}

/** The ladder of one operation: its port method, the word of its case ids (`TINO-<WORD>-<n>`), and its steps (the first is the default). */
interface TinoLadder {
    readonly operation: string
    readonly word: string
    readonly steps: ReadonlyArray<TinoStep>
}

const ok = (label: string): TinoStep => ({ effect: "ok", outcome: "ok", label })
const refused = (label: string): TinoStep => ({ effect: "refused", outcome: "refused", label })
const appliedTimeout = (what: string): TinoStep => ({
    effect: "applied_timeout",
    outcome: "timeout",
    label: `${what} is applied and then no answer comes (TINO_UNREACHABLE): the outcome is unknown, a read shows it done`,
})
const AUTH: TinoStep = { effect: "auth", outcome: "refused", label: "Tino refuses the token at the gateway (401 invalid_token, TINO_AUTH_FAILED): nothing was sent" }
const SERVER: TinoStep = { effect: "server", outcome: "transient", label: "Tino answers a server error (5xx, TINO_FAILED): the outcome is unknown; Tino publishes no 429, a 5xx is its only \"not now\"" }
const TIMEOUT: TinoStep = { effect: "timeout", outcome: "timeout", label: "No answer (TINO_UNREACHABLE): the outcome is unknown and nothing was applied" }
const NOT_FOUND: TinoStep = { effect: "not_found", outcome: "refused", label: "The account does not hold the domain: the route's refusal rejected (domain_not_held)" }

/**
 * The ladders of every registrar operation but the renewal (shapes and words: `tino-domain-registrar.service.ts` and
 * `integrations/tino/tino.client.ts`: 401 `invalid_token` / 403 the gateway refuses the token; a route's business refusal is HTTP 200 with
 * an `error` array, typed Rejected with the route's code; 5xx and unreadable not known). Case ids are `TINO-<WORD>-<n>`, n from 1 in the
 * order below; one id is never renumbered or reused. The first step is the operation's default; of each outcome the FIRST step is the one
 * the outcome picker takes (a step that applies nothing comes first).
 */
const LADDERS: ReadonlyArray<TinoLadder> = [
    { operation: "availability", word: "AVAILABILITY", steps: [ok("A name is looked up: available unless the catalogue holds it, with Tino's prices per period"), AUTH, SERVER, TIMEOUT] },
    {
        operation: "find",
        word: "FIND",
        steps: [
            ok("A name is looked up among the held domains: the catalogue domain with its expiry, null for a name the catalogue does not hold"),
            AUTH,
            SERVER,
            TIMEOUT,
            { effect: "empty", outcome: "ok", label: "The account holds no domain by that name: find answers null whatever the name" },
        ],
    },
    { operation: "details", word: "DETAILS", steps: [ok("The record of a held domain; a name the catalogue does not hold is refused rejected (domain_not_held)"), AUTH, SERVER, TIMEOUT, NOT_FOUND] },
    {
        operation: "list",
        word: "LIST",
        steps: [ok("A page of the held domains (the request's page and pageSize decide the page; four domains; Tino states no page total)"), AUTH, SERVER, TIMEOUT],
    },
    {
        operation: "register",
        word: "REGISTER",
        steps: [
            ok("The domain is ordered (no contacts given: Tino takes saved contact ids): the bare accepted order is answered and the account then holds the name"),
            refused("The order is refused as asked (rejected, \"not free\": the name is taken): nothing ordered"),
            SERVER,
            TIMEOUT,
            appliedTimeout("The order"),
        ],
    },
    {
        operation: "transfer",
        word: "TRANSFER",
        steps: [
            ok("The transfer of a name into the account is accepted: the bare accepted order is answered and the account then holds the name"),
            refused("The transfer is refused as asked (rejected, already_in_account): nothing ordered"),
            SERVER,
            TIMEOUT,
            appliedTimeout("The transfer"),
        ],
    },
    { operation: "dnsRecords", word: "DNSRECORDS", steps: [ok("The DNS records of a held domain: Tino's undocumented answer, as it came"), AUTH, SERVER, TIMEOUT, NOT_FOUND] },
    {
        operation: "createDnsRecord",
        word: "DNS-CREATE",
        steps: [ok("A DNS record is added to a held domain (a ttl is refused, as live) and the records then hold it"), refused("The route refuses the record as asked (rejected, record_refused): nothing added"), SERVER, TIMEOUT, appliedTimeout("The record")],
    },
    {
        operation: "updateDnsRecord",
        word: "DNS-UPDATE",
        steps: [
            ok("A DNS record of a held domain is replaced (a ttl is refused, as live) and the records then hold it"),
            refused("The route refuses the record as asked (rejected, record_refused): nothing changed"),
            SERVER,
            TIMEOUT,
            appliedTimeout("The change"),
        ],
    },
    {
        operation: "deleteDnsRecord",
        word: "DNS-DELETE",
        steps: [
            ok("A DNS record of a held domain is removed and the records then lack it; an id the domain has no record of is refused rejected (record_not_found)"),
            refused("The route refuses the removal as asked (rejected, record_refused): nothing removed"),
            SERVER,
            TIMEOUT,
            appliedTimeout("The removal"),
        ],
    },
    {
        operation: "updateNameservers",
        word: "NAMESERVERS",
        steps: [ok("The nameservers of a held domain are replaced and a read then shows them"), refused("The route refuses the nameservers as asked (rejected, record_refused): nothing changed"), SERVER, TIMEOUT, appliedTimeout("The nameserver change")],
    },
]

/** The case id of step `n` (from 1) of a ladder. */
const idOf = (ladder: TinoLadder, n: number): string => `TINO-${ladder.word}-${String(n)}`

/** What each case that is a plain effect does, by case id: the ladders' cases and the renewal's own failing cases. */
export const TINO_CASE_EFFECT: ReadonlyMap<string, TinoCaseEffect> = new Map<string, TinoCaseEffect>([
    [TINO_CASE.appliedTimedOut, "applied_timeout"],
    [TINO_CASE.flaky, "server"],
    [TINO_CASE.unreachable, "timeout"],
    [TINO_CASE.auth, "auth"],
    ...LADDERS.flatMap((ladder) => ladder.steps.map((step, index): [string, TinoCaseEffect] => [idOf(ladder, index + 1), step.effect])),
])

/** The case id of an operation's effect (`TINO_OPERATION_CASE.register.refused`), for the coverage declaration and the specs. */
export const TINO_OPERATION_CASE: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.fromEntries(
    LADDERS.map((ladder) => [ladder.operation, Object.fromEntries(ladder.steps.map((step, index) => [step.effect, idOf(ladder, index + 1)]))]),
)

/**
 * The outbound cases of the Tino renewal (R62: the account's NEXT CASE picks one, sticky; `TINO-1` answers while nothing is picked), each
 * tagged with the generic outcome it is a name for. Of a tag the FIRST case is the one the outcome picker takes, so the case that applies
 * nothing comes before the applied one. The request never picks a case: every case answers any domain name. The business codes
 * (`insufficient_balance`, `domain_locked`, `domain_already_renewed`, `domain_not_held`) are the sandbox's own: Tino publishes none for them.
 */
const RENEW_CASES: ReadonlyArray<SandboxCase> = [
    {
        id: TINO_CASE.renewed,
        label: "The domain renews: the expiry moves by the years, an invoice SBX-TINO-<n> (running per account) is answered",
        operation: TINO_RENEW_OPERATION,
        outcome: "ok",
        default: true,
    },
    {
        id: TINO_CASE.insufficientBalance,
        label: "The renew is refused for the account balance (the typed refusal insufficient_balance): nothing moves",
        operation: TINO_RENEW_OPERATION,
        outcome: "refused",
    },
    {
        id: TINO_CASE.pending,
        label: "The renew is accepted but not finished (an order number, no invoice or new expiry yet): the first read after it (the renewal's own proof read) still shows the old expiry, the SECOND read of the domain finds it renewed",
        operation: TINO_RENEW_OPERATION,
        outcome: "ok",
    },
    {
        id: TINO_CASE.locked,
        label: "The renew is refused because the domain is locked (the typed refusal domain_locked)",
        operation: TINO_RENEW_OPERATION,
        outcome: "refused",
    },
    {
        id: TINO_CASE.alreadyRenewed,
        label: "The renew is refused because it was already renewed at Tino (rejected, domain_already_renewed)",
        operation: TINO_RENEW_OPERATION,
        outcome: "refused",
    },
    {
        id: TINO_CASE.flaky,
        label: "The renew fails with a server error (5xx): nothing applied, the outcome is unknown",
        operation: TINO_RENEW_OPERATION,
        outcome: "transient",
    },
    {
        id: TINO_CASE.unreachable,
        label: "The renew times out and nothing is applied: unknown outcome, a read shows the old expiry",
        operation: TINO_RENEW_OPERATION,
        outcome: "timeout",
    },
    {
        id: TINO_CASE.appliedTimedOut,
        label: "The renew is applied (the expiry moves) and then times out: unknown outcome, a read shows the new expiry",
        operation: TINO_RENEW_OPERATION,
        outcome: "timeout",
    },
    {
        id: TINO_CASE.auth,
        label: "The renew is refused for the token at the gateway (401 invalid_token): nothing was sent",
        operation: TINO_RENEW_OPERATION,
        outcome: "refused",
    },
    {
        id: TINO_CASE.notFound,
        label: "The domain is not held by the account: the renew is refused rejected (domain_not_held)",
        operation: TINO_RENEW_OPERATION,
        outcome: "refused",
    },
]

/** Every outbound case of the Tino registrar: the renewal's, then each other operation's ladder. */
export const TINO_SANDBOX_CASES: ReadonlyArray<SandboxCase> = [
    ...RENEW_CASES,
    ...LADDERS.flatMap((ladder) =>
        ladder.steps.map(
            (step, index): SandboxCase => ({
                id: idOf(ladder, index + 1),
                label: step.label,
                operation: ladder.operation,
                outcome: step.outcome,
                ...(index === 0 ? { default: true as const } : {}),
            }),
        ),
    ),
]

/** The hardcoded catalogue of the Tino sandbox (R60, R62), registered at boot beside its implementation. */
export const TINO_SANDBOX_CATALOGUE: SandboxCatalogue = {
    provider: TINO_PROVIDER,
    cases: TINO_SANDBOX_CASES,
}
