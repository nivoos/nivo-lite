import type { RunnerLimits } from "./cells.contracts"

/**
 * The cells capability options, read once by the app (slice S3 writes `cells.config.ts` that parses them). SKELETON of slice 0: the members
 * the runner needs. A new member is requested from the coordinator.
 */
export interface CellsOptions {
    /** The defaults every source run is held to (CELLS-PLAN 4.4: 64 MB, 1 MB stack, 2 s cpu, 10 s wall, 256 KB output, 50 calls). A cell row may only go lower. */
    readonly runnerLimits: RunnerLimits
    /** How many runner processes the client keeps in its pool. */
    readonly runnerPoolSize: number
}
