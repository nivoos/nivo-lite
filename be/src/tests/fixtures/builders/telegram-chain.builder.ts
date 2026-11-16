import { Test } from "@nestjs/testing"
import { FakeClock, fakeTransaction, mock, mockEntityManager } from "@starci/jest-preset"
import { AccountDataAdmissionsService, AccountDataIntakeService, type AccountWrite, type PendingRow } from "@modules/domain/account-data"
import { CHAT_FILES_ASSETS, CHAT_FILES_STORAGE } from "@modules/domain/chat-files/chat-files.decorators"
import { CustomerFilesService } from "@modules/domain/chat-files/customer-files.service"
import { ConnectionSecretReadsService, ConnectionsService } from "@modules/domain/connections"
import { InboundEventsService } from "@modules/domain/inbound-events"
import { ProviderTriggersService, type DeliverResult } from "@modules/domain/provider-triggers"
import { TelegramDeliveryService } from "@modules/domain/telegram-inbox/telegram-delivery.service"
import { TELEGRAM_RECEIPT_PROCESSOR } from "@modules/domain/telegram-inbox/telegram-inbox.decorators"
import { TelegramFilesService } from "@modules/domain/telegram-inbox/telegram-files.service"
import { TelegramInboxService } from "@modules/domain/telegram-inbox/telegram-inbox.service"
import type { StorageAssetsPort, StorageObjectsPort } from "@modules/integrations/object-storage"
import { REMOTE_FILES, type RemoteFiles } from "@modules/integrations/remote-files"
import { TELEGRAM, type TelegramClient } from "@modules/integrations/telegram"
import { CLOCK } from "@modules/platform/clock"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { EFFECTS } from "@modules/platform/effects/effects.decorators"
import { ERROR_REPORTER, type ErrorReporter } from "@modules/platform/errors"
import { FencedProcessor, JOB_CLAIMS, type ClaimedJob, type JobClaims, type JobDefinition } from "@modules/platform/jobs"
import { LOGGER, type Logger } from "@modules/platform/logging"
import { QUEUE_OUTBOX } from "@modules/platform/queue"
import { DELIVER_TELEGRAM_JOB, TELEGRAM_DELIVERY_QUEUE, type TelegramDeliveryRecorded } from "@modules/queues/telegram-delivery"
import { channelAnswers } from "./zalo-chain.builder"
import { keptEffectsLedger } from "./inbound-chain.builder"

const CONNECTION = "0b1d52a4-8f3e-4c8a-9a64-4f0d2f6e7a11"
const OWNER = { provider: "telegram", connectionId: CONNECTION, workspaceId: "w-1" }

/** The receipt every spec of the Telegram chain delivers: the photo update `80`. */
export const TELEGRAM_DELIVERY: TelegramDeliveryRecorded = { deliveryId: `${CONNECTION}:80` }

/** The bytes of a JPEG the channel answers for the photo's address. */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])

const PHOTO_UPDATE = {
    update_id: 80,
    message: {
        message_id: 11,
        date: 1_762_850_000,
        chat: { id: 555 },
        caption: "This one",
        photo: [{ file_id: "large", file_unique_id: "l", width: 1280, height: 960 }],
    },
}

const PENDING: PendingRow = { id: "row-1", type: "telegram.update", key: "80", owner: OWNER, value: { updateId: "80", raw: PHOTO_UPDATE } }

/** The processor of the delivery job as the feature composes it: one domain method, the runner judges every failure. */
export class TelegramProcessor extends FencedProcessor {
    override readonly queue = TELEGRAM_DELIVERY_QUEUE
    override readonly definition: JobDefinition<TelegramDeliveryRecorded> = DELIVER_TELEGRAM_JOB
    constructor(private readonly delivery: TelegramDeliveryService) {
        super()
    }
    async process(job: ClaimedJob): Promise<void> {
        await this.delivery.process(job)
    }
}

/**
 * The real consumer chain (delivery service, inbox service, the file addresses and the file keeper over the kept-result ledger) over
 * mocked ports. The "database" is `state`: whether the update was completed and how many wakes were written.
 */
export const telegramChain = async (claims: JobClaims, ledger: ReturnType<typeof keptEffectsLedger> = keptEffectsLedger()) => {
    const state = { completed: false, wakes: 0 }
    const tx = fakeTransaction(mockEntityManager({}))
    const triggers = mock<ProviderTriggersService>()
    triggers.deliver.mockImplementation(() => {
        state.wakes += 1
        return Promise.resolve<DeliverResult>({ status: "delivered", events: 1, dropped: 0, sameFact: 0, woken: [], repeats: 0, untaken: 0, held: 0 })
    })
    const connections = mock<ConnectionsService>()
    connections.intakeOf.mockResolvedValue({ kind: "ok", value: { workspaceId: "w-1" } } as Awaited<ReturnType<ConnectionsService["intakeOf"]>>)
    connections.markReceived.mockResolvedValue(undefined)
    const secrets = mock<ConnectionSecretReadsService>()
    secrets.secretOf.mockResolvedValue({ kind: "ok", value: { workspaceId: "w-1", credential: "123456:bot-token", webhookSecret: "hook", tokenExpiresAt: null } })
    const telegram = mock<TelegramClient>()
    telegram.fileUrl.mockImplementation((_token, fileId) => Promise.resolve(`https://telegram.test/file/${fileId}.jpg`))
    const intake = mock<AccountDataIntakeService>()
    intake.write.mockResolvedValue({ owner: OWNER, rows: [] } satisfies AccountWrite)
    intake.lockPending.mockImplementation(() => Promise.resolve(state.completed ? null : PENDING))
    intake.complete.mockImplementation(() => {
        state.completed = true
        return Promise.resolve()
    })
    const remote = mock<RemoteFiles>()
    remote.read.mockImplementation(channelAnswers(JPEG))
    const assets = mock<StorageAssetsPort>()
    assets.upload.mockResolvedValue({ error: null })
    const moduleRef = await Test.createTestingModule({
        providers: [
            TelegramInboxService,
            TelegramDeliveryService,
            TelegramFilesService,
            AccountDataAdmissionsService,
            CustomerFilesService,
            { provide: TELEGRAM_RECEIPT_PROCESSOR, useExisting: TelegramInboxService },
            { provide: JOB_CLAIMS, useValue: claims },
            { provide: PRIMARY_ENTITY_MANAGER, useValue: tx.em },
            { provide: QUEUE_OUTBOX, useValue: { write: jest.fn() } },
            { provide: ProviderTriggersService, useValue: triggers },
            { provide: ConnectionsService, useValue: connections },
            { provide: ConnectionSecretReadsService, useValue: secrets },
            { provide: TELEGRAM, useValue: telegram },
            { provide: InboundEventsService, useValue: mock<InboundEventsService>() },
            { provide: AccountDataIntakeService, useValue: intake },
            { provide: CLOCK, useValue: new FakeClock("2026-11-12T08:00:00.000Z") },
            { provide: LOGGER, useValue: mock<Logger>() },
            { provide: REMOTE_FILES, useValue: remote },
            { provide: CHAT_FILES_STORAGE, useValue: mock<StorageObjectsPort>() },
            { provide: CHAT_FILES_ASSETS, useValue: assets },
            { provide: EFFECTS, useValue: ledger.effects },
            { provide: ERROR_REPORTER, useValue: mock<ErrorReporter>() },
        ],
    }).compile()
    return { processor: new TelegramProcessor(moduleRef.get(TelegramDeliveryService)), state, tx, triggers, telegram, remote, assets, intake, ledger }
}
