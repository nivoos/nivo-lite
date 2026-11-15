import type { EntityManager } from "typeorm"

/**
 * The boundary between a contact's deletion and the work engine's runs (coordinator rulings R37 / R43 on owner ruling R31): when a person
 * is deleted no event of them comes again (the same human writing again is a NEW contact on a NEW route), so the runs parked on them
 * would sit until their own expiry. The work engine implements this port (agent-threads); the contacts never read a run. Optional: with no
 * implementation bound (an app with no work engine), a deletion ends no run.
 */
export interface ContactRunsPort {
    /**
     * Ends, in the deletion's own database transaction and BEFORE the contacts are marked deleted, EVERYTHING pending for the contacts (the
     * contact and every id merged into it) or one of their routes (R72 Q1): the runs parked on them, the wakes still waiting in their
     * scopes, the timers armed for them; answers the runs it ended.
     */
    erasing(
        tx: EntityManager,
        workspaceId: string,
        contactIds: ReadonlyArray<string>,
        /** The records the erase soft-deleted before (concept agent-data, "Contact and subject"): a run whose subject is one of them ends too. */
        hidden?: ReadonlyArray<{ readonly type: string; readonly id: string }>,
    ): Promise<ReadonlyArray<string>>
    /**
     * Once the deletion COMMITTED: the open stops of the runs `erasing` ended close with their runs (resolved, the card rewritten with no
     * live button, the owner's item withdrawn). Not inside the deletion: those are writes of their own. Answers how many stops closed.
     */
    stopsClosed(workspaceId: string, runIds: ReadonlyArray<string>): Promise<number>
}

/** The injection token of the runs of a contact being deleted. */
export const CONTACT_RUNS: unique symbol = Symbol("CONTACT_RUNS")
