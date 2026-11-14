import { Injectable } from "@nestjs/common"
import { MODEL_PROVIDER, type AiRunner, type ModelAccount, type ModelProviderPort } from "./model-provider.contracts"

@Injectable()
/**
 * The model provider's LIVE port: the live account is the deployment's own endpoint, so every call of it is served by the endpoint's
 * runner as it is handed in (the model door's own `AiClient`), unchanged.
 */
export class ModelLiveRunnerService implements ModelProviderPort {
    /** The model provider. */
    readonly provider = MODEL_PROVIDER

    /** The endpoint itself: a live call is never touched. */
    runnerOf(_account: ModelAccount, _purpose: string, endpoint: AiRunner): AiRunner {
        return endpoint
    }
}
