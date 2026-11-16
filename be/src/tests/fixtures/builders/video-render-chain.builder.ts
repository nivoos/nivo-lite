import { Test } from "@nestjs/testing"
import { fakeTransaction, mock, mockEntityManager } from "@starci/jest-preset"
import { AccountDataIntakeService, type PendingRow } from "@modules/domain/account-data"
import { ConnectionBindingsReadService } from "@modules/domain/connections"
import { ProviderTriggersService } from "@modules/domain/provider-triggers"
import { VideoRenderDeliveryService } from "@modules/domain/video-compose/video-render-delivery.service"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import { LOGGER, type Logger } from "@modules/platform/logging"
import { DELIVER_VIDEO_RENDER_JOB, type VideoRenderDeliveryRecorded } from "@modules/queues/video-render-delivery"
import { FAKE_COMPOSE, FAKE_OUTPUT } from "./video-compose.builder"

/** The kept completion every spec of the render chain delivers. */
export const RENDER_DELIVERY: VideoRenderDeliveryRecorded = { provider: FAKE_COMPOSE, connectionId: "conn-1", key: "r-1" }

const OWNER = { provider: FAKE_COMPOSE, connectionId: "conn-1", workspaceId: "ws-1" }

/** The row the render door kept: the stored value of a finished render. */
const KEPT: PendingRow = {
    id: "row-r-1",
    type: `${FAKE_COMPOSE}.render`,
    key: "r-1",
    owner: OWNER,
    value: { renderId: "r-1", status: "done", outputUrl: FAKE_OUTPUT, provider: FAKE_COMPOSE },
}

/** The processor of the delivery job as the feature composes it: one domain method, the runner judges every failure. */
export class RenderProcessor extends FencedProcessor {
    override readonly queue = "video-render-delivery"
    override readonly definition: JobDefinition<VideoRenderDeliveryRecorded> = DELIVER_VIDEO_RENDER_JOB
    constructor(private readonly renders: VideoRenderDeliveryService) {
        super()
    }
    async process(job: ClaimedJob): Promise<void> {
        await this.renders.deliver(job)
    }
}

/** The real delivery service over mocked ports; the "database" is whether the row was completed and how many wakes were written. */
export const renderChain = async () => {
    const state = { completed: false, wakes: 0 }
    const tx = fakeTransaction(mockEntityManager())
    const intake = mock<AccountDataIntakeService>()
    intake.lockPending.mockImplementation(() => Promise.resolve(state.completed ? null : KEPT))
    intake.complete.mockImplementation(() => {
        state.completed = true
        return Promise.resolve()
    })
    const bindings = mock<ConnectionBindingsReadService>()
    bindings.accountOf.mockResolvedValue(OWNER)
    const triggers = mock<ProviderTriggersService>()
    triggers.deliver.mockImplementation(() => {
        state.wakes += 1
        return Promise.resolve({ status: "delivered", events: 1, dropped: 0, sameFact: 0, woken: [], repeats: 0, untaken: 0, held: 0 })
    })
    const moduleRef = await Test.createTestingModule({
        providers: [
            VideoRenderDeliveryService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: tx.em },
            { provide: LOGGER, useValue: mock<Logger>() },
            { provide: ConnectionBindingsReadService, useValue: bindings },
            { provide: AccountDataIntakeService, useValue: intake },
            { provide: ProviderTriggersService, useValue: triggers },
        ],
    }).compile()
    return { service: moduleRef.get(VideoRenderDeliveryService), processor: new RenderProcessor(moduleRef.get(VideoRenderDeliveryService)), state, tx, intake, bindings, triggers }
}
