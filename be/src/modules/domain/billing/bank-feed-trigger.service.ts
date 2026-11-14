import { Injectable, Optional } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import type { AccountOwner } from "@modules/domain/account-data"
import { bankTransactionTriggerFor } from "@modules/domain/bank-feed-inbox"
import { ConnectionBindingsReadService } from "@modules/domain/connections"
import { ProviderTriggersService } from "@modules/domain/provider-triggers"

/** The movement the delivery job hands on: the row it consumed. */
export interface AdmittedMovement {
    /** The row's type (`sepay.transaction`). */
    readonly type: string
    /** The row id. */
    readonly id: string
    /** The value as stored. */
    readonly value: Readonly<Record<string, unknown>>
}

@Injectable()
/**
 * THE BANK FEED'S ENTRY to the one event pipeline (concept triggers rule 13): a movement admitted as a NEW `<provider>.transaction` row of
 * the account (the INBOX: the provider's transaction id is the row's key, so a webhook and the poll of one movement are one row) is
 * translated by its feed's pure trigger declaration and handed to the ONE delivery function, which applies the account's switch and the
 * declaration's fact key. An account in the provider's test environment hands on nothing. It runs in the delivery's own transaction and
 * catches nothing: a failure to write the wake fails the delivery job (the transaction rolls back, the row stays pending, the runner
 * retries on its ladder and then dead-letters with one item), so a movement is never kept with its wake lost.
 */
export class BankFeedTriggerService {
    constructor(
        private readonly connections: ConnectionBindingsReadService,
        @Optional() private readonly triggers?: ProviderTriggersService,
    ) {}

    /** Hands on the one admitted movement; `row` is the transaction row (its type, its id and its value as stored). */
    async emit(tx: EntityManager, owner: AccountOwner, row: AdmittedMovement): Promise<void> {
        const { triggers } = this
        const declaration = bankTransactionTriggerFor(owner.provider)
        if (triggers === undefined || declaration === null) return
        const state = await this.connections.stateOf(owner.connectionId, tx)
        if (state?.environment === "test") return
        const value = declaration.raw.safeParse(row.value)
        if (!value.success) return
        const event = declaration.translate(value.data, { connectionId: owner.connectionId })
        if (event === null) return
        await triggers.deliver(
            {
                workspaceId: owner.workspaceId,
                declaration,
                connectionId: owner.connectionId,
                agentId: null,
                events: [
                    {
                        event,
                        raw: { type: row.type, id: row.id },
                        ...(event.data.at === undefined ? {} : { occurredAt: event.data.at }),
                    },
                ],
            },
            tx,
        )
    }
}
