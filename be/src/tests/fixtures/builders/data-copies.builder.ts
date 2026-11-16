import type { Provider } from "@nestjs/common"
import { FakeClock, mock } from "@starci/jest-preset"
import {
    DATA_DRIVERS,
    DATA_OPEN_CONTEXT,
    DATA_RECIPIENTS,
    DATA_SET_LIST,
    DATA_SPOOL,
    type DataSetDeclaration,
    type DataSpools,
} from "@modules/domain/data-copies"
import { DATA_STORES } from "@modules/domain/data-stores"
import {
    DataRefusal,
    exportOnce,
    memorySpool,
    memoryStore,
    recordEntry,
    type DataManifest,
    type DriverAdapter,
    type MemoryDriver,
    type MemoryStore,
    type OpenContext,
    type Spool,
} from "@modules/integrations/seed"
import { CLOCK } from "@modules/platform/clock"
import { EFFECTS, type Effects } from "@modules/platform/effects"
import type { ClaimedJob } from "@modules/platform/jobs"
import { LOGGER, type Logger } from "@modules/platform/logging"
import { keptEffectsLedger, type KeptEffectRow } from "./job-chain-runner.builder"

export { memoryDriver } from "@modules/integrations/seed"

/** The data set the specs of the data copy jobs back up: the workspace database and the object storage, two drivers. */
export const NIVO_SET: DataSetDeclaration = {
    id: "nivo-lite",
    purpose: "seed-backup",
    stores: ["database-all", "storage-all"],
    drivers: ["git-copy", "s3-copy"],
    everyMinutes: 1440,
}

/** The handle copies are opened with; the memory drivers ignore it. */
export const OPEN_CONTEXT: OpenContext = { identity: { kind: "age-identity", env: {} } }

/** A claimed job of the data copy chain: the job id is what the effect keys are made of, so a retry passes the same one. */
export const jobOf = (payload: object, jobId = "job-1"): ClaimedJob => ({
    jobId,
    kind: "data.backup",
    fencingToken: 1,
    currentStep: null,
    payload,
})

/** The two stores of NIVO's data set. */
export interface NivoStores {
    /** The workspace database: records. */
    readonly database: MemoryStore
    /** The object storage: a blob. */
    readonly storage: MemoryStore
}

/** The two stores of NIVO's data set, with a little content each (records in the database, a blob in the storage). */
export const nivoStores = (): NivoStores => ({
    database: memoryStore({
        id: "database-all",
        format: "nivo-lite-seed-backup@1",
        sets: {
            contacts: { "ana@example.test": { name: "Ana" }, "ben@example.test": { name: "Ben" } },
            agents: { support: { model: "m" } },
        },
    }),
    storage: memoryStore({
        id: "storage-all",
        kind: "storage",
        sets: { files: { "logo.png": new Uint8Array([1, 2, 3, 4]) } },
    }),
})

/** The record a change of the live database carries. */
export interface ChangedRecord {
    /** The name the record holds. */
    readonly name: string
}

/** A change of the live database: one record set under its key (imported through the store's own import, so the export differs). */
export const changeRecord = async (
    store: MemoryStore,
    set: string,
    key: string,
    value: ChangedRecord,
): Promise<void> => {
    await store.import(
        (async function* () {
            await Promise.resolve()
            yield recordEntry(set, key, value)
        })(),
        { dryRun: false, mode: "merge" },
    )
}

/** What the effects ledger of a world kept: the rows by effect key. */
export interface LedgerRows {
    /** The kept-answer rows by key: how many times the act was made and what it kept. */
    readonly rows: Map<string, KeptEffectRow>
}

/** The collaborators of a data copy service as providers, with the doubles a spec reads. */
export interface CopyWorld {
    /** Every collaborator under its token: the sets, the stores, the drivers, the recipients, the spools, the open handle, the effects, the clock and the logger. */
    readonly providers: ReadonlyArray<Provider>
    /** NIVO's two stores (the live ones the backup reads). */
    readonly stores: NivoStores
    /** The kept-answer effects ledger the effects port is bound to. */
    readonly ledger: LedgerRows
    /** The logger a spec reads. */
    readonly logger: Logger
    /** The spools the world made, in order. */
    readonly spools: ReadonlyArray<Spool>
}

/**
 * A data copy service's world: the declared sets, NIVO's stores, the drivers, the recipients, memory spools that remember themselves, the
 * open handle, the kept-answer effects ledger bound to the effects port, the clock fixed at 2026-11-14T10:00:00Z and a logger a spec reads.
 */
export const copyWorld = (
    drivers: ReadonlyArray<DriverAdapter>,
    sets: ReadonlyArray<DataSetDeclaration> = [NIVO_SET],
): CopyWorld => {
    const ledger = keptEffectsLedger()
    const effects = mock<Effects>()
    effects.once.mockImplementation(ledger.once)
    const stores = nivoStores()
    const spools: Array<Spool> = []
    const spooling = mock<DataSpools>()
    spooling.make.mockImplementation(() => {
        const kept = memorySpool()
        spools.push(kept)
        return kept
    })
    const logger = mock<Logger>()
    const providers: ReadonlyArray<Provider> = [
        { provide: DATA_SET_LIST, useValue: [...sets] },
        { provide: DATA_STORES, useValue: [stores.database, stores.storage] },
        { provide: DATA_DRIVERS, useValue: [...drivers] },
        { provide: DATA_RECIPIENTS, useValue: ["age1recipient"] },
        { provide: DATA_SPOOL, useValue: spooling },
        { provide: DATA_OPEN_CONTEXT, useValue: OPEN_CONTEXT },
        { provide: EFFECTS, useValue: effects },
        { provide: CLOCK, useValue: new FakeClock("2026-11-14T10:00:00.000Z") },
        { provide: LOGGER, useValue: logger },
    ]
    return { providers, stores, ledger, logger, spools }
}

/** The manifest of the current export of NIVO's stores: what a copy promises to hold. */
export const manifestOf = async (stores: NivoStores): Promise<DataManifest> => {
    const spool = memorySpool()
    const source = await exportOnce([stores.database, stores.storage], {}, spool, {
        format: "nivo-lite-seed-backup@1",
        purpose: "seed-backup",
        takenAt: "2026-11-14T03:00:00.000Z",
        source: { project: "nivo-lite", environment: "deployment" },
    })
    await spool.dispose()
    return source.manifest
}

/** Writes the current export of NIVO's stores to a driver as one copy, taken at `takenAt`: what a backup run leaves behind. */
export const writeCopy = async (
    driver: MemoryDriver,
    stores: NivoStores,
    takenAt = "2026-11-14T03:00:00.000Z",
): Promise<void> => {
    const spool = memorySpool()
    const source = await exportOnce([stores.database, stores.storage], {}, spool, {
        format: "nivo-lite-seed-backup@1",
        purpose: "seed-backup",
        takenAt,
        source: { project: "nivo-lite", environment: "deployment" },
    })
    await driver.write(source, { recipients: [], dryRun: false })
    await spool.dispose()
}

/** A driver that stores the copy and then loses the answer (the process "dies" after the write): throws a transient refusal the first time only. */
export const dyingAfterWrite = (inner: MemoryDriver): MemoryDriver => {
    let died = false
    return {
        ...inner,
        write: async (source, context) => {
            const receipt = await inner.write(source, context)
            if (died) return receipt
            died = true
            throw new DataRefusal("DATA_DRIVER_UNAVAILABLE", "transient", { driver: inner.id })
        },
    }
}

/** A driver that is down until `up()` is called. */
export interface DriverDownUntilUp {
    /** The driver: every write throws a transient refusal and stores nothing while it is down. */
    readonly driver: MemoryDriver
    /** Brings the driver up. */
    readonly up: () => void
}

/** A driver that is down until `up()` is called: every write throws a transient refusal and stores nothing. */
export const downUntilUp = (inner: MemoryDriver): DriverDownUntilUp => {
    let down = true
    return {
        driver: {
            ...inner,
            write: async (source, context) => {
                await Promise.resolve()
                if (down) throw new DataRefusal("DATA_DRIVER_UNAVAILABLE", "transient", { driver: inner.id })
                return inner.write(source, context)
            },
        },
        up: () => {
            down = false
        },
    }
}
