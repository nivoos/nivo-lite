import type { DomainError } from "./domain.error"
import type { ErrorKindTable } from "./errors.contracts"

/** Options of the errors capability: the kind tables of every capability the app composes. */
export interface ErrorsOptions {
    /** One `<C>_ERROR_KINDS` table per capability; a code found in none of them is internal. */
    readonly kinds: ReadonlyArray<ErrorKindTable>
    /**
     * One function per capability that knows failures of a driver it owns (the database's transient failures): it returns the typed
     * error of a failure it knows, whose code a kind table above declares, or null. The failure is then answered by that code, never
     * masked as internal. The same functions the capability's classifier reads, so a door and a ladder never disagree.
     */
    readonly typers?: ReadonlyArray<(failure: unknown) => DomainError<string> | null>
}
