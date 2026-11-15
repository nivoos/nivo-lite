import type { EnvSource } from "@modules/platform/config"
import type { CellsOptions } from "./cells.options"

/**
 * Where the isolated runner's compiled entry is: the `main` of the runner package as Node resolves it from here. A path for the child process to start,
 * never a module this process loads (the cells-isolation gate D keeps the engine from importing the runner).
 */
const installedRunnerEntry = (): string =>
    require.resolve("@nivo-lite/cell-runner/package.json").replace(/package\.json$/u, "dist/main.js")

/**
 * Reads the cells options. Every member is a tunable with the default of CELLS-PLAN 4.4: CELLS_RUNNER_MEMORY_BYTES (64 MiB), CELLS_RUNNER_STACK_BYTES (1 MiB,
 * which the runner clamps to what the WebAssembly engine can hold), CELLS_RUNNER_CPU (2s), CELLS_RUNNER_WALL (10s, paused during tool calls),
 * CELLS_RUNNER_OUTPUT_BYTES (256 KiB), CELLS_RUNNER_MAX_CALLS (50) and CELLS_RUNNER_POOL_SIZE (2). A cell row may only go lower than these.
 * CELLS_RUNNER_ENTRY is the runner's compiled entry; absent, the installed `@nivo-lite/cell-runner` package's (built by `npm run build:modules`).
 */
export const parseCellsConfig = (env: EnvSource): CellsOptions => ({
    runnerLimits: {
        memoryBytes: env.int("CELLS_RUNNER_MEMORY_BYTES", 64 * 1024 * 1024),
        stackBytes: env.int("CELLS_RUNNER_STACK_BYTES", 1024 * 1024),
        cpuMs: env.duration("CELLS_RUNNER_CPU", 2000),
        wallMs: env.duration("CELLS_RUNNER_WALL", 10_000),
        outputBytes: env.int("CELLS_RUNNER_OUTPUT_BYTES", 256 * 1024),
        maxCalls: env.int("CELLS_RUNNER_MAX_CALLS", 50),
    },
    runnerPoolSize: env.int("CELLS_RUNNER_POOL_SIZE", 2),
    runnerEntry: env.optional("CELLS_RUNNER_ENTRY") ?? installedRunnerEntry(),
})
