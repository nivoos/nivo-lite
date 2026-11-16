import type { EntityManager } from "typeorm"
import { injector, type TypedParameterDecorator } from "@modules/platform/composition"
import type { EffectsOptions } from "./effects.options"
import type { Effects } from "./effects.port"

/** Token of the Effects port. */
export const EFFECTS: unique symbol = Symbol("platform.effects")

/** Token of the entity managers of the connections that hold the effect ledger, in the order the options name them. */
export const EFFECTS_MANAGERS: unique symbol = Symbol("platform.effects.managers")

/** Token of the options of the effects capability, exported so a spec can provide it. */
export const EFFECTS_OPTIONS: unique symbol = Symbol("platform.effects.options")

/** Injects the options of the effects capability. Parameter type: EffectsOptions. */
export const InjectEffectsOptions = (): TypedParameterDecorator<EffectsOptions> => injector<EffectsOptions>(EFFECTS_OPTIONS)

/** Injects the Effects port. Parameter type: Effects. */
export const InjectEffects = (): TypedParameterDecorator<Effects> => injector<Effects>(EFFECTS)

/** Injects the entity managers of the connections that hold the effect ledger. Parameter type: ReadonlyArray<EntityManager>. */
export const InjectEffectsManagers = (): TypedParameterDecorator<ReadonlyArray<EntityManager>> =>
    injector<ReadonlyArray<EntityManager>>(EFFECTS_MANAGERS)
