import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { InjectClock, type Clock } from "@modules/platform/clock"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import { eachInOrder } from "@modules/platform/primitives"
import { DataCopiesQueue } from "@modules/queues/data-copies"
import type { DataSetDeclaration } from "./data-copies.contracts"
import { InjectDataSets } from "./data-copies.decorators"
import { backupSlotOf } from "./data-backup-config.policy"

@Injectable()
/**
 * The hourly tick's work: one backup job for each data set of purpose `seed-backup`, in the slot its schedule is in now. The once key is the set
 * and the slot, so a second tick inside the same period writes the same outbox key and queues nothing more.
 */
export class DataBackupDueService {
    constructor(
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
        @InjectClock() private readonly clock: Clock,
        @InjectDataSets() private readonly sets: ReadonlyArray<DataSetDeclaration>,
        private readonly queue: DataCopiesQueue,
    ) {}

    /** Queues the backup of every backup data set for its current slot, in one transaction; answers how many it named. */
    queueDue(): Promise<number> {
        const now = this.clock.now()
        const due = this.sets.filter((set) => set.purpose === "seed-backup")
        return this.entityManager.transaction(async (tx) => {
            await eachInOrder(due, (set) =>
                this.queue.enqueueBackup({ setId: set.id, slot: backupSlotOf(set, now) }, tx),
            )
            return due.length
        })
    }
}
