import type { SandboxCover, SandboxCoverage, SandboxRoleCoverage } from "@modules/domain/provider-sandbox/sandbox-situations"
import { TINO_CASE, TINO_OPERATION_CASE } from "./tino-sandbox.catalogue"

/**
 * What Tino's NIVO Sandbox covers of the standard (provider-sandbox rule 18). Tino plays the REGISTRAR port (`DomainRegistrarPort`), which
 * the domain tools (`nivo.tool.domain.*`) use: seven WRITES (register, renew, transfer, three DNS record writes, the nameserver write) and five
 * READS (availability, find, details, list, the DNS records), plus the CONNECTION (a personal API token). It delivers nothing (no webhook, no
 * poll), moves no money in and issues no pay link: those roles do not apply. The words of every refusal come from
 * `tino-domain-registrar.service.ts` (`tinoFailureOf`) and `integrations/tino/tino.client.ts` (401 `invalid_token` / 403 the gateway refuses
 * the token; a route's business refusal is HTTP 200 with an `error` array, typed Rejected with the route's code; 5xx and unreadable not
 * known); Tino publishes no 429 and no 409. The tools' declarations: `tool-specs/tool-specs.policy.ts` (registration `finalRefusals:
 * already_exists`; renewal `confirmBy` the renewal check; no other registrar tool declares either).
 */

/** The case id an operation's effect names (the ladders are generated in the catalogue; a missing id is a wiring error and fails at load). */
const caseOf = (operation: string, effect: string): string => {
    const id = TINO_OPERATION_CASE[operation]?.[effect]
    if (id === undefined) throw new Error(`Tino sandbox: operation ${operation} has no ${effect} case`)
    return id
}

const NO_IDEMPOTENCY =
    "Tino documents no idempotency key and the live client sends none (tino.client.ts builds the method, url, headers and body only), so a repeat is a second act at Tino; the engine's ledger proves the tool's `repeatable`"
const NO_CONFIRM =
    "the tool declares no `confirmBy` (tool-specs.policy.ts): after an unknown outcome the run stops for a person, no read is made on the engine's behalf"
const ONE_ANSWER = "Tino answers one result for one call and documents no per-item answer; NIVO sends one record or nameserver operation per call, so a partly done batch cannot exist"
const NO_FINAL = "no tool declares a final refusal for this operation (only registration declares `already_exists`): its refusals are failed acts a person can resolve"

/** The `act` coverage of one write operation: the situations that are not outcomes of the frame. */
const write = (operation: string, extra: { readonly unknownApplied: string; readonly confirmRead?: ReadonlyArray<string>; readonly noFinal?: string }): SandboxRoleCoverage => ({
    role: "act",
    operation,
    covers: {
        "act.final": { na: extra.noFinal ?? NO_FINAL },
        "act.unknown_applied": { cases: [extra.unknownApplied] },
        "act.confirm_read": extra.confirmRead === undefined ? { na: NO_CONFIRM } : { cases: extra.confirmRead },
        "act.replay": { na: NO_IDEMPOTENCY },
        "act.partial": { na: ONE_ANSWER },
    },
})

/** The `read` coverage of one read operation. */
const read = (operation: string, notFound: SandboxCover, page: SandboxCover): SandboxRoleCoverage => ({
    role: "read",
    operation,
    covers: { "read.not_found": notFound, "read.page": page },
})

const AUTH_CASES: ReadonlyArray<string> = [
    TINO_CASE.auth,
    ...["availability", "find", "details", "list", "dnsRecords"].map((operation) => caseOf(operation, "auth")),
]

export const TINO_SANDBOX_COVERAGE: SandboxCoverage = {
    provider: "tino",
    roles: [
        write("register", { unknownApplied: caseOf("register", "applied_timeout"), noFinal: "Tino answers no 409: a name already taken is refused `rejected` (\"not free\"), which the registration tool does not declare final (only `already_exists` is), so it is a failed act a person resolves" }),
        write("renew", {
            unknownApplied: TINO_CASE.appliedTimedOut,
            // done (TINO-6 applied, a read shows the new expiry), not done (TINO-8 nothing applied, a read shows the old one), and finished later (TINO-3).
            confirmRead: [TINO_CASE.appliedTimedOut, TINO_CASE.unreachable, TINO_CASE.pending],
        }),
        write("transfer", { unknownApplied: caseOf("transfer", "applied_timeout") }),
        write("createDnsRecord", { unknownApplied: caseOf("createDnsRecord", "applied_timeout") }),
        write("updateDnsRecord", { unknownApplied: caseOf("updateDnsRecord", "applied_timeout") }),
        write("deleteDnsRecord", { unknownApplied: caseOf("deleteDnsRecord", "applied_timeout") }),
        write("updateNameservers", { unknownApplied: caseOf("updateNameservers", "applied_timeout") }),
        read(
            "availability",
            { na: "a name's availability is the answer itself: a name nobody holds is `available: true`, Tino's lookup has no 'not found' for it" },
            { na: "one name is asked and one answer comes: the answer has no pages" },
        ),
        read(
            "find",
            { cases: [caseOf("find", "empty")] },
            { na: "find looks up one name (the list filtered by the exact name, one row expected, LOOKUP_PAGE_SIZE 20): it never pages" },
        ),
        read("details", { cases: [caseOf("details", "not_found")] }, { na: "the detail of one domain is one answer: it has no pages" }),
        read(
            "list",
            { na: "a list of the account's domains with none held answers an empty page, never a 'not found'" },
            { cases: [caseOf("list", "ok")] },
        ),
        read("dnsRecords", { cases: [caseOf("dnsRecords", "not_found")] }, { na: "the records of one domain come as one answer (Tino publishes no example answer for it: it rides as it came, `undocumented`)" }),
        {
            role: "connection",
            covers: {
                // TinoErrorCode.AuthFailed: the gateway refuses the token (401 invalid_token; 403 insufficient_scope, ip_not_allowed): the only answer for a token it does not accept, revoked included.
                "connection.credential_refused": { cases: AUTH_CASES },
                "connection.revoked": { cases: AUTH_CASES },
                "connection.refresh": {
                    na: "a Tino account is a personal API token (tinopat_...) the owner creates and pastes (the sealed API token): there is no token a refresh would renew, so no refresh can be refused or busy",
                },
            },
        },
    ],
}
