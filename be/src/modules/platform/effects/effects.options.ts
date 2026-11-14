import type { InjectionToken } from "@nestjs/common"
import type { Secret } from "@modules/platform/config"

/** What the effects of one app need: the connection that holds the ledger table, and the key that seals a kept secret. */
export interface EffectsOptions {
    /** The token of the shared entity manager of the connection that holds the effect ledger. */
    readonly connection: InjectionToken
    /** The AES-256 key (32 bytes, base64) that seals the kept value of a call declared `secret`; an app that keeps no secret may omit it. */
    readonly sealingKey?: Secret
}
