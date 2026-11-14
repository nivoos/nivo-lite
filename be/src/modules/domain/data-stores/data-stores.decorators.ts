import type { StoreAdapter } from "@modules/integrations/seed"
import { injector, type TypedParameterDecorator } from "@modules/platform/composition"

/** Token of every store adapter NIVO keeps (the workspace database and the workspace's object storage), exported so a spec can provide it. */
export const DATA_STORES: unique symbol = Symbol("domain.data-stores.stores")

/** The type the `DATA_STORES` token resolves to. */
export type DataStores = ReadonlyArray<StoreAdapter>

/** Injects every store adapter. Parameter type: DataStores. */
export const InjectDataStores = (): TypedParameterDecorator<DataStores> => injector<DataStores>(DATA_STORES)
