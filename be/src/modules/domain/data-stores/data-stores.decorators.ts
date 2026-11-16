import type { StoreAdapter } from "@modules/integrations/seed"
import type { DataStoreConsole } from "./data-stores.options"
import { injector, type TypedParameterDecorator } from "@modules/platform/composition"

/** Token of every store adapter NIVO keeps (the workspace database and the workspace's object storage), exported so a spec can provide it. */
export const DATA_STORES: unique symbol = Symbol("domain.data-stores.stores")

/** The type the `DATA_STORES` token resolves to. */
export type DataStores = ReadonlyArray<StoreAdapter>

/** Injects every store adapter. Parameter type: DataStores. */
export const InjectDataStores = (): TypedParameterDecorator<DataStores> => injector<DataStores>(DATA_STORES)

/** Token of the console one served store speaks the protocol on, exported so a spec can provide it. */
export const DATA_STORE_CONSOLE: unique symbol = Symbol("domain.data-stores.console")

/** Injects the console. Parameter type: DataStoreConsole. */
export const InjectDataStoreConsole = (): TypedParameterDecorator<DataStoreConsole> =>
    injector<DataStoreConsole>(DATA_STORE_CONSOLE)
