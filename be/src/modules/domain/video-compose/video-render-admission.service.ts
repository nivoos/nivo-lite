import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { AccountDataAdmissionsService, type AccountAdmission, type AdmittedRow } from "@modules/domain/account-data"
import { InjectQueueOutbox, type QueueOutbox } from "@modules/platform/queue"
import { DELIVER_VIDEO_RENDER_JOB, type VideoRenderDeliveryRecorded } from "@modules/queues/video-render-delivery"
import { VideoComposeRegistryService } from "./video-compose-registry.service"
import { renderTypeOf } from "./video-render-data.policy"

@Injectable()
/**
 * WHAT A NEW `<provider>.render` ROW DOES NEXT (account-data rule 7): the one admission of every compose provider's render type. The row
 * the intake just kept is handed to the one delivery function by a job written in the SAME transaction (`VideoRenderDeliveryService`
 * delivers it to the one event pipeline and completes the row). The render door calls it after its claim answered a new row; there is no
 * poll receiver for a render (the providers list none), so the door is the only receiver of the type.
 */
export class VideoRenderAdmissionService {
    constructor(
        @InjectQueueOutbox() private readonly outbox: QueueOutbox,
        private readonly admissions: AccountDataAdmissionsService,
        private readonly composers: VideoComposeRegistryService,
    ) {}

    /** The admission: writes the delivery job of the row in the caller's transaction (a repeat of the same row is the same job). */
    readonly admission: AccountAdmission = async (tx: EntityManager, row: AdmittedRow): Promise<void> => {
        const message: VideoRenderDeliveryRecorded = { provider: row.owner.provider, connectionId: row.owner.connectionId, key: row.key }
        await this.outbox.write(tx, DELIVER_VIDEO_RENDER_JOB.queue, message, {
            job: DELIVER_VIDEO_RENDER_JOB.name,
            dedupeKey: DELIVER_VIDEO_RENDER_JOB.onceKey(message),
        })
    }

    /** Registers the admission of the render type of every compose provider that registered its port (at boot). */
    register(): void {
        for (const provider of this.composers.providers()) this.admissions.register(renderTypeOf(provider), this.admission)
    }
}
