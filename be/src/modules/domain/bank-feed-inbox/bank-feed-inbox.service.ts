import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { AccountDataAdmissionsService, AccountDataIntakeService, scopedDeliveryIdOf } from "@modules/domain/account-data"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import type { BankFeedProvider, BankMovementLookup, IncomingCredit, PendingBankMovement } from "./bank-feed-inbox.contracts"
import { BankFeedInboxLogEvent } from "./bank-feed-inbox.log-events"
import { feedTransactionRowsOf, transactionTypeOf, type BankMovementSource } from "./bank-feed.normalise.policy"

@Injectable()
/**
 * Keeps the movements a bank door's webhook delivers as `<provider>.transaction` rows of the account of their connection, keyed by the
 * provider's own transaction id (its unique key is the dedupe: a webhook and the poll of one movement are one row), each NEW row admitted
 * in the same transaction (its job marks the account fed and hands the movement to its trigger), and consumes the pending row.
 */
export class BankFeedReceiptService {
    constructor(
        private readonly intake: AccountDataIntakeService,
        private readonly admissions: AccountDataAdmissionsService,
        @InjectLogger() private readonly logger: Logger,
    ) {}

    /** Keeps each movement once in the caller's transaction and admits the new ones; answers how many were new. A connection nobody holds keeps nothing. */
    async keep(
        manager: EntityManager,
        door: BankFeedProvider,
        connection: string,
        credits: ReadonlyArray<IncomingCredit>,
        source: BankMovementSource,
    ): Promise<number> {
        const rows = feedTransactionRowsOf(door, credits, source)
        const written = await this.intake.write(manager, connection, rows)
        if (written.owner === null) return this.unknown(door, connection)
        let fresh = 0
        for (const [index, kept] of written.rows.entries()) {
            const input = rows[index]
            if (!kept.isNew || input === undefined) continue
            await this.admissions.admit(manager, { id: kept.id, type: kept.type, key: kept.key, owner: written.owner, value: input.value })
            fresh += 1
        }
        return fresh
    }

    /** Locks a pending movement until its consumption and completion commit together; undefined when it is absent or already complete. */
    async lock(manager: EntityManager, door: BankFeedProvider, deliveryId: string): Promise<BankMovementLookup> {
        const scoped = scopedDeliveryIdOf(deliveryId)
        if (scoped === null) return undefined
        const row = await this.intake.lockPending(manager, transactionTypeOf(door), scoped.connectionId, scoped.externalId)
        if (row === null) return undefined
        return { value: row.value, owner: row.owner, row }
    }

    /** Completes the locked movement in the caller's transaction. */
    complete(manager: EntityManager, movement: PendingBankMovement): Promise<void> {
        return this.intake.complete(manager, movement.row)
    }

    /** Logs a movement whose connection nobody holds; it is not kept. */
    private unknown(door: BankFeedProvider, connection: string): number {
        this.logger.warn(BankFeedInboxLogEvent.UnknownConnection, { provider: door, connection })
        return 0
    }
}
