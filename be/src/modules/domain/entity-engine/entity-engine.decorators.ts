import { injector, type TypedParameterDecorator } from "@modules/platform/composition"
import type { EntityEngineOptions } from "./entity-engine.options"
import { RECORD_CONTACTS, type RecordContactsPort } from "./record-contacts.port"

/** Token of the entity engine options, exported so a spec can provide it. */
export const ENTITY_ENGINE_OPTIONS: unique symbol = Symbol("domain.entity-engine.options")

/** Injects the options of the entity engine. Parameter type: EntityEngineOptions. */
export const InjectEntityEngineOptions = (): TypedParameterDecorator<EntityEngineOptions> =>
    injector<EntityEngineOptions>(ENTITY_ENGINE_OPTIONS)

/** Injects the contacts a contact field is proved against. Parameter type: RecordContactsPort. */
export const InjectRecordContacts = (): TypedParameterDecorator<RecordContactsPort> => injector<RecordContactsPort>(RECORD_CONTACTS)
