import { Test } from "@nestjs/testing"
import { fakeInbox, fakeTransaction, mock, mockEntityManager, recordingQueueOutbox } from "@starci/jest-preset"
import { PaymentProofService, parseJsonObject } from "@modules/domain/billing"
import { PaymentOrdersService } from "@modules/domain/payment-orders"
import { SepayTransactionEntity } from "@modules/domain/sepay-transactions/persistence/entities"
import { SepayTransactionsService } from "@modules/domain/sepay-transactions/sepay-transactions.service"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { INBOX } from "@modules/platform/inbox"
import { FencedProcessor, type ClaimedJob, type JobClaims, type JobDefinition } from "@modules/platform/jobs"
import { QUEUE_OUTBOX } from "@modules/platform/queue"
import { DELIVER_SEPAY_JOB, SEPAY_DELIVERY_QUEUE, type SepayDeliveryRecorded } from "@modules/queues/sepay-delivery"

/** The receipt every spec of the SePay chain consumes. */
export const SEPAY_DELIVERY: SepayDeliveryRecorded = { deliveryId: "9001" }

const SETTLE_PAYMENT_ORDER = 'SELECT * FROM "public"."settle_payment_order"($1, $2, $3)'

/** The transfer SePay delivered: a credit that names the order code NIVO8F3K2. */
const TRANSFER = {
    id: 9001,
    gateway: "MBBank",
    transferType: "in",
    transferAmount: 990000,
    content: "nivo 8f3k2 chuyen tien",
    description: "BankAPINotify NIVO8F3K2",
    code: null,
}

/** The processor of the delivery job as the feature composes it: the settlement fences, the runner judges every failure. */
export class SepayProcessor extends FencedProcessor {
    override readonly queue = SEPAY_DELIVERY_QUEUE
    override readonly definition: JobDefinition<SepayDeliveryRecorded> = DELIVER_SEPAY_JOB
    constructor(
        private readonly settlement: SepayTransactionsService,
        private readonly claims: JobClaims,
    ) {
        super()
    }
    async process(job: ClaimedJob): Promise<void> {
        await this.settlement.processClaimedDelivery(job, this.claims)
    }
}

/**
 * The real settlement over a fake transaction. The "database" is `state`: the receipt is pending until its completion write commits, and
 * `settles` counts the SQL settlements that committed (a rolled-back one is counted in `attempts`).
 */
export const sepayChain = async (claims: JobClaims) => {
    const state = { processed: false, settles: 0, attempts: 0 }
    const pending = Object.assign(new SepayTransactionEntity(), { id: "row-1", payload: parseJsonObject(Buffer.from(JSON.stringify(TRANSFER))) })
    const tx = fakeTransaction(
        mockEntityManager({
            findOne: [SepayTransactionEntity, pending],
            update: [SepayTransactionEntity, { affected: 1 }],
            query: [SETTLE_PAYMENT_ORDER, [{ settle_payment_order: "settled" }]],
        }),
    )
    tx.em.findOne.mockImplementation(() => Promise.resolve(state.processed ? null : pending))
    tx.em.query.mockImplementation(() => {
        state.attempts += 1
        state.settles += 1
        return Promise.resolve([{ settle_payment_order: "settled" }])
    })
    tx.em.update.mockImplementation((_entity: unknown, _where: unknown, patch: unknown) => {
        if (typeof patch === "object" && patch !== null && "processedAt" in patch) state.processed = true
        return Promise.resolve({ affected: 1, raw: [], generatedMaps: [] })
    })
    const moduleRef = await Test.createTestingModule({
        providers: [
            SepayTransactionsService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: tx.em },
            { provide: PaymentProofService, useValue: mock<PaymentProofService>() },
            { provide: INBOX, useValue: fakeInbox() },
            { provide: QUEUE_OUTBOX, useValue: recordingQueueOutbox() },
            { provide: PaymentOrdersService, useValue: mock<PaymentOrdersService>() },
        ],
    }).compile()
    const settlement = moduleRef.get(SepayTransactionsService)
    return { processor: new SepayProcessor(settlement, claims), processorWith: (other: JobClaims) => new SepayProcessor(settlement, other), state, tx }
}
