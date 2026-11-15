/**
 * The failure the OpenAPI sandbox's lost-request case throws (`OPENAPI-5`): the deadline of the call passed before the system answered,
 * as the live client's timeout. It is no DomainError: the connector reads any failure of the transport as an UNKNOWN outcome (the request
 * may have reached the system), exactly as it reads the live client's. Nothing was applied in the sandbox's store.
 */
export class OpenApiSandboxTimeoutError extends Error {
    override readonly name = "TimeoutError"

    constructor() {
        super("the sandbox system did not answer before the deadline (case OPENAPI-5)")
    }
}
