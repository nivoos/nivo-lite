import type { SandboxCase, SandboxCatalogue, SandboxOutcome } from "@modules/domain/provider-sandbox"
import { INET_PROVIDER } from "./inet-connection-fields.policy"

/**
 * THE FIXED DAY of the iNET sandbox catalogue (ruling R60: the same answer on every machine and every day, no clock): every expiry below
 * is written from it (`a.vn` is 30 days after it).
 */
export const INET_SANDBOX_CATALOGUE_DATE = "2026-11-14"

/** The fixed price of one year of renewal at the sandbox iNET (VND): a receipt's total is the years times this. */
export const INET_SANDBOX_RENEWAL_PRICE = 480_000

/** The operation the renewal cases answer in the sandbox call log and in the account's next-case selector. */
export const INET_RENEW_OPERATION = "renew"

/** One domain the sandbox account holds: fixed data `find`, `details` and `list` answer from (no case is tied to a domain). */
export interface InetSandboxDomain {
    /** The domain name (lower case). */
    readonly name: string
    /** iNET's own id of the domain (`providerId`). */
    readonly id: string
    /** The expiry before any renewal (`YYYY-MM-DD`), written from `INET_SANDBOX_CATALOGUE_DATE`. */
    readonly expiresOn: string
}

/** The domains the sandbox account holds, in catalogue order (the order `list` pages). */
export const INET_SANDBOX_DOMAINS: ReadonlyArray<InetSandboxDomain> = [
    { name: "a.vn", id: "710001", expiresOn: "2026-12-14" },
    { name: "a2.vn", id: "710002", expiresOn: "2026-11-24" },
    { name: "c.vn", id: "710003", expiresOn: "2026-11-17" },
    { name: "far.vn", id: "710004", expiresOn: "2026-12-15" },
]

/** The nameservers every catalogue domain holds. */
export const INET_SANDBOX_NAMESERVERS: ReadonlyArray<string> = ["ns1.inet.vn", "ns2.inet.vn"]

/** The catalogue domain of a name (case-insensitive), or null. */
export const inetSandboxDomainOf = (name: string): InetSandboxDomain | null =>
    INET_SANDBOX_DOMAINS.find((domain) => domain.name === name.trim().toLowerCase()) ?? null

/** The ids of the renewal cases the implementation answers (the same ids as in `INET_SANDBOX_CASES`). */
export const INET_CASE = {
    renewed: "INET-1",
    insufficientBalance: "INET-2",
    pending: "INET-3",
    locked: "INET-4",
    alreadyRenewed: "INET-5",
    appliedTimedOut: "INET-6",
    flaky: "INET-7",
    unreachable: "INET-8",
    auth: "INET-9",
    rate: "INET-10",
    portal: "INET-11",
    notFound: "INET-12",
} as const

/**
 * What a case DOES, by effect (the service reads it by the case id the account's selector names): `ok` the answer the live adapter
 * gives; `empty` a find that answers null whatever the name; `not_found` the refusal `not_found`; `auth` iNET refuses the key at its gateway
 * (401, not sent); `rate` iNET asks to slow down (429, not sent); `server` a 5xx (unknown); `timeout` no answer and nothing applied
 * (unknown); `applied_timeout` the write is applied, then no answer (unknown); `refused` the typed refusal of the operation (a charged
 * order: `insufficient_balance`; a record write: `rejected`, iNET's 400); `final` the 409 `already_exists` the tool declares final.
 */
export type InetCaseEffect = "ok" | "empty" | "not_found" | "auth" | "rate" | "server" | "timeout" | "applied_timeout" | "refused" | "final"

/** One step of an operation's ladder: what it does, the generic outcome it is a NAME for, and what it proves. */
interface InetStep {
    readonly effect: InetCaseEffect
    readonly outcome: SandboxOutcome
    readonly label: string
}

/** The ladder of one operation: its port method, the word of its case ids (`INET-<WORD>-<n>`), and its steps (the first is the default). */
interface InetLadder {
    readonly operation: string
    readonly word: string
    readonly steps: ReadonlyArray<InetStep>
}

const ok = (label: string): InetStep => ({ effect: "ok", outcome: "ok", label })
const refused = (label: string): InetStep => ({ effect: "refused", outcome: "refused", label })
const appliedTimeout = (what: string): InetStep => ({
    effect: "applied_timeout",
    outcome: "timeout",
    label: `${what} is applied and then no answer comes (INET_UNREACHABLE): the outcome is unknown, a read shows it done`,
})
const AUTH: InetStep = { effect: "auth", outcome: "refused", label: "iNET refuses the key at the gateway (401, INET_AUTH_FAILED): nothing was sent" }
const RATE: InetStep = { effect: "rate", outcome: "transient", label: "iNET asks to slow down (429, INET_RATE_LIMITED, retry after 30 seconds): nothing was sent" }
const TIMEOUT: InetStep = { effect: "timeout", outcome: "timeout", label: "No answer (INET_UNREACHABLE): the outcome is unknown and nothing was applied" }
const NOT_FOUND: InetStep = { effect: "not_found", outcome: "refused", label: "The account does not hold the domain: refused not_found" }

/**
 * The ladders of every registrar operation but the renewal (shapes and words: `inet-domain-registrar.service.ts` and
 * `integrations/inet/inet.client.ts`, which classifies by status: 401/403 the key, 409 exists, 429 slow down, 400 refused as asked, 5xx and
 * unreadable not known). Case ids are `INET-<WORD>-<n>`, n from 1 in the order below; one id is never renumbered or reused. The first step
 * is the operation's default; of each outcome the FIRST step is the one the outcome picker takes (a step that applies nothing comes first).
 */
const LADDERS: ReadonlyArray<InetLadder> = [
    { operation: "availability", word: "AVAILABILITY", steps: [ok("A name is looked up: available unless the catalogue holds it"), AUTH, RATE, TIMEOUT] },
    {
        operation: "find",
        word: "FIND",
        steps: [
            ok("A name is looked up among the held domains: the catalogue domain with its expiry, null for a name the catalogue does not hold"),
            AUTH,
            RATE,
            TIMEOUT,
            { effect: "empty", outcome: "ok", label: "The account holds no domain by that name: find answers null whatever the name" },
        ],
    },
    { operation: "details", word: "DETAILS", steps: [ok("The record of a held domain; a name the catalogue does not hold is refused not_found"), AUTH, RATE, TIMEOUT, NOT_FOUND] },
    {
        operation: "list",
        word: "LIST",
        steps: [ok("A page of the held domains (the request's page and pageSize decide the page; four domains, so pageSize 2 gives two pages)"), AUTH, RATE, TIMEOUT],
    },
    {
        operation: "register",
        word: "REGISTER",
        steps: [
            ok("The domain is registered (reseller account, contacts and nameservers given): an order SBX-INET-<n> is answered and the account then holds the name"),
            refused("The registration is refused for the reseller balance (the typed refusal insufficient_balance): nothing ordered"),
            RATE,
            TIMEOUT,
            appliedTimeout("The registration"),
            { effect: "final", outcome: "final", label: "The name already exists at the registry (409, already_exists): nobody can register it through this tool" },
        ],
    },
    {
        operation: "transfer",
        word: "TRANSFER",
        steps: [
            ok("The transfer of a name into the account is accepted: an order SBX-INET-<n> is answered and the account then holds the name"),
            refused("The transfer is refused for the reseller balance (the typed refusal insufficient_balance): nothing ordered"),
            RATE,
            TIMEOUT,
            appliedTimeout("The transfer"),
        ],
    },
    {
        operation: "dnsRecords",
        word: "DNSRECORDS",
        steps: [ok("The DNS records of a held domain (portal: parsed; reseller: iNET's undocumented answer as it came)"), AUTH, RATE, TIMEOUT, NOT_FOUND],
    },
    {
        operation: "createDnsRecord",
        word: "DNS-CREATE",
        steps: [ok("A DNS record is added to a held domain and the records then hold it"), refused("iNET refuses the record as asked (400, INET_REJECTED): nothing added"), RATE, TIMEOUT, appliedTimeout("The record")],
    },
    {
        operation: "updateDnsRecord",
        word: "DNS-UPDATE",
        steps: [
            ok("A DNS record of a held domain is replaced (the delete of the old record and the add of the new one) and the records then hold it"),
            refused("iNET refuses the record as asked (400, INET_REJECTED): nothing changed"),
            RATE,
            TIMEOUT,
            appliedTimeout("The change"),
        ],
    },
    {
        operation: "deleteDnsRecord",
        word: "DNS-DELETE",
        steps: [
            ok("A DNS record of a held domain is removed and the records then lack it; an id the domain has no record of is refused not_found"),
            refused("iNET refuses the removal as asked (400, INET_REJECTED): nothing removed"),
            RATE,
            TIMEOUT,
            appliedTimeout("The removal"),
        ],
    },
    {
        operation: "updateNameservers",
        word: "NAMESERVERS",
        steps: [ok("The nameservers of a held domain are replaced and a read then shows them"), refused("iNET refuses the nameservers as asked (400, INET_REJECTED): nothing changed"), RATE, TIMEOUT, appliedTimeout("The nameserver change")],
    },
]

/** The case id of step `n` (from 1) of a ladder. */
const idOf = (ladder: InetLadder, n: number): string => `INET-${ladder.word}-${String(n)}`

/** What each case that is a plain effect does, by case id: the ladders' cases and the renewal's own failing cases. */
export const INET_CASE_EFFECT: ReadonlyMap<string, InetCaseEffect> = new Map<string, InetCaseEffect>([
    [INET_CASE.appliedTimedOut, "applied_timeout"],
    [INET_CASE.flaky, "server"],
    [INET_CASE.unreachable, "timeout"],
    [INET_CASE.auth, "auth"],
    [INET_CASE.rate, "rate"],
    ...LADDERS.flatMap((ladder) => ladder.steps.map((step, index): [string, InetCaseEffect] => [idOf(ladder, index + 1), step.effect])),
])

/** The case id of an operation's effect (`INET_OPERATION_CASE.register.final`), for the coverage declaration and the specs. */
export const INET_OPERATION_CASE: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.fromEntries(
    LADDERS.map((ladder) => [ladder.operation, Object.fromEntries(ladder.steps.map((step, index) => [step.effect, idOf(ladder, index + 1)]))]),
)

/**
 * The outbound cases of the iNET renewal (R62: the account's NEXT CASE picks one, sticky; `INET-1` answers while nothing is picked), each
 * tagged with the generic outcome it is a name for. Of a tag the FIRST case is the one the outcome picker takes, so the cases that apply
 * nothing and prove `not_sent` come before the applied one. The request never picks a case: every case answers any domain name.
 */
const RENEW_CASES: ReadonlyArray<SandboxCase> = [
    {
        id: INET_CASE.renewed,
        label: "The domain renews: the expiry moves by the years, an order SBX-INET-<n> (running per account) is answered",
        operation: INET_RENEW_OPERATION,
        outcome: "ok",
        default: true,
    },
    {
        id: INET_CASE.insufficientBalance,
        label: "The renew is refused for the reseller balance (the typed refusal insufficient_balance): nothing moves",
        operation: INET_RENEW_OPERATION,
        outcome: "refused",
    },
    {
        id: INET_CASE.pending,
        label: "The renew is accepted but not finished (order answered, no new expiry yet): the first read after it (the renewal's own proof read) still shows the old expiry, the SECOND read of the domain finds it renewed",
        operation: INET_RENEW_OPERATION,
        outcome: "ok",
    },
    {
        id: INET_CASE.locked,
        label: "The renew is refused because the domain is locked (the typed refusal domain_locked)",
        operation: INET_RENEW_OPERATION,
        outcome: "refused",
    },
    {
        id: INET_CASE.alreadyRenewed,
        label: "The renew is refused because it was already renewed at iNET (409, already_exists)",
        operation: INET_RENEW_OPERATION,
        outcome: "refused",
    },
    {
        id: INET_CASE.rate,
        label: "The renew is refused for the rate (429): nothing was sent, retry after 30 seconds",
        operation: INET_RENEW_OPERATION,
        outcome: "transient",
    },
    {
        id: INET_CASE.flaky,
        label: "The renew fails with a server error (5xx): nothing applied, the outcome is unknown",
        operation: INET_RENEW_OPERATION,
        outcome: "transient",
    },
    {
        id: INET_CASE.unreachable,
        label: "The renew times out and nothing is applied: unknown outcome, a read shows the old expiry",
        operation: INET_RENEW_OPERATION,
        outcome: "timeout",
    },
    {
        id: INET_CASE.appliedTimedOut,
        label: "The renew is applied (the expiry moves) and then times out: unknown outcome, a read shows the new expiry",
        operation: INET_RENEW_OPERATION,
        outcome: "timeout",
    },
    {
        id: INET_CASE.auth,
        label: "The renew is refused for the key at the gateway (401): nothing was sent",
        operation: INET_RENEW_OPERATION,
        outcome: "refused",
    },
    {
        id: INET_CASE.portal,
        label: "The account is of the portal family (api_context not reseller): the renew is refused not_available (portal renewal undocumented)",
        operation: INET_RENEW_OPERATION,
        outcome: "refused",
    },
    {
        id: INET_CASE.notFound,
        label: "The domain is not held by the account: the renew is refused not_found",
        operation: INET_RENEW_OPERATION,
        outcome: "refused",
    },
]

/** Every outbound case of the iNET registrar: the renewal's, then each other operation's ladder. */
export const INET_SANDBOX_CASES: ReadonlyArray<SandboxCase> = [
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

/** The hardcoded catalogue of the iNET sandbox (R60, R62), registered at boot beside its implementation. */
export const INET_SANDBOX_CATALOGUE: SandboxCatalogue = {
    provider: INET_PROVIDER,
    cases: INET_SANDBOX_CASES,
}
