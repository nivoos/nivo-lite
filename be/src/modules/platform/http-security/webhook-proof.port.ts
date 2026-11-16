/** What a registered proof receives: the exact bytes and headers of one delivery, and the scope the route names (a connection id). */
export interface WebhookProofRequest {
    /** The scope the door names, for example the connection the provider was registered with. */
    readonly scope: string
    /** The unparsed request bytes. */
    readonly rawBody: Buffer | undefined
    /** The provider's signature or token header, when supplied. */
    readonly signature: string | undefined
    /** The provider's timestamp header, when it sends one. */
    readonly timestamp: string | undefined
}

/** What may be logged of a refused delivery: short plain values by name, never a body, secret, signature or token. */
export interface WebhookProofFacts {
    readonly [name: string]: string
}

/**
 * What a proof answers for one delivery: `true` it proves the secret of its scope, `false` it is refused, `"unproven"` the provider's door
 * must acknowledge it although nothing could be proven yet (a scope whose secret the provider hands over only after its first call was
 * answered): such a delivery is kept as received and never acted on.
 */
export type WebhookProofAnswer = boolean | "unproven"

/**
 * THE ONE VERDICT of a delivery's proof, which every intake behind a door obeys and never decides again: `proven` (the scope's own proof,
 * or the sandbox key of a sandbox account) or `unproven` (acknowledged, kept, never acted on). A refused delivery has no verdict: it throws.
 */
export type WebhookProofVerdict = "proven" | "unproven"

/** The proof of one provider whose secret is not one value of the app but belongs to a scope stored in the database. */
export interface WebhookProof {
    /** The provider key the door names in `verify`. */
    readonly provider: string
    /** The proof's answer for one delivery (`WebhookProofAnswer`); a missing scope or secret is refused or unproven, never a throw. */
    prove(request: WebhookProofRequest): Promise<WebhookProofAnswer>
    /**
     * What may be logged of a refused delivery besides the provider and scope (for example the event name), read without trusting the
     * body. Short plain values only: never the body, a secret, a signature or a token.
     */
    facts?(request: WebhookProofRequest): WebhookProofFacts
}

/** Where a domain module registers the proof of a provider whose secrets live in the database. */
export interface WebhookProofRegistry {
    /** Registers a proof; a second proof for the same provider is refused. */
    add(proof: WebhookProof): void
    /** The verdict of the provider's registered proof; a refused delivery or an unregistered provider throws. */
    verify(provider: string, request: WebhookProofRequest): Promise<WebhookProofVerdict>
}
