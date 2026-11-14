import type { DriverAdapter, OpenContext, Spool } from "@modules/integrations/seed"
import { injector, type TypedParameterDecorator } from "@modules/platform/composition"
import type { DataSetDeclaration } from "./data-copies.contracts"
import type { DataBackupConfig } from "./data-copies.options"

/** Token of every driver NIVO keeps copies with (a `ReadonlyArray<DriverAdapter>`), exported so a spec can provide it. */
export const DATA_DRIVERS: unique symbol = Symbol("domain.data-copies.drivers")

/** The type the `DATA_DRIVERS` token resolves to. */
export type DataDrivers = ReadonlyArray<DriverAdapter>

/** Token of the handle a read or a full verify opens a copy with (`OpenContext`: the key never travels here). */
export const DATA_OPEN_CONTEXT: unique symbol = Symbol("domain.data-copies.open-context")

/** Token of the public age recipients a write seals to (the target environment's rule of `.sops.yaml`; never an identity). */
export const DATA_RECIPIENTS: unique symbol = Symbol("domain.data-copies.recipients")

/** Token of the data sets this deployment keeps copies of. */
export const DATA_SET_LIST: unique symbol = Symbol("domain.data-copies.sets")

/** Token of the spools one export is held in while every driver writes the same bytes. */
export const DATA_SPOOL: unique symbol = Symbol("domain.data-copies.spool")

/** The type the `DATA_SPOOL` token resolves to: it makes a spool for each export. */
export interface DataSpools {
    /** Makes the spool one export is held in; the caller disposes of it. */
    make(): Spool
}

/** Token of the settings of the scheduled backup. */
export const DATA_BACKUP_CONFIG: unique symbol = Symbol("domain.data-copies.backup-config")

/** Injects the drivers. Parameter type: DataDrivers. */
export const InjectDataDrivers = (): TypedParameterDecorator<DataDrivers> => injector<DataDrivers>(DATA_DRIVERS)

/** Injects the handle copies are opened with. Parameter type: OpenContext. */
export const InjectDataOpenContext = (): TypedParameterDecorator<OpenContext> =>
    injector<OpenContext>(DATA_OPEN_CONTEXT)

/** Injects the public recipients a write seals to. Parameter type: ReadonlyArray<string>. */
export const InjectDataRecipients = (): TypedParameterDecorator<ReadonlyArray<string>> =>
    injector<ReadonlyArray<string>>(DATA_RECIPIENTS)

/** Injects the declared data sets. Parameter type: ReadonlyArray<DataSetDeclaration>. */
export const InjectDataSets = (): TypedParameterDecorator<ReadonlyArray<DataSetDeclaration>> =>
    injector<ReadonlyArray<DataSetDeclaration>>(DATA_SET_LIST)

/** Injects the spools. Parameter type: DataSpools. */
export const InjectDataSpool = (): TypedParameterDecorator<DataSpools> => injector<DataSpools>(DATA_SPOOL)

/** Injects the settings of the scheduled backup. Parameter type: DataBackupConfig. */
export const InjectDataBackupConfig = (): TypedParameterDecorator<DataBackupConfig> =>
    injector<DataBackupConfig>(DATA_BACKUP_CONFIG)
