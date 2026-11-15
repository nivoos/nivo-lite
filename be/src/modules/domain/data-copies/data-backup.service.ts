import { Injectable } from "@nestjs/common"
import {
    DataRefusal,
    exportOnce,
    writeEverywhere,
    type CopyReceipt,
    type DataManifest,
    type DriverAdapter,
    type ExportSource,
    type StoreAdapter,
} from "@modules/integrations/seed"
import { InjectClock, type Clock } from "@modules/platform/clock"
import { InjectEffects, type Effects } from "@modules/platform/effects"
import { payloadOfJob, type ClaimedJob } from "@modules/platform/jobs"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { BACKUP_DATA_JOB, DATA_COPY_WRITE_EFFECT, dataCopyFailure } from "@modules/queues/data-copies"
import { InjectDataStores, type DataStores } from "@modules/domain/data-stores"
import type { DataBackupResult, DataSetDeclaration } from "./data-copies.contracts"
import {
    InjectDataDrivers,
    InjectDataRecipients,
    InjectDataSets,
    InjectDataSpool,
    type DataDrivers,
    type DataSpools,
} from "./data-copies.decorators"
import { DataCopiesLogEvent } from "./data-copies.log-events"
import {
    SOURCE_ENVIRONMENT,
    backupFailureOf,
    countsOf,
    dataRefusalFailure,
    heldEverywhere,
    keptWriteOf,
    membersOf,
    receiptFromKept,
    refusalLogOf,
    warningsOf,
} from "./data-copies.policy"

/** The digest of the newest copy a driver holds, or null when it holds none. */
const newestDigestOf = async (driver: DriverAdapter): Promise<string | null> =>
    (await driver.list())[0]?.exportDigest ?? null

/** What one backup of a set works with: the claimed job, the set, the stores it reads and the drivers that hold its copies. */
interface BackupRun {
    /** The claimed job: its id is what the effect keys are made of. */
    readonly job: ClaimedJob
    /** The data set. */
    readonly set: DataSetDeclaration
    /** The stores the set reads. */
    readonly stores: ReadonlyArray<StoreAdapter>
    /** The drivers that hold the set's copies. */
    readonly drivers: ReadonlyArray<DriverAdapter>
    /** When the backup ran (ISO). */
    readonly at: string
}

@Injectable()
/** The backup of one data set in one slot (`seed-backup` only): export once, skip when nothing changed, else write the one export to every driver. */
export class DataBackupService {
    constructor(
        @InjectDataSets() private readonly sets: ReadonlyArray<DataSetDeclaration>,
        @InjectDataStores() private readonly stores: DataStores,
        @InjectDataDrivers() private readonly drivers: DataDrivers,
        @InjectDataRecipients() private readonly recipients: ReadonlyArray<string>,
        @InjectDataSpool() private readonly spools: DataSpools,
        @InjectEffects() private readonly effects: Effects,
        @InjectClock() private readonly clock: Clock,
        @InjectLogger() private readonly logger: Logger,
    ) {}

    /**
     * Runs the backup of the claimed job's data set. A configuration refusal, a leg that failed for good or a bug throws a typed failure the
     * job runner judges (no retry, one item for a person); a transient leg failure throws a transient one (the ladder). Copies already
     * written are kept, and a retry writes none of them twice.
     */
    async run(job: ClaimedJob): Promise<DataBackupResult> {
        const payload = payloadOfJob(BACKUP_DATA_JOB, job)
        const set = this.sets.find((candidate) => candidate.id === payload.setId)
        if (set === undefined) throw dataCopyFailure("input", `unknown data set ${payload.setId}`)
        const run: BackupRun = {
            job,
            set,
            stores: membersOf(this.stores, set.stores, "store", set.id),
            drivers: membersOf(this.drivers, set.drivers, "driver", set.id),
            at: this.clock.now().toISOString(),
        }
        try {
            return await this.backup(run)
        } catch (cause) {
            if (!(cause instanceof DataRefusal)) throw cause
            this.logger.error(DataCopiesLogEvent.BackupRefused, cause, {
                jobId: job.jobId,
                setId: set.id,
                ...refusalLogOf(cause),
            })
            throw dataRefusalFailure(cause)
        }
    }

    /** Exports the stores once into a spool the run disposes of, then writes the export unless every driver holds it already. */
    private async backup(run: BackupRun): Promise<DataBackupResult> {
        const spool = this.spools.make()
        try {
            const source = await exportOnce(run.stores, {}, spool, {
                format: `${run.set.id}-seed-backup@1`,
                purpose: run.set.purpose,
                takenAt: run.at,
                source: { project: run.set.id, environment: SOURCE_ENVIRONMENT },
            })
            const newest = await Promise.all(run.drivers.map((driver) => newestDigestOf(driver)))
            return heldEverywhere(source.manifest, newest)
                ? this.unchanged(run, source.manifest)
                : await this.write(run, source)
        } finally {
            await spool.dispose()
        }
    }

    /** The result of a run that found every driver holding the export: nothing was written. */
    private unchanged(run: BackupRun, manifest: DataManifest): DataBackupResult {
        const result: DataBackupResult = {
            setId: run.set.id,
            at: run.at,
            outcome: "unchanged",
            exportDigest: manifest.exportDigest,
            counts: countsOf(manifest),
            drivers: run.drivers.map((driver) => driver.id),
            warnings: [],
        }
        this.logger.info(DataCopiesLogEvent.BackupUnchanged, { ...result })
        return result
    }

    /** Writes the one export to every driver; a leg that failed ends the run with its judgement, warnings are logged and answered. */
    private async write(run: BackupRun, source: ExportSource): Promise<DataBackupResult> {
        const raised = new Map<string, unknown>()
        const legs = run.drivers.map((driver) => this.writing(run.job, driver, source.manifest, raised))
        const written = await writeEverywhere(source, legs, { recipients: this.recipients, dryRun: false })
        const failure = backupFailureOf(run.set.id, written, raised)
        if (failure !== null) throw failure
        const warnings = warningsOf(written)
        for (const warning of warnings)
            this.logger.warn(DataCopiesLogEvent.BackupWarning, { setId: run.set.id, ...warning })
        const result: DataBackupResult = {
            setId: run.set.id,
            at: run.at,
            outcome: "written",
            exportDigest: source.manifest.exportDigest,
            counts: countsOf(source.manifest),
            drivers: written.legs.map((leg) => leg.driver),
            warnings,
        }
        this.logger.info(DataCopiesLogEvent.BackupDone, { ...result })
        return result
    }

    /** The driver whose write is an outside act: an intent before it, the receipt kept after; a failure of it is remembered for the run's judgement. */
    private writing(
        job: ClaimedJob,
        driver: DriverAdapter,
        manifest: DataManifest,
        raised: Map<string, unknown>,
    ): DriverAdapter {
        return {
            id: driver.id,
            kind: driver.kind,
            limits: () => driver.limits(),
            plan: (planned) => driver.plan(planned),
            list: () => driver.list(),
            read: (ref, context) => driver.read(ref, context),
            verify: (ref, context) => driver.verify(ref, context),
            write: async (source, context) => {
                try {
                    return await this.effects.once<CopyReceipt>(
                        `${job.jobId}:${DATA_COPY_WRITE_EFFECT.name}:${driver.id}`,
                        DATA_COPY_WRITE_EFFECT,
                        {
                            act: () => driver.write(source, context),
                            keep: keptWriteOf,
                            from: (kept) => receiptFromKept(driver, manifest, kept),
                        },
                    )
                } catch (cause) {
                    raised.set(driver.id, cause)
                    throw cause
                }
            },
        }
    }
}
