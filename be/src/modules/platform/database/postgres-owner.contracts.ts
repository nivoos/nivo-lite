/** One row a statement answers: the cells by their column name. */
export type OwnerRow = Record<string, unknown>

/** The isolation level a transaction of the owner connection runs under, as the database names it. */
export type OwnerIsolation = "REPEATABLE READ" | "READ COMMITTED"

/** Runs statements: statement text and positional parameters in, rows out. */
export interface OwnerStatements {
    /** Runs one statement as it is given and answers its rows. */
    run(text: string, params?: ReadonlyArray<unknown>): Promise<ReadonlyArray<OwnerRow>>
}

/** The work of one transaction: it runs its statements through the statements it is given. */
export type OwnerWork<T> = (statements: OwnerStatements) => Promise<T>

/**
 * One dedicated connection to the environment's database as its OWNER role, for the whole-database copy (the app's own role is never widened).
 * Nothing is opened until `initialize`.
 */
export interface OwnerConnection extends OwnerStatements {
    /** Opens the connection. */
    initialize(): Promise<void>
    /** Runs `work` in one transaction of the isolation level, commits, and rolls back when `work` throws. */
    transaction<T>(isolation: OwnerIsolation, work: OwnerWork<T>): Promise<T>
    /** Closes the connection. */
    destroy(): Promise<void>
}
