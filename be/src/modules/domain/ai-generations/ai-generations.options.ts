import type { Type } from "@nestjs/common"
import type { UsageGate } from "./ai-generations.port"

/** The options of the ai-generations capability. */
export interface AiGenerationsOptions {
    /** The class that implements the usage port (billing lane). */
    readonly usage: Type<UsageGate>
}
