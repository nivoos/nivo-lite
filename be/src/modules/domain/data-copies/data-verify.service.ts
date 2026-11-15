import { Injectable } from "@nestjs/common"
import {
    DataRefusal,
    compareCopies,
    exportOnce,
    memoryStore,
    restoreFrom,
    type CopyVerdict,
    type DriverAdapter,
    type OpenContext,
    type StoreAdapter,
    type VerifyCheck,
} from "@modules/integrations/seed"
import { InjectClock, type Clock } from "@modules/platform/clock"
import { payloadOfJob, type ClaimedJob } from "@modules/platform/jobs"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { eachInOrder } from "@modules/platform/primitives"
import { VERIFY_DATA_JOB, dataCopyFailure } from "@modules/queues/data-copies"
import { InjectDataStores, type DataStores } from "@modules/domain/data-stores"
import type { DataSetDeclaration, DataVerifyReceipt, DriverVerification } from "./data-copies.contracts"
import {
    InjectDataDrivers,
    InjectDataOpenContext,
    InjectDataSets,
    InjectDataSpool,
    type DataDrivers,
    type DataSpools,
} from "./data-copies.decorators"
import { DataCopiesLogEvent } from "./data-copies.log-events"
import { dataRefusalFailure, membersOf, refusalLogOf } from "./data-copies.policy"
import {
    missingCopyOf,
    restoreCheckOf,
    restoreMismatches,
    verificationOf,
    verifyProblemsOf,
    verifyReceiptOf,
} from "./data-verify.policy"

@Injectable()
/**
 * The daily verify of every backup data set: the newest copy of each driver is verified, restored into ISOLATED scratch stores (memory, never
 * the live stores), exported again and compared with the copy's manifest; the copies are compared with each other. Anything wrong is one item
 * for a person (a dead letter of the job); the verify changes nothing outside, so it declares no effect.
 */
export class DataVerifyService {
    constructor(
        @InjectDataSets() private readonly sets: ReadonlyArray<DataSetDeclaration>,
        @InjectDataStores() private readonly stores: DataStores,
        @InjectDataDrivers() private readonly drivers: DataDrivers,
        @InjectDataOpenContext() private readonly open: OpenContext,
        @InjectDataSpool() private readonly spools: DataSpools,
        @InjectClock() private readonly clock: Clock,
        @InjectLogger() private readonly logger: Logger,
    ) {}

    /** Verifies every backup data set and answers a receipt each; throws ONE typed failure naming the sets with findings (class `input`: retrying a finding proves nothing), a transient one for a driver that could not be reached. */
    async run(job: ClaimedJob): Promise<ReadonlyArray<DataVerifyReceipt>> {
        payloadOfJob(VERIFY_DATA_JOB, job)
        const receipts: Array<DataVerifyReceipt> = []
        await eachInOrder(
            this.sets.filter((candidate) => candidate.purpose === "seed-backup"),
            async (set) => {
                receipts.push(await this.verified(job, set))
            },
        )
        if (receipts.some((receipt) => !receipt.healthy)) throw dataCopyFailure("input", verifyProblemsOf(receipts))
        return receipts
    }

    /** Verifies one set; a refusal of the data package is logged ONCE (job, set, code, retry class, facts) and becomes the job's typed failure. */
    private async verified(job: ClaimedJob, set: DataSetDeclaration): Promise<DataVerifyReceipt> {
        try {
            return await this.verifySet(set)
        } catch (cause) {
            if (!(cause instanceof DataRefusal)) throw cause
            this.logger.error(DataCopiesLogEvent.VerifyRefused, cause, {
                jobId: job.jobId,
                setId: set.id,
                ...refusalLogOf(cause),
            })
            throw dataRefusalFailure(cause)
        }
    }

    /** Verifies the newest copy of each driver of one set and compares the copies with each other. */
    private async verifySet(set: DataSetDeclaration): Promise<DataVerifyReceipt> {
        const drivers = membersOf(this.drivers, set.drivers, "driver", set.id)
        const stores = membersOf(this.stores, set.stores, "store", set.id)
        const verifications: Array<DriverVerification> = []
        await eachInOrder(drivers, async (driver) => {
            verifications.push(await this.verifyDriver(driver, stores))
        })
        const verdicts = verifications.flatMap((found) => (found.verdict === null ? [] : [found.verdict]))
        const differing =
            verdicts.length > 1 ? compareCopies(verdicts).differing.map((difference) => difference.set) : []
        const receipt = verifyReceiptOf(set.id, this.clock.now().toISOString(), verifications, differing)
        this.logger.info(DataCopiesLogEvent.VerifyDone, { ...receipt })
        return receipt
    }

    /** Verifies the newest copy of one driver; a copy that passes the driver's checks is also restored into scratch and compared. */
    private async verifyDriver(
        driver: DriverAdapter,
        stores: ReadonlyArray<StoreAdapter>,
    ): Promise<DriverVerification> {
        const [ref] = await driver.list()
        if (ref === undefined) return missingCopyOf(driver)
        const verdict = await driver.verify(ref, this.open)
        const restore = verdict.healthy ? await this.restoreCheck(driver, verdict, stores) : null
        return verificationOf(driver, ref, verdict, restore)
    }

    /** Restores the copy into scratch stores and compares the scratch export with the copy's manifest; the live stores are never written. */
    private async restoreCheck(
        driver: DriverAdapter,
        verdict: CopyVerdict,
        stores: ReadonlyArray<StoreAdapter>,
    ): Promise<VerifyCheck> {
        const copy = await driver.read(verdict.ref, this.open)
        const scratch = stores.map((store) => memoryStore({ id: store.id, kind: store.kind, level: store.level }))
        const reports = await restoreFrom(copy, scratch, { dryRun: false, mode: "merge" })
        const spool = this.spools.make()
        try {
            const restored = await exportOnce(scratch, {}, spool, copy.manifest)
            return restoreCheckOf(
                restoreMismatches(copy.manifest, restored.manifest),
                reports.some((report) => report.outcome === "partial"),
            )
        } finally {
            await spool.dispose()
        }
    }
}
