import type { ProviderSandboxSwitch } from "./provider-sandbox.contracts"

/** The provider-sandbox capability's options: the dev switch, as `parseProviderSandboxConfig` read it (the one read). */
export interface ProviderSandboxOptions {
    readonly sandbox: ProviderSandboxSwitch
    /**
     * The port this api listens on (`ServerOptions.port`): an inbound case is POSTed to the provider's own webhook route on
     * `http://127.0.0.1:<port>`, the same listener the provider would reach (R58/R62). Absent in an app that sends no case.
     */
    readonly loopbackPort?: number | undefined
    /**
     * The origin of NIVO's own web app (`MailOptions.webOrigin`, `AUTH_WEB_ORIGIN`): a sandbox pay link's checkout address is
     * `<webOrigin>/workspaces/<workspace id>/sandbox/pay/<link id>`. Absent: the reserved host `https://sandbox.invalid/pay/<link id>`.
     */
    readonly webOrigin?: string | undefined
}
