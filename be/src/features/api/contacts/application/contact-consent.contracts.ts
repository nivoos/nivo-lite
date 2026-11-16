/** What the contact page's consent read takes: one contact of the workspace. */
export interface ReadContactConsentRequest {
    /** The workspace. */
    readonly workspaceId: string
    /** The contact. */
    readonly contactId: string
}

/** What a person's consent change takes: the contact, the new value and why. */
export interface SetContactConsentRequest {
    /** The workspace. */
    readonly workspaceId: string
    /** The contact. */
    readonly contactId: string
    /** True: the shop may not write to this person first. False: clears it. */
    readonly doNotContact: boolean
    /** Why, in the person's words; null for none. */
    readonly reason: string | null
}

/** Who changed the consent fact last, as the page names them. */
export interface ContactConsentActorView {
    /** `member` (a person on the page) or `agent` (a step's call when the person asked to stop). */
    readonly kind: "member" | "agent"
    /** The member or the agent. */
    readonly id: string
    /** Its name as it reads now, or null when it is gone. */
    readonly name: string | null
    /** For an agent: the member who approved the step's call, or null. */
    readonly approvedBy: string | null
}

/** The contact's ONE consent fact as the page reads it. */
export interface ContactConsentView {
    /** True when the shop may not write to this person first; an answer on their own line still goes. */
    readonly doNotContact: boolean
    /** When it was last set or cleared, ISO UTC; null when never. */
    readonly at: string | null
    /** Who changed it last; null when never. */
    readonly by: ContactConsentActorView | null
    /** Why; null when none was given. */
    readonly reason: string | null
}

/** What a consent change did: `set`, `unchanged` (already so, nothing written) or `not_found`, with the fact after it. */
export interface SetContactConsentView {
    /** How it ended. */
    readonly outcome: "set" | "unchanged" | "not_found"
    /** The fact after the call; null when the contact is not found. */
    readonly consent: ContactConsentView | null
}
