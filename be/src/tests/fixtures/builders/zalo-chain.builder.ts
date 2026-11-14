import { Test } from "@nestjs/testing"
import { FakeClock, fakeTransaction, mock, mockEntityManager } from "@starci/jest-preset"
import { AccountDataAdmissionsService, AccountDataIntakeService, AccountDataReadService, type AccountWrite } from "@modules/domain/account-data"
import { ZaloCredentialsService } from "@modules/domain/channels"
import { CHAT_FILES_ASSETS, CHAT_FILES_STORAGE } from "@modules/domain/chat-files/chat-files.decorators"
import { CustomerFilesService } from "@modules/domain/chat-files/customer-files.service"
import { ConnectionsService } from "@modules/domain/connections"
import { InboundEventsService } from "@modules/domain/inbound-events"
import { ProviderTriggersService, type DeliverResult } from "@modules/domain/provider-triggers"
import { ZaloStaleJudgeService } from "@modules/domain/zalo-provider"
import { ZaloDeliveryPolicy } from "@modules/domain/zalo-inbox/zalo-delivery.policy"
import { ZaloInboxService } from "@modules/domain/zalo-inbox/zalo-inbox.service"
import type { StorageAssetsPort, StorageObjectsPort } from "@modules/integrations/object-storage"
import { REMOTE_FILES, type RemoteFileRequest, type RemoteFiles } from "@modules/integrations/remote-files"
import { CLOCK } from "@modules/platform/clock"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { EFFECTS } from "@modules/platform/effects/effects.decorators"
import { ERROR_REPORTER, type ErrorReporter } from "@modules/platform/errors"
import { MESSAGE_CATALOG, type MessageCatalog } from "@modules/platform/i18n"
import { FencedProcessor, type ClaimedJob, type JobClaims, type JobDefinition } from "@modules/platform/jobs"
import { LOGGER, type Logger } from "@modules/platform/logging"
import { QUEUE_OUTBOX } from "@modules/platform/queue"
import { DELIVER_ZALO_JOB, ZALO_DELIVERY_QUEUE, type ZaloDeliveryRecorded } from "@modules/queues/zalo-delivery"
import { keptEffectsLedger } from "./inbound-chain.builder"
import { ZALO_CONNECTION, ZALO_OWNER, zaloEventPendingOf } from "./zalo-inbox.builder"

/** The receipt every spec of the Zalo chain delivers: the picture message `m-2`. */
export const ZALO_DELIVERY: ZaloDeliveryRecorded = { deliveryId: `${ZALO_CONNECTION}:m-2` }

/** The bytes of a JPEG the channel answers for the picture's address. */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])

/** The picture message of a customer: one image with its Zalo address. */
const PICTURE = {
    event_name: "user_send_image",
    sender: { id: "user-1" },
    message: { msg_id: "m-2", text: "ck roi", attachments: [{ type: "image", payload: { url: "https://cdn.test/a.jpg" } }] },
}

/** What the channel answers when the file is there. */
export const channelAnswers = (bytes: Buffer | null, contentType = "image/jpeg", status = 200) => (request: RemoteFileRequest) =>
    Promise.resolve({
        status,
        contentType,
        location: undefined,
        length: bytes?.length ?? 0,
        bytes: bytes !== null && request.accepts(contentType) ? bytes : null,
    })

/** The processor of the delivery job as the feature composes it: the policy fences, the one domain method consumes. */
export class ZaloProcessor extends FencedProcessor {
    override readonly queue = ZALO_DELIVERY_QUEUE
    override readonly definition: JobDefinition<ZaloDeliveryRecorded> = DELIVER_ZALO_JOB
    constructor(
        private readonly policy: ZaloDeliveryPolicy,
        private readonly inbox: ZaloInboxService,
        private readonly claims: JobClaims,
    ) {
        super()
    }
    async process(job: ClaimedJob): Promise<void> {
        await this.policy.run(job, this.claims, this.inbox)
    }
}

/**
 * The real consumer chain (policy, inbox service, the file keeper over the kept-result ledger) over mocked ports. The "database" is
 * `state`: whether the event was completed and how many wakes were written.
 */
export const zaloChain = async (claims: JobClaims, ledger: ReturnType<typeof keptEffectsLedger> = keptEffectsLedger()) => {
    const state = { completed: false, wakes: 0 }
    const pending = zaloEventPendingOf(PICTURE, "m-2")
    const tx = fakeTransaction(mockEntityManager({}))
    const triggers = mock<ProviderTriggersService>()
    triggers.deliver.mockImplementation(() => {
        state.wakes += 1
        return Promise.resolve<DeliverResult>({ status: "delivered", events: 1, dropped: 0, sameFact: 0, woken: [], repeats: 0, untaken: 0, held: 0 })
    })
    const connections = mock<ConnectionsService>()
    connections.intakeOf.mockResolvedValue({ kind: "ok", value: { workspaceId: "w-1" } } as Awaited<ReturnType<ConnectionsService["intakeOf"]>>)
    connections.markReceived.mockResolvedValue(undefined)
    const credentials = mock<ZaloCredentialsService>()
    credentials.load.mockResolvedValue({
        kind: "ok",
        value: { secret: { appId: "app-1", appSecret: "s", oaSecret: "o" }, expiresAt: null, workspaceId: "w-1" },
    })
    const intake = mock<AccountDataIntakeService>()
    intake.write.mockResolvedValue({ owner: ZALO_OWNER, rows: [] } satisfies AccountWrite)
    intake.lockPending.mockImplementation(() => Promise.resolve(state.completed ? null : pending))
    intake.complete.mockImplementation(() => {
        state.completed = true
        return Promise.resolve()
    })
    const reads = mock<AccountDataReadService>()
    reads.get.mockResolvedValue(null)
    const catalog = mock<MessageCatalog>()
    catalog.get.mockReturnValue("Khach Zalo")
    const remote = mock<RemoteFiles>()
    remote.read.mockImplementation(channelAnswers(JPEG))
    const assets = mock<StorageAssetsPort>()
    assets.upload.mockResolvedValue({ error: null })
    const moduleRef = await Test.createTestingModule({
        providers: [
            ZaloInboxService,
            AccountDataAdmissionsService,
            { provide: ZaloStaleJudgeService, useValue: mock<ZaloStaleJudgeService>() },
            ZaloDeliveryPolicy,
            CustomerFilesService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: tx.em },
            { provide: QUEUE_OUTBOX, useValue: { write: jest.fn() } },
            { provide: ProviderTriggersService, useValue: triggers },
            { provide: ConnectionsService, useValue: connections },
            { provide: ZaloCredentialsService, useValue: credentials },
            { provide: MESSAGE_CATALOG, useValue: catalog },
            { provide: InboundEventsService, useValue: mock<InboundEventsService>() },
            { provide: LOGGER, useValue: mock<Logger>() },
            { provide: AccountDataIntakeService, useValue: intake },
            { provide: AccountDataReadService, useValue: reads },
            { provide: CLOCK, useValue: new FakeClock("2026-11-12T08:00:00.000Z") },
            { provide: REMOTE_FILES, useValue: remote },
            { provide: CHAT_FILES_STORAGE, useValue: mock<StorageObjectsPort>() },
            { provide: CHAT_FILES_ASSETS, useValue: assets },
            { provide: EFFECTS, useValue: ledger.effects },
            { provide: ERROR_REPORTER, useValue: mock<ErrorReporter>() },
        ],
    }).compile()
    const processor = new ZaloProcessor(moduleRef.get(ZaloDeliveryPolicy), moduleRef.get(ZaloInboxService), claims)
    return { processor, state, tx, triggers, remote, assets, intake, ledger }
}
