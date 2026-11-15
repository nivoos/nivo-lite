import type { ConnectionRecord, Provider } from "./connections.contracts"

/**
 * A provider's CONNECT STEP (providers concept, "one door"): what makes a stored account usable at the vendor. It verifies the stored
 * credential, registers what the vendor must call (a webhook address), and stores the public facts the engine later finds the account by.
 * The provider DECLARES it once (registered at boot through `AccountConnectService.register`); every door that creates or re-credentials a
 * live account (a person's wizard in the console, the seed) runs the same step through `AccountConnectService.connect`. A step throws the
 * provider's own typed error on a refusal; it never returns or logs a credential.
 */
export interface AccountConnectStep {
    /** The provider whose accounts it connects. */
    readonly provider: Provider
    /** What it does at the vendor, in plain words (a dry run prints it; never a value). */
    readonly does: string
    /** Runs the step for a stored live account; `origin` is the public https origin the vendor calls back. */
    connect(account: ConnectionRecord, origin: string): Promise<void>
}

/**
 * What the door did, or (dry) would do, for one account:
 * - `connected`: the step ran and the vendor accepted it;
 * - `already_connected`: the account carries the stamp of a connect that succeeded and nothing forced another;
 * - `connect_refused`: the step ran and was refused, with the step's typed code (the account is marked `error` with it);
 * - `would_connect`: a dry run: the step would run (no vendor call);
 * - `local_only`: no public https origin, so the vendor could call nothing: the step waits for the real domain;
 * - `no_connect_step`: the provider declares no step (nothing at the vendor is NIVO's to register: a person's act, or none);
 * - `sandbox`: a sandbox account is answered by its provider's sandbox twin; there is no vendor.
 */
export type ConnectOutcome =
    | { readonly kind: "connected" }
    | { readonly kind: "already_connected"; readonly since: string }
    | { readonly kind: "connect_refused"; readonly code: string; readonly cause: unknown }
    | { readonly kind: "would_connect"; readonly does: string }
    | { readonly kind: "local_only" }
    | { readonly kind: "no_connect_step" }
    | { readonly kind: "sandbox" }

/** How one connect is asked: `force` runs the step even when the account carries the stamp; `dry` calls no vendor and writes nothing. */
export interface ConnectRequest {
    readonly force: boolean
    readonly dry: boolean
}

/** The public fact the door stamps on an account when its connect step succeeded (ISO time): it is how "already connected" is known. */
export const CONNECTED_AT_FACT = "connected_at"
