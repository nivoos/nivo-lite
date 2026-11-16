import { Injectable } from "@nestjs/common"
import { ProviderRegistryService } from "@modules/domain/provider-registry"
import type { ModelProviderPort } from "./model-provider.contracts"

@Injectable()
/**
 * How model accounts are served: the model provider's live port (the deployment's endpoint) and its sandbox twin, picked per account by
 * `portFor` (THE ONE SWITCH of lane concept provider-sandbox rule 2: a sandbox account never reaches the live port).
 */
export class ModelProviderRegistryService extends ProviderRegistryService<ModelProviderPort> {}
