import type { SecretSealer } from "./sealing.contracts"
import { SealingError, SealingErrorCode } from "./errors/sealing.error"
import { openSecret, parseTokenKey, sealSecret } from "./secret-cipher.policy"

/** The sealer of a key still in base64; a key that is not 32 bytes is `SEALING_KEY_INVALID`. */
export const sealerOf = (keyBase64: string): SecretSealer => {
    const key = parseTokenKey(keyBase64)
    if (key.length === 0) throw new SealingError({ code: SealingErrorCode.KeyInvalid })
    return { seal: (plain) => sealSecret(key, plain), open: (sealed) => openSecret(key, sealed) }
}
