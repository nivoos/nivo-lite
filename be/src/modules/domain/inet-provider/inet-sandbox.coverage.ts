import type { SandboxCover, SandboxCoverage, SandboxRoleCoverage } from "@modules/domain/provider-sandbox/sandbox-situations"
import { INET_CASE, INET_OPERATION_CASE } from "./inet-sandbox.catalogue"

/**
 * What iNET's NIVO Sandbox covers of the standard (provider-sandbox rule 18). iNET plays the REGISTRAR port (`DomainRegistrarPort`), which
 * the domain tools (`nivo.tool.domain.*`) use: seven WRITES (register, renew, transfer, three DNS record writes, the nameserver write) and five
 * READS (availability, find, details, list, the DNS records), plus the CONNECTION (an API key). It delivers nothing (no webhook, no poll),
 * moves no money in and issues no pay link: those roles do not apply. The words of every refusal come from `inet-domain-registrar.service.ts`
 * (`inetFailureOf`) and `integrations/inet/inet.client.ts` (`inetDataOf`: 401/403 the key, 409 exists, 429 slow down, 400 refused as asked,
 * 5xx and unreadable not known); the tools' declarations from `tool-specs/tool-specs.policy.ts` (registration `finalRefusals: already_exists`;
 * renewal `confirmBy` the renewal check; no other registrar tool declares either).
 */

/** The case id an operation's effect names (the ladders are generated in the catalogue; a missing id is a wiring error and fails at load). */
const caseOf = (operation: string, effect: string): string => {
    const id = INET_OPERATION_CASE[operation]?.[effect]
    if (id === undefined) throw new Error(`iNET sandbox: operation ${operation} has no ${effect} case`)
    return id
}

const NO_IDEMPOTENCY =
    "iNET documents no idempotency key and the live client sends none (inet.client.ts builds the method, url, headers and body only), so a repeat is a second act at iNET; the engine's ledger proves the tool's `repeatable`"
const NO_CONFIRM =
    "the tool declares no `confirmBy` (tool-specs.policy.ts): after an unknown outcome the run stops for a person, no read is made on the engine's behalf"
const ONE_ANSWER = "iNET answers one result for one call and documents no per-item answer; NIVO sends one operation per call (the update is the delete item and the add item of ONE call), so a partly done batch cannot be told apart"
const NO_FINAL = "no tool declares a final refusal for this operation (only registration declares `already_exists`): its refusals are failed acts a person can resolve"

/** The `act` coverage of one write operation: the situations that are not outcomes of the frame. */
const write = (operation: string, extra: { readonly unknownApplied: string; readonly confirmRead?: ReadonlyArray<string>; readonly final?: boolean }): SandboxRoleCoverage => ({
    role: "act",
    operation,
    covers: {
        ...(extra.final === true ? {} : { "act.final": { na: NO_FINAL } }),
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
    INET_CASE.auth,
    ...["availability", "find", "details", "list", "dnsRecords"].map((operation) => caseOf(operation, "auth")),
]

export const INET_SANDBOX_COVERAGE: SandboxCoverage = {
    provider: "inet",
    roles: [
        write("register", { unknownApplied: caseOf("register", "applied_timeout"), final: true }),
        write("renew", {
            unknownApplied: INET_CASE.appliedTimedOut,
            // done (INET-6 applied, a read shows the new expiry), not done (INET-8 nothing applied, a read shows the old one), and finished later (INET-3).
            confirmRead: [INET_CASE.appliedTimedOut, INET_CASE.unreachable, INET_CASE.pending],
        }),
        write("transfer", { unknownApplied: caseOf("transfer", "applied_timeout") }),
        write("createDnsRecord", { unknownApplied: caseOf("createDnsRecord", "applied_timeout") }),
        write("updateDnsRecord", { unknownApplied: caseOf("updateDnsRecord", "applied_timeout") }),
        write("deleteDnsRecord", { unknownApplied: caseOf("deleteDnsRecord", "applied_timeout") }),
        write("updateNameservers", { unknownApplied: caseOf("updateNameservers", "applied_timeout") }),
        read(
            "availability",
            { na: "a name's availability is the answer itself: a name nobody holds is `available: true`, iNET has no 'not found' for it" },
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
        read("dnsRecords", { cases: [caseOf("dnsRecords", "not_found")] }, { na: "the records of one domain come as one answer (iNET's record list has no page member NIVO reads)" }),
        {
            role: "connection",
            covers: {
                // INET_ERROR: the API refuses the credential (401 / 403): wrong, expired, revoked, out of scope or from an IP not allowed: one answer for all.
                "connection.credential_refused": { cases: AUTH_CASES },
                "connection.revoked": { cases: AUTH_CASES },
                "connection.refresh": {
                    na: "an iNET account is a static API key the owner pastes (the sealed API token): there is no token a refresh would renew, so no refresh can be refused or busy",
                },
            },
        },
    ],
}
