import type { EntityManager } from "typeorm"
import type { SandboxAccount, SandboxCall, SandboxCallOutcome } from "./provider-sandbox.contracts"

/** One logged call to keep. */
export interface SandboxCallInput {
    readonly operation: string
    readonly key: string
    readonly request: unknown
    readonly result: SandboxCallOutcome
}

/** A kept state value, wrapped so a kept `null` is told apart from "nothing kept". */
export interface KeptState {
    readonly value: unknown
}

/** The step `serialized` runs under the account's lock, handed the lock's own transaction (undefined for a store with no database). */
export type SandboxLockedRun<Result> = (manager?: EntityManager) => Promise<Result>

/**
 * The engine store of the provider sandbox: the STATE and the call log of ONE live (not removed) sandbox account. Every read and write
 * names the account and sees nothing of a removed or live one (the real store joins `connections` on `deleted_at IS NULL AND sandbox`).
 */
export interface ProviderSandboxStore {
    /** The account as the sandbox doors read it, or null when the workspace has no such live account. */
    accountOf(workspaceId: string, connectionId: string, manager?: EntityManager): Promise<SandboxAccount | null>
    /** The account a webhook route names (any workspace), or null when there is no such live account. */
    accountOfId(connectionId: string, manager?: EntityManager): Promise<SandboxAccount | null>
    /** The newest kept value of (name, key), or null; on `manager` when it is given (the lock's own transaction). */
    stateOf(account: SandboxAccount, name: string, key: string, manager?: EntityManager): Promise<KeptState | null>
    /** Keeps a value of (name, key); on `manager` when it is given. */
    keepState(account: SandboxAccount, name: string, key: string, value: unknown, manager?: EntityManager): Promise<void>
    /** Logs one call; on `manager` when it is given. */
    logCall(account: SandboxAccount, call: SandboxCallInput, manager?: EntityManager): Promise<void>
    /** How many calls of the operation the account took; on `manager` when it is given. */
    countCalls(account: SandboxAccount, operation: string, manager?: EntityManager): Promise<number>
    /** The logged calls, oldest first; of one operation when it is named. */
    calls(account: SandboxAccount, operation?: string): Promise<ReadonlyArray<SandboxCall>>
    /**
     * Runs `run` while holding the account's ONE lock: another `serialized` run of the same account waits for it (across processes), so a
     * call's read of its running number, its answer and its log are one step, never two calls drawing the same number. `run` is handed
     * the lock's own transaction (undefined for a store with no database) and makes EVERY read and write on it: a connection holding the
     * lock never waits for another connection of the pool. `run` must not call `serialized` of the same account again, and awaits no
     * outside work.
     */
    serialized<Result>(account: SandboxAccount, run: SandboxLockedRun<Result>): Promise<Result>
    /** Forgets the account's state and call log (a test's `finally`). */
    reset(account: SandboxAccount): Promise<void>
}
