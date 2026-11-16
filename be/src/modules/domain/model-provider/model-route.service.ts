import { Injectable } from "@nestjs/common"
import { ConnectionsService } from "@modules/domain/connections"
import { ProviderSandboxService } from "@modules/domain/provider-sandbox"
import type { AiCallOwner, AiRunnerRoute } from "@modules/integrations/ai"
import { workInScope } from "@modules/platform/logging"
import { MODEL_PROVIDER, liveModelAccountOf, type AiRunner, type ModelAccount } from "./model-provider.contracts"
import { ModelProviderRegistryService } from "./model-provider-registry.service"
import { modelPurposeOf } from "./model-purpose.policy"

@Injectable()
/**
 * THE ACCOUNT ROUTE of model calls (general rule, R75: every outside system NIVO calls is a provider served through an ACCOUNT; the model
 * endpoint is one). A call is served through the account of the workspace it is made for: the workspace's open SANDBOX model account when
 * it holds one (the oldest), else the deployment's endpoint, the implicit live account; the registry's `portFor` is the one switch between
 * them. With the dev switch off it reads no account at all and answers the endpoint (the module does not even bind it then).
 */
export class ModelRouteService implements AiRunnerRoute {
    constructor(
        private readonly sandbox: ProviderSandboxService,
        private readonly connections: ConnectionsService,
        private readonly registry: ModelProviderRegistryService,
    ) {}

    /** The runner of one call: the endpoint for a live call, the sandbox runner of the workspace's sandbox model account otherwise. */
    async runnerOf(owner: AiCallOwner, endpoint: AiRunner): Promise<AiRunner> {
        if (!this.sandbox.enabled() || owner.workspaceId === null || owner.workspaceId === "") return endpoint
        const account = (await this.sandboxAccountOf(owner.workspaceId)) ?? liveModelAccountOf(owner.workspaceId)
        const port = this.registry.portFor(account)
        return port === undefined ? endpoint : port.runnerOf(account, modelPurposeOf(owner.purpose, workInScope()), endpoint)
    }

    /** The workspace's oldest open sandbox model account, or null when it holds none. */
    private async sandboxAccountOf(workspaceId: string): Promise<ModelAccount | null> {
        const found = (await this.connections.listByProvider(workspaceId, MODEL_PROVIDER, { includeDisconnected: false })).find(
            (connection) => connection.sandbox,
        )
        return found === undefined ? null : { id: found.id, workspaceId: found.workspaceId, provider: MODEL_PROVIDER, sandbox: true }
    }
}
