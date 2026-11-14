import { registerEnumType } from "@nestjs/graphql"

/**
 * Why a stopped job will not run on its own: `transient` (an outside cause that may pass), `input` (the data it was given is no good),
 * `code` (a defect to fix) or `config` (a setting to fix).
 */
export const StoppedWorkFailureClass = { transient: "transient", input: "input", code: "code", config: "config" } as const

registerEnumType(StoppedWorkFailureClass, { name: "StoppedWorkFailureClass" })
