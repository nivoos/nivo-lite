import type { RunnerLimits } from "./cells.contracts"

/** The cells capability options, read once by the app (`parseCellsConfig` of `cells.config.ts`), injected by `InjectCellsOptions`. */
export interface CellsOptions {
    /** The defaults every source run is held to (CELLS-PLAN 4.4: 64 MB, 1 MB stack, 2 s cpu, 10 s wall, 256 KB output, 50 calls). A cell row may only go lower. */
    readonly runnerLimits: RunnerLimits
    /** How many runner processes the client keeps in its pool. */
    readonly runnerPoolSize: number
    /** The compiled entry of the isolated runner (`packages/cell-runner/dist/main.js`): a file the child process starts from, never imported. */
    readonly runnerEntry: string
    /**
     * A composition choice, not an environment value: true binds what a seed needs (reader, writer, runner, validation, seed) and no executor, so no
     * tool door is needed (the cli's `cells-seed`). Absent or false: the executor too, and `register` refuses a missing tool door.
     */
    readonly seedOnly?: boolean
}
