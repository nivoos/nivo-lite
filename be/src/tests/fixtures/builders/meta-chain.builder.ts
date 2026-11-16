import { Test } from "@nestjs/testing"
import { fakeTransaction, mock, mockEntityManager, recordingQueueOutbox } from "@starci/jest-preset"
import { AccountDataIntakeService, AccountDataReadService, type PendingRow } from "@modules/domain/account-data"
import { ConnectionsService } from "@modules/domain/connections"
import { InboundEventsService } from "@modules/domain/inbound-events"
import { MetaCommentsService } from "@modules/domain/meta-comments"
import { MetaDeliveryService } from "@modules/domain/meta-inbox/meta-delivery.service"
import { META_RECEIPT_PROCESSOR } from "@modules/domain/meta-inbox/meta-inbox.decorators"
import { MetaInboxService } from "@modules/domain/meta-inbox/meta-inbox.service"
import { MetaReceiptPolicy } from "@modules/domain/meta-inbox/meta-receipt.policy"
import { MetaThreadsService } from "@modules/domain/meta-threads"
import { ProviderTriggersService, type DeliverResult } from "@modules/domain/provider-triggers"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { MESSAGE_CATALOG, type MessageCatalog } from "@modules/platform/i18n"
import { FencedProcessor, JOB_CLAIMS, type ClaimedJob, type JobClaims, type JobDefinition } from "@modules/platform/jobs"
import { LOGGER, type Logger } from "@modules/platform/logging"
import { QUEUE_OUTBOX } from "@modules/platform/queue"
import { DELIVER_META_JOB, META_DELIVERY_QUEUE, type MetaDeliveryRecorded } from "@modules/queues/meta-delivery"
import type { MetaInboundJob } from "@modules/domain/meta-inbox/meta-inbox.contracts"
import { META_INBOUND_JOB, META_INBOUND_QUEUE, type MetaInboundPayload } from "@modules/queues/meta-inbound"
import { OWNER, event } from "./meta-inbox.builder"

/** The connection a queued delivery id names (a uuid) and the account its pending rows belong to. */
const CONNECTION = "0b9a3c1e-5d7f-4a2b-9c8d-1e2f3a4b5c6d"
const ACCOUNT = { provider: "meta", connectionId: OWNER.id, workspaceId: OWNER.workspaceId }

/** The receipt of the first job of the chain: the stored direct message `dm:message-1`. */
export const META_RECEIPT: MetaDeliveryRecorded = { deliveryId: `${CONNECTION}:dm:message-1` }

/** The handoff the first job writes and the second job delivers. */
export const META_HANDOFF: MetaInboundJob = { connectionId: OWNER.id, workspaceId: OWNER.workspaceId, event: event() }

const PENDING: PendingRow = { id: "row-1", type: "meta.event", key: "dm:message-1", owner: ACCOUNT, value: { eventKey: "dm:message-1", raw: event() } }

/** The processor of the receipt job as the feature composes it. */
export class MetaReceiptJobProcessor extends FencedProcessor {
    override readonly queue = META_DELIVERY_QUEUE
    override readonly definition: JobDefinition<MetaDeliveryRecorded> = DELIVER_META_JOB
    constructor(private readonly delivery: MetaDeliveryService) {
        super()
    }
    async process(job: ClaimedJob): Promise<void> {
        await this.delivery.process(job)
    }
}

/** The processor of the handoff job as the feature composes it. */
export class MetaHandoffProcessor extends FencedProcessor {
    override readonly queue = META_INBOUND_QUEUE
    override readonly definition: JobDefinition<MetaInboundPayload> = META_INBOUND_JOB
    constructor(private readonly inbox: MetaInboxService) {
        super()
    }
    async process(job: ClaimedJob): Promise<void> {
        await this.inbox.deliverPayload(job)
    }
}

/**
 * The real two-job chain (receipt consumer, handoff) over mocked ports. The "database" is `state`: whether the receipt row was completed,
 * the handoff jobs the receipt job wrote in its own transaction, and the wakes the handoff job delivered.
 */
export const metaChain = async (claims: JobClaims) => {
    const state = { completed: false, wakes: 0 }
    const tx = fakeTransaction(mockEntityManager({}))
    const outbox = recordingQueueOutbox()
    const write = jest.spyOn(outbox, "write")
    const connections = mock<ConnectionsService>()
    connections.intakeOf.mockResolvedValue({ kind: "ok", value: { workspaceId: "workspace-1" } } as Awaited<ReturnType<ConnectionsService["intakeOf"]>>)
    connections.recordEvent.mockResolvedValue(null)
    const triggers = mock<ProviderTriggersService>()
    triggers.deliver.mockImplementation(() => {
        state.wakes += 1
        return Promise.resolve<DeliverResult>({ status: "delivered", events: 1, dropped: 0, sameFact: 0, woken: [], repeats: 0, untaken: 0, held: 0 })
    })
    const reads = mock<AccountDataReadService>()
    reads.get.mockResolvedValue({ id: "row-9", type: "meta.event", typeVersion: 1, key: "dm:message-1", value: {}, occurredAt: new Date("2026-11-12T00:00:00.000Z"), processedAt: null })
    const catalog = mock<MessageCatalog>()
    catalog.get.mockImplementation((key: string) => key)
    const threads = mock<MetaThreadsService>()
    threads.touch.mockResolvedValue(undefined)
    const intake = mock<AccountDataIntakeService>()
    intake.write.mockResolvedValue({ owner: ACCOUNT, rows: [] })
    intake.lockPending.mockImplementation(() => Promise.resolve(state.completed ? null : PENDING))
    intake.complete.mockImplementation(() => {
        state.completed = true
        return Promise.resolve()
    })
    const moduleRef = await Test.createTestingModule({
        providers: [
            MetaInboxService,
            MetaDeliveryService,
            { provide: META_RECEIPT_PROCESSOR, useExisting: MetaInboxService },
            { provide: JOB_CLAIMS, useValue: claims },
            { provide: MetaReceiptPolicy, useValue: mock<MetaReceiptPolicy>() },
            { provide: PRIMARY_ENTITY_MANAGER, useValue: tx.em },
            { provide: AccountDataIntakeService, useValue: intake },
            { provide: QUEUE_OUTBOX, useValue: outbox },
            { provide: ConnectionsService, useValue: connections },
            { provide: ProviderTriggersService, useValue: triggers },
            { provide: AccountDataReadService, useValue: reads },
            { provide: InboundEventsService, useValue: mock<InboundEventsService>() },
            { provide: MESSAGE_CATALOG, useValue: catalog },
            { provide: MetaThreadsService, useValue: threads },
            { provide: MetaCommentsService, useValue: mock<MetaCommentsService>() },
            { provide: LOGGER, useValue: mock<Logger>() },
        ],
    }).compile()
    return {
        receiptProcessor: new MetaReceiptJobProcessor(moduleRef.get(MetaDeliveryService)),
        handoffProcessor: new MetaHandoffProcessor(moduleRef.get(MetaInboxService)),
        state,
        tx,
        write,
        triggers,
        connections,
        intake,
    }
}
