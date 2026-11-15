import {
    allGatesConfirmed,
    gateEntry,
    gatesOf,
    snapshotOf,
    type ContextVersion,
    type SetupSession,
} from "@/modules/installations"
import type { ModuleCopy } from "@/modules/catalog"

/** How far the checklist is and whether applying the draft would change anything. */
type SetupProgress = {
    readonly confirmed: number
    readonly total: number
    /** Every gate is confirmed. */
    readonly isReady: boolean
    /** The draft is already the version in use. */
    readonly isUnchanged: boolean
}

/** The progress of the gate checklist of a module (its catalogue row) against the version in use. */
export const setupProgressOf = (
    copy: ModuleCopy | undefined,
    session: SetupSession,
    active: ContextVersion | null,
): SetupProgress => {
    const gates = gatesOf(copy)
    return {
        confirmed: gates.filter((gate) => gateEntry(session.gateEvidence, gate.key).status === "confirmed").length,
        total: gates.length,
        isReady: allGatesConfirmed(copy, session.gateEvidence),
        isUnchanged:
            active !== null &&
            JSON.stringify(active.snapshot) === JSON.stringify(snapshotOf(session.draft, session.gateEvidence)),
    }
}
