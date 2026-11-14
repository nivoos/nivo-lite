/** A sealed text split into the key version it names and its base64 body. */
export interface VersionedSeal {
    /** The key version label (`v1`, `v2`, ...). */
    readonly version: string
    /** The base64 of iv | tag | ciphertext. */
    readonly body: string
}

/** Seals a text so it never rests in plain text, and opens it again; one key, one cipher. */
export interface SecretSealer {
    /** The sealed form of a text. */
    seal(plain: string): string
    /** The text a sealed form holds; throws `SEALING_UNREADABLE` when it cannot be opened with this key. */
    open(sealed: string): string
}
