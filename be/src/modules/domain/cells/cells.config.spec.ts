import { EnvSource } from "@modules/platform/config"
import { parseCellsConfig } from "./cells.config"

describe("parseCellsConfig", () => {
    it("answers the CELLS-PLAN 4.4 defaults when nothing is declared", () => {
        expect(parseCellsConfig(new EnvSource({}))).toEqual({
            runnerLimits: {
                memoryBytes: 64 * 1024 * 1024,
                stackBytes: 1024 * 1024,
                cpuMs: 2000,
                wallMs: 10_000,
                outputBytes: 256 * 1024,
                maxCalls: 50,
            },
            runnerPoolSize: 2,
            runnerEntry: expect.stringMatching(/packages[\\/]cell-runner[\\/]dist\/main\.js$/u),
        })
    })

    it("reads each declared tunable, durations with their unit", () => {
        const options = parseCellsConfig(
            new EnvSource({
                CELLS_RUNNER_MEMORY_BYTES: "1000",
                CELLS_RUNNER_STACK_BYTES: "2000",
                CELLS_RUNNER_CPU: "500ms",
                CELLS_RUNNER_WALL: "3s",
                CELLS_RUNNER_OUTPUT_BYTES: "4000",
                CELLS_RUNNER_MAX_CALLS: "7",
                CELLS_RUNNER_POOL_SIZE: "4",
                CELLS_RUNNER_ENTRY: "/opt/runner/main.js",
            }),
        )
        expect(options).toEqual({
            runnerLimits: {
                memoryBytes: 1000,
                stackBytes: 2000,
                cpuMs: 500,
                wallMs: 3000,
                outputBytes: 4000,
                maxCalls: 7,
            },
            runnerPoolSize: 4,
            runnerEntry: "/opt/runner/main.js",
        })
    })
})
