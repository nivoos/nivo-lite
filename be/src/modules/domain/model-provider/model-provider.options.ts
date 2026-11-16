import type { ProviderSandboxSwitch } from "@modules/domain/provider-sandbox"

/** What the app root decides for the model provider: the dev switch it read once (`parseProviderSandboxConfig`). */
export interface ModelProviderOptions {
    /** The provider sandbox switch: off (production) binds no account route at all, so every model call goes to the endpoint. */
    readonly sandbox: ProviderSandboxSwitch
}
