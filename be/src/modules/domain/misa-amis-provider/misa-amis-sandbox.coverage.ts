import type { SandboxCoverage, SandboxRoleCoverage } from "@modules/domain/provider-sandbox/sandbox-situations"
import { AMIS_SANDBOX_CASE } from "./misa-amis-sandbox.catalogue"

/**
 * What MISA AMIS's NIVO Sandbox covers of the standard (provider-sandbox rule 18). AMIS plays one role for the engine: a LEDGER
 * (`LedgerPort`: `ready`, `append`, `void`, the generic ledger purpose beside the Google sheet), on the CONNECTION of a saved key. It
 * delivers nothing (no webhook, no poll), moves no money and issues no pay link. The live twin has NO operation built (the open API
 * documentation could not be read: `MISA_AMIS_OPERATIONS` is `docs-missing`; `ready` is false and a write refuses `not_available`), so every
 * shape below is the generic port shape (`providerRefusal`, `providerCallFailure`, the ledger connection refusal); no AMIS field is invented.
 */

const NO_FINAL =
    "the ledger tools declare no finalRefusals (tool-specs.policy.ts): their refusals are failed acts a person can resolve, none is a final business answer"
const NO_CONFIRM =
    "the ledger tools declare no `confirmBy` and the port only ever adds (nothing it holds is read back into a decision, LedgerPort): after an unknown outcome the ledger's own once-per-key write decides, no read is made on the engine's behalf"
const NO_IDEMPOTENCY =
    "nothing NIVO documents or sends gives AMIS's voucher an idempotency key (the live client is docs-missing and sends nothing); what stops a repeat is NIVO's own once-per-key ledger write (the dedupe key of `ledger.write`), the engine's ledger"
const NO_PARTIAL = "one ledger call books one entry (one voucher): the port has no batch, so no part of a call can be done while another is not"

/** The `act` coverage of one ledger write. */
const write = (operation: string, unknownApplied: string): SandboxRoleCoverage => ({
    role: "act",
    operation,
    covers: {
        "act.final": { na: NO_FINAL },
        "act.unknown_applied": { cases: [unknownApplied] },
        "act.confirm_read": { na: NO_CONFIRM },
        "act.replay": { na: NO_IDEMPOTENCY },
        "act.partial": { na: NO_PARTIAL },
    },
})

const NO_FAILURE = "`ready` answers a boolean and carries no failure (LedgerPort): the live twin answers it without any call, so nothing can fail or hang"

export const MISA_AMIS_SANDBOX_COVERAGE: SandboxCoverage = {
    provider: "misa_amis",
    roles: [
        write("append", AMIS_SANDBOX_CASE.appendAppliedLost),
        write("void", AMIS_SANDBOX_CASE.voidAppliedLost),
        {
            role: "read",
            operation: "ready",
            covers: {
                "read.refused": { na: NO_FAILURE },
                "read.transient": { na: NO_FAILURE },
                "read.timeout": { na: NO_FAILURE },
                "read.not_found": { na: "`ready` asks about the account itself, never about a thing at AMIS, so nothing can be missing" },
                "read.page": { na: "`ready` is one boolean: it has no pages" },
            },
        },
        {
            role: "connection",
            covers: {
                "connection.credential_refused": { cases: [AMIS_SANDBOX_CASE.appendCredentialRefused, AMIS_SANDBOX_CASE.voidCredentialRefused] },
                "connection.revoked": { cases: [AMIS_SANDBOX_CASE.appendCredentialRefused, AMIS_SANDBOX_CASE.voidCredentialRefused] },
                "connection.refresh": {
                    na: "a MISA account is a saved key (a connectable key in the connector catalogue), not an OAuth grant: NIVO holds no refresh token for it, so no refresh can be refused or busy",
                },
            },
        },
    ],
}
