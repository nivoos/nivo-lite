import { Injectable } from "@nestjs/common"
import { IsNull, type EntityManager } from "typeorm"
import { ConnectionBindingsReadService } from "@modules/domain/connections"
import { eachInOrder } from "@modules/platform/primitives"
import type {
    AccountDataInput,
    AccountDelivery,
    ClaimedDelivery,
    AccountOwner,
    CheckedRow,
    AccountWrite,
    OptionalPendingRow,
    PendingPhases,
    PendingRow,
    PendingRowKey,
    WrittenRow,
} from "./account-data.contracts"
import { accountExternalIdOf, insertedIdOf, isConnectionId, valueOf } from "./account-data.policy"
import { AccountDataTypesService } from "./account-data-types.service"
import { checkedRowOf, rowValuesOf } from "./account-data-value.policy"
import { AccountDataErrorCode } from "./errors/account-data.error"
import { AccountDataEntity } from "./persistence/entities"



/**
 * Checks one input of the intake: the type must be declared and the connection's provider's, or the provider of a half the account holds
 * (a mailbox `smtp` account writes its inbound `imap` half's `imap.mail`) (else TYPE_UNDECLARED), not `advance` (WRITE_MODE).
 */
const readyRowOf = (
    types: AccountDataTypesService,
    owner: AccountOwner,
    halves: ReadonlyArray<string>,
    input: AccountDataInput,
): CheckedRow => {
    const declared = types.of(input.type)?.provider ?? null
    const writer = declared !== null && halves.includes(declared) ? declared : owner.provider
    return checkedRowOf(types.declaredAs(input.type, ["append", "overwrite"], writer), input.value)
}

@Injectable()
/**
 * THE one intake of account data. A door (webhook or poll) and a consumer hand it the connection id and the rows its normaliser made;
 * the account is resolved here, in the caller's transaction, every row is checked against its declaration before anything is written,
 * and then each is written in order: `append` inserts once (the unique key IS the dedupe; a row inserted IS new), `overwrite` upserts
 * by key (latest value wins). Nothing of a value is ever logged.
 */
export class AccountDataIntakeService {
    constructor(
        private readonly bindings: ConnectionBindingsReadService,
        private readonly types: AccountDataTypesService,
    ) {}

    /**
     * Writes the rows for the connection's account, in `tx`, in order. A connection id that is no uuid, or that nobody holds, writes
     * nothing: `{ owner: null, rows: [] }`. A duplicate `append` row answers `isNew: false` and id "" (the insert-or-ignore returns no
     * row for it, and reading its id would cost a query).
     */
    async write(
        tx: EntityManager,
        connectionId: string,
        inputs: ReadonlyArray<AccountDataInput>,
    ): Promise<AccountWrite> {
        if (!isConnectionId(connectionId)) return { owner: null, rows: [] }
        const account = await this.bindings.accountOf(connectionId, tx)
        if (account === null) return { owner: null, rows: [] }
        const owner: AccountOwner = { provider: account.provider, connectionId, workspaceId: account.workspaceId }
        const ready = inputs.map((input) => readyRowOf(this.types, owner, account.halves ?? [], input))
        const rows: Array<WrittenRow> = []
        await eachInOrder(ready, async (row) => {
            rows.push(await (row.def.write === "append" ? this.append(tx, owner, row) : this.overwrite(tx, owner, row)))
        })
        return { owner, rows }
    }

    /**
     * Claims one delivery of a door, the way a receipt transaction claims its inbox key: the delivery's row is written once under the
     * provider's own key, in `tx`, before anything else happens. It answers the row when the delivery is new, and undefined on a repeat
     * (the row is already stored) or when no account holds the connection: the door returns at once and queues nothing.
     */
    async claim(tx: EntityManager, delivery: AccountDelivery): Promise<ClaimedDelivery> {
        const written = await this.write(tx, delivery.connectionId, [{ type: delivery.type, value: delivery.value }])
        const [row] = written.rows
        return row?.isNew === true ? row : undefined
    }

    /** The pending row of a `wakes` type, locked FOR UPDATE until the transaction ends; null when absent or already completed. */
    lockPending(tx: EntityManager, type: string, connectionId: string, key: string): Promise<OptionalPendingRow> {
        return this.pendingRow(tx, type, connectionId, key, true)
    }

    /**
     * The pending row of a `wakes` type as it stands, WITHOUT a lock: what a delivery job reads to PREPARE its delivery before any
     * transaction is open (concept outbox-job rule 12); its commit takes the row again with `lockPending`, which answers null when another
     * delivery completed it meanwhile. The value of a stored row never changes, so what was prepared from it holds.
     */
    pendingOf(manager: EntityManager, type: string, connectionId: string, key: string): Promise<OptionalPendingRow> {
        return this.pendingRow(manager, type, connectionId, key, false)
    }

    /**
     * Consumes one pending row of a `wakes` type in TWO phases (concept outbox-job rule 12): the row read as it stands and `prepare`d with
     * no transaction open, then ONE short transaction on `manager`'s pool: the row locked again (gone: another consumer completed it
     * meanwhile, nothing more is written), `commit`, the row completed. A throw leaves the row pending for the consumer's job runner.
     */
    async consumePending<Prepared>(
        manager: EntityManager,
        row: PendingRowKey,
        phases: PendingPhases<Prepared>,
    ): Promise<void> {
        const seen = await this.pendingOf(manager, row.type, row.connectionId, row.key)
        if (seen === null) return
        const prepared = await phases.prepare(seen)
        await manager.transaction(async (tx) => {
            const pending = await this.lockPending(tx, row.type, row.connectionId, row.key)
            if (pending === null) return
            await phases.commit(tx, pending, prepared)
            await this.complete(tx, pending)
        })
    }

    private async pendingRow(
        manager: EntityManager,
        type: string,
        connectionId: string,
        key: string,
        locked: boolean,
    ): Promise<OptionalPendingRow> {
        const def = this.types.declared(type)
        if (def.wakes !== true) throw this.types.wiring(AccountDataErrorCode.WriteMode, type, def.provider ?? "")
        const row = await manager.findOne(AccountDataEntity, {
            where: { type, connectionId, key: accountExternalIdOf(key), processedAt: IsNull() },
            ...(locked ? { lock: { mode: "pessimistic_write" as const } } : {}),
        })
        if (row === null) return null
        return {
            id: row.id,
            type: row.type,
            key: row.key,
            owner: { provider: row.provider, connectionId: row.connectionId, workspaceId: row.workspaceId },
            value: valueOf(row.value),
        }
    }

    /** Completes a locked row in the caller's transaction: `processed_at` on the database clock. */
    async complete(tx: EntityManager, pending: PendingRow): Promise<void> {
        await tx.update(AccountDataEntity, { type: pending.type, id: pending.id }, { processedAt: () => "now()" })
    }

    /** Inserts the row once; a row already stored under its key is left as it is. */
    private async append(tx: EntityManager, owner: AccountOwner, row: CheckedRow): Promise<WrittenRow> {
        const inserted = await tx
            .createQueryBuilder(AccountDataEntity, "r")
            .insert()
            .values(rowValuesOf(owner, row))
            .orIgnore()
            .returning("id")
            .execute()
        const id = insertedIdOf(inserted.raw)
        return { type: row.def.name, key: row.key, id: id ?? "", isNew: id !== null }
    }

    /**
     * Inserts the row, or replaces the value, version and time of the row stored under its key. Two statements, never one upsert that
     * reads a system column: PostgreSQL refuses `xmax` in the RETURNING of a partitioned table. The insert-or-ignore says whether the
     * row is new; only a row that already existed is updated, and a concurrent writer of the same key is serialised by the unique key.
     */
    private async overwrite(tx: EntityManager, owner: AccountOwner, row: CheckedRow): Promise<WrittenRow> {
        const appended = await this.append(tx, owner, row)
        if (appended.isNew) return appended
        await tx.update(
            AccountDataEntity,
            { type: row.def.name, connectionId: owner.connectionId, key: row.key },
            {
                value: row.value,
                typeVersion: row.def.version,
                occurredAt: row.occurredAt ?? ((): string => "now()"),
            },
        )
        return { type: row.def.name, key: row.key, id: "", isNew: false }
    }
}
