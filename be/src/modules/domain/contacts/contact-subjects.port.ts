/**
 * The boundary between a contact merge and the engine data keyed by a contact id (concept agent-data, "Contact and subject"): when two ids
 * become one person, what is keyed by the id that goes joins what is keyed by the survivor (the consumers' stream positions on a
 * contact-keyed stream). The stream cursors implement it (customer-routes); the contacts never read them. Optional: with none bound, a
 * merge joins nothing (an app with no streams).
 */
export interface ContactSubjectsPort {
    /** Joins everything keyed by `from` into `into`, after the merge committed. */
    merged(workspaceId: string, from: string, into: string): Promise<number>
}

/** The injection token of the engine data a merge joins. */
export const CONTACT_SUBJECTS: unique symbol = Symbol("CONTACT_SUBJECTS")
