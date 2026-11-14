import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { AccountDataAdmissionsService, AccountDataIntakeService } from "@modules/domain/account-data"
import type { ConnectionRecord } from "@modules/domain/connections"
import type { PolledRow } from "@modules/domain/provider-registry"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import { eachInOrder } from "@modules/platform/primitives"
import { inTimeOrder } from "./connection-poll.policy"

@Injectable()
/**
 * THE GENERIC STORE OF THE ONE POLL JOB (owner R95; account-data rules 2, 7, 10): what a provider's poll receiver read is written through
 * THE ONE INTAKE, one row per transaction, in the provider's TIME ORDER (oldest first, whatever order the pages came in): a row the intake
 * answers as NEW is the signal and goes to its type's ADMISSION in the same transaction (the same road the provider's webhook door takes
 * after its claim); a row already kept (the webhook, or an earlier poll, brought it first) is nothing. No provider code writes here.
 */
export class PollReceiptsService {
    constructor(
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
        private readonly intake: AccountDataIntakeService,
        private readonly admissions: AccountDataAdmissionsService,
    ) {}

    /** Keeps the rows of one walk of one account as rows of `dataType`; answers how many were new (the ones no other way had delivered). */
    async keep(account: ConnectionRecord, dataType: string, rows: ReadonlyArray<PolledRow>): Promise<number> {
        let fresh = 0
        await eachInOrder(inTimeOrder(rows), async (row) => {
            if (await this.entityManager.transaction((tx) => this.keepOne(tx, account, dataType, row))) fresh += 1
        })
        return fresh
    }

    /** Writes one row; a new one is admitted in the same transaction. True when it was new. */
    private async keepOne(tx: EntityManager, account: ConnectionRecord, dataType: string, row: PolledRow): Promise<boolean> {
        const written = await this.intake.write(tx, account.id, [{ type: dataType, value: row.value }])
        const [kept] = written.rows
        if (written.owner === null || kept?.isNew !== true) return false
        await this.admissions.admit(tx, { id: kept.id, type: kept.type, key: kept.key, owner: written.owner, value: row.value })
        return true
    }
}
