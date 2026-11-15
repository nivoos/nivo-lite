import type { SandboxCoverage } from "@modules/domain/provider-sandbox/sandbox-situations"
import { OPENAPI_CALL_OPERATION, OPENAPI_SANDBOX_CASE } from "./openapi-sandbox.catalogue"

/**
 * What the OpenAPI provider's NIVO Sandbox covers of the standard (provider-sandbox rule 18). The provider plays ONE port for the engine:
 * a call of an operation of the document a plugin pins (`OpenApiReachPort.call`), reads and writes alike, logged under the operation id and
 * picked by ONE next-case selector (`call`, or one operation by its id as the scope): so its one operation is named once, as an ACT (the
 * reads of the document are the same call; `OPENAPI-1` answers them from the store, an unknown key with the document's 404). The account
 * holds no credential (rule 7) and delivers nothing (no webhook, no poll), moves no money and issues no pay link.
 */
export const OPENAPI_SANDBOX_COVERAGE: SandboxCoverage = {
    provider: "openapi",
    roles: [
        {
            role: "act",
            operation: OPENAPI_CALL_OPERATION,
            covers: {
                "act.final": {
                    na: "a pinned document declares no refusal final (an operation's 4xx is the system's answer to one call), so no refusal of a source's tool is a business answer: each is a failed act a person resolves",
                },
                // OPENAPI-4: the write is kept, its answer lost (504); a read, or the same call under the same replay key, finds it done.
                "act.unknown_applied": { cases: [OPENAPI_SANDBOX_CASE.timedOut] },
                "act.confirm_read": {
                    na: "a source's tool declares no `confirmBy` (a pinned document states no confirmation read): an unknown outcome is made again under its replay key when the operation takes one, else it stops for a person",
                },
                // An operation that takes the replay key answers a repeated key with the kept result (after OPENAPI-4 too); another request under it is refused 409.
                "act.replay": { cases: [OPENAPI_SANDBOX_CASE.answered, OPENAPI_SANDBOX_CASE.timedOut] },
                "act.partial": {
                    na: "one call of an operation is one request and one answer of the store: the provider sends no batch, so no part of a call can be done while another is not",
                },
            },
        },
        {
            role: "connection",
            covers: {
                "connection.credential_refused": {
                    na: "a sandbox account holds no credential (provider-sandbox rule 7): no key can be refused; a refused call is OPENAPI-2 (the system's 4xx)",
                },
                "connection.revoked": {
                    na: "a sandbox account holds no grant to revoke: it is removed by the owner (soft delete), and a removed account is refused before any call",
                },
                "connection.refresh": { na: "an API account is a saved key, not an OAuth grant: NIVO holds no refresh token for it, so no refresh can be refused or busy" },
            },
        },
    ],
}
