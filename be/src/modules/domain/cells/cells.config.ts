import type { EnvSource } from "@modules/platform/config"
import type { CellsOptions } from "./cells.options"

/**
 * Reads the cells options. Every member is a tunable with the default of CELLS-PLAN 4.4: CELLS_RUNNER_MEMORY_BYTES (64 MiB), CELLS_RUNNER_STACK_BYTES (1 MiB,
 * which the runner clamps to what the WebAssembly engine can hold), CELLS_RUNNER_CPU (2s), CELLS_RUNNER_WALL (10s, paused during tool calls),
 * CELLS_RUNNER_OUTPUT_BYTES (256 KiB), CELLS_RUNNER_MAX_CALLS (50) and CELLS_RUNNER_POOL_SIZE (2). A cell row may only go lower than these.
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
})
