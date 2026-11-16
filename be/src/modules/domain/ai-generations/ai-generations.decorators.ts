import { injector, type TypedParameterDecorator } from "@modules/platform/composition"
import type { UsageGate } from "./ai-generations.port"

/** Token of the plan allowance and usage meter port (billing lane). */
export const AI_GENERATIONS_USAGE: unique symbol = Symbol("domain.ai-generations.usage")

/** Injects the usage port. Parameter type: UsageGate. */
export const InjectUsage = (): TypedParameterDecorator<UsageGate> => injector<UsageGate>(AI_GENERATIONS_USAGE)
