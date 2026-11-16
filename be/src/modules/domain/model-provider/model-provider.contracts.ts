import type { SandboxAccount } from "@modules/domain/provider-sandbox"
import type { AiChatModel, AiChatRequest, AiRunner, AiTurnRequest, ChainReply } from "@modules/integrations/ai"

export type { AiChatModel, AiChatRequest, AiRunner, AiTurnRequest, ChainReply }

/**
 * The provider key of the MODEL ENDPOINT as an account (lane concept provider-sandbox, the model row): a workspace's sandbox model account
 * is a connection of this provider; the live account is the deployment's own endpoint and has no row.
 */
export const MODEL_PROVIDER = "model"

/** A model account: the workspace's sandbox model account, or the implicit live account of the deployment's endpoint (no row). */
export type ModelAccount = SandboxAccount

/** The id the implicit live account of a workspace is named by (it is no connection row: the deployment's own endpoint). */
export const MODEL_LIVE_ACCOUNT_ID = "endpoint"

/** The implicit live model account of a workspace: the deployment's endpoint, served by the live port. */
export const liveModelAccountOf = (workspaceId: string): ModelAccount => ({
    id: MODEL_LIVE_ACCOUNT_ID,
    workspaceId,
    provider: MODEL_PROVIDER,
    sandbox: false,
})

/**
 * THE MODEL PROVIDER'S PORT, as the provider registry holds it (`register({ live, sandbox })`, `portFor(account)`): the runner that
 * serves the calls of one account under one purpose. The live port answers the deployment's endpoint itself; the sandbox port answers
 * a runner that plays the provider from its hardcoded catalogue and may pass a call on to the endpoint (its default case).
 */
export interface ModelProviderPort {
    /** Always `model`. */
    readonly provider: string
    /**
     * The runner of one call of `account` made for `purpose` (the call's metering purpose, else its work scope's `<kind>:<step>`, else
     * `call`); `endpoint` is the deployment's own runner.
     */
    runnerOf(account: ModelAccount, purpose: string, endpoint: AiRunner): AiRunner
}
