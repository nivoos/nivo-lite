import type { z } from "../schema/zod-entry"
import { assertToolName } from "../block/block"
import { SdkDefinitionError } from "../block/definition-error"
import { assertRefusals } from "./tool-refusals"
import type {
    DataKindConfig,
    DataKindDefinition,
    EffectConfig,
    EffectDefinition,
    ToolConfig,
    ToolDefinition,
} from "./effect.types"

/** A data kind name: kebab-case ASCII, one word group, no namespace. */
const DATA_KIND = /^[a-z][a-z0-9-]*$/

/**
 * Defines an effect a node may run. Throws `SdkDefinitionError` at module load: `ID_MALFORMED` for its id, and for its refusals
 * `TOOL_REFUSAL_CODE_MALFORMED`, `TOOL_FINAL_REFUSAL_UNKNOWN` (a final refusal that is not one of its own) or `TOOL_FINAL_REFUSAL_RESERVED`
 * (the engine's own `declined`). An effect is a write by its kind, so a final refusal is never refused as one of a read.
 */
export const defineEffect = <P extends z.ZodType>(config: EffectConfig<P>): EffectDefinition<P> => {
    assertToolName(config.id)
    assertRefusals(config.id, config, true)
    return { ...config, entry: "effect" }
}

/**
 * Defines a NIVO MCP tool a node may call. Throws `SdkDefinitionError` at module load: `ID_MALFORMED` for its id, and for its refusals
 * `TOOL_REFUSAL_CODE_MALFORMED`, `TOOL_FINAL_REFUSAL_UNKNOWN` (a final refusal that is not one of its own), `TOOL_FINAL_REFUSAL_ON_READ`
 * (a final refusal on a tool that does not mutate) or `TOOL_FINAL_REFUSAL_RESERVED` (the engine's own `declined`).
 */
export const defineTool = <A extends z.ZodType, R extends z.ZodType>(
    config: ToolConfig<A, R>,
): ToolDefinition<A, R> => {
    assertToolName(config.id)
    assertRefusals(config.id, config, config.mutates)
    return { ...config, entry: "tool" }
}

/** Defines a kind of record the data ports serve. Throws `SdkDefinitionError` (`DATA_KIND_MALFORMED`) at module load. */
export const defineDataKind = <F extends z.ZodObject>(config: DataKindConfig<F>): DataKindDefinition<F> => {
    if (!DATA_KIND.test(config.kind)) throw new SdkDefinitionError("DATA_KIND_MALFORMED", config.kind)
    return { ...config, entry: "data-kind" }
}
