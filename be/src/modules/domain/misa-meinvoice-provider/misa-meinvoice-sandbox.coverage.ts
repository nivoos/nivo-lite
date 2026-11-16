import type { SandboxCoverage } from "@modules/domain/provider-sandbox/sandbox-situations"
import { MISA_SANDBOX_CASE } from "./misa-meinvoice-sandbox.catalogue"

/**
 * What MISA meInvoice's NIVO Sandbox covers of the standard (provider-sandbox rule 18). MISA plays one role for the engine: the ACT of the
 * e-invoice issue port (`InvoiceIssuePort.issue`, `nivo.tool.invoice.create`), on the CONNECTION of a saved key. It delivers nothing (no
 * webhook, no poll), moves no money and issues no pay link. The live twin has NO operation built (the integration documentation could not be
 * read: `MISA_MEINVOICE_OPERATIONS` is `docs-missing`, the client refuses `not_available` before anything leaves), so every shape below is
 * the generic provider shape of the port (`providerRefusal`, `providerCallFailure`, `IssuedInvoice`); no MISA field is invented.
 */
export const MISA_MEINVOICE_SANDBOX_COVERAGE: SandboxCoverage = {
    provider: "misa_meinvoice",
    roles: [
        {
            role: "act",
            operation: "issue",
            covers: {
                "act.final": {
                    na: "`nivo.tool.invoice.create` declares no finalRefusals (tool-specs.policy.ts): its business refusals rejected and not_found are failed acts a person can resolve, none is a final business answer",
                },
                "act.unknown_applied": { cases: [MISA_SANDBOX_CASE.timeoutApplied] },
                "act.confirm_read": {
                    na: "the tool declares no `confirmBy` and is not repeatable (an unknown outcome may have issued a legal document: tool-specs.policy.ts), so the run stops for a person; MISA's status read (`invoice.status.get`) is docs-missing and the port has no read-back",
                },
                "act.replay": {
                    na: "nothing NIVO documents or sends gives MISA's issue an idempotency key (the live client is docs-missing and sends nothing); the tool is not repeatable, so a repeat is never sent blindly",
                },
                "act.partial": { na: "one issue call makes one invoice: the port has no batch, so no part of an issue can be done while another is not" },
            },
        },
        {
            role: "connection",
            covers: {
                "connection.credential_refused": { cases: [MISA_SANDBOX_CASE.authRefused] },
                // The picked case is sticky and `issue` is the port's only operation: picking MISA-5 refuses every call until another case is picked.
                "connection.revoked": { cases: [MISA_SANDBOX_CASE.authRefused] },
                "connection.refresh": {
                    na: "a MISA account is a saved key (a connectable key in the connector catalogue), not an OAuth grant: NIVO holds no refresh token for it, so no refresh can be refused or busy",
                },
            },
        },
    ],
}
