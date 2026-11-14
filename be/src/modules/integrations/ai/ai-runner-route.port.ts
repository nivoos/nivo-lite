import type { AiRunner } from "./ai.contracts"

/**
 * Whose model call this is, as the model door knows it when it picks the runner of one try: the workspace the call is made for (the
 * request's `affinity`, which names its owner) and the call's metering purpose (`<node id>:<tag>`; null for a fixed task of the app).
 */
export interface AiCallOwner {
    /** The workspace the call is made for, or null when the call names none. */
    readonly workspaceId: string | null
    /** The call's metering purpose, or null when the call names none (a fixed task of the app; the route may read the open work scope). */
    readonly purpose: string | null
}

/**
 * THE ACCOUNT ROUTE of model calls (lane concept provider-sandbox, the model row): the model endpoint is a provider like any other, and a
 * call is served through the ACCOUNT of the workspace it is made for. The deployment's endpoint is the implicit live account; a workspace
 * may hold a sandbox model account (dev only), answered by the model provider's sandbox runner. The route answers the runner that serves
 * one call: the endpoint it is handed for every live call, a sandbox runner for a call of a sandbox account. Optional: an app that composes
 * no route calls the endpoint for every call, as before.
 */
export interface AiRunnerRoute {
    /**
     * The runner that serves one call of `owner`: `endpoint` (the deployment's own runner) for a live call, or the sandbox runner of the
     * workspace's sandbox model account, which may pass a call on to `endpoint` (its pass-through case).
     */
    runnerOf(owner: AiCallOwner, endpoint: AiRunner): Promise<AiRunner>
}
