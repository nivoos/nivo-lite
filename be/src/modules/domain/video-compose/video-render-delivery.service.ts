import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { AccountDataIntakeService, type PendingRow } from "@modules/domain/account-data"
import { ConnectionBindingsReadService } from "@modules/domain/connections"
import { ProviderTriggersService, type OptionalPreparedDelivery } from "@modules/domain/provider-triggers"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { payloadOfJob, type ClaimedJob } from "@modules/platform/jobs"
import { DELIVER_VIDEO_RENDER_JOB } from "@modules/queues/video-render-delivery"
import { VideoComposeLogEvent } from "./video-compose.log-events"
import { renderTypeOf } from "./video-render-data.policy"
import { renderTriggerOf } from "./video-render.trigger"

@Injectable()
/**
 * Hands one KEPT render completion to the one event pipeline (the delivery job of the render door): the row the door kept is read again
 * and locked, translated by its provider's pure render trigger, delivered (the wake of the run that waits for the render) and completed,
 * all in ONE transaction. A row already completed (a redelivery) or an account that is gone ends the job normally; a failure to deliver
 * throws, so the transaction rolls back, the row stays pending and the job runner retries or dead-letters it with one item.
 */
export class VideoRenderDeliveryService {
    constructor(
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
        @InjectLogger() private readonly logger: Logger,
        private readonly bindings: ConnectionBindingsReadService,
        private readonly intake: AccountDataIntakeService,
        private readonly triggers: ProviderTriggersService,
    ) {}

    /**
     * Delivers the completion the claimed job names. PREPARE first, with no transaction open (concept outbox-job rule 12): the row as it
     * stands, the account, the event prepared; then ONE short transaction: the row locked again (absent: another delivery completed it
     * meanwhile), the event committed, the row completed.
     */
    async deliver(job: ClaimedJob): Promise<void> {
        const work = payloadOfJob(DELIVER_VIDEO_RENDER_JOB, job)
        const type = renderTypeOf(work.provider)
        const seen = await this.intake.pendingOf(this.entityManager, type, work.connectionId, work.key)
        if (seen === null) return
        const account = await this.bindings.accountOf(work.connectionId, this.entityManager)
        let prepared: OptionalPreparedDelivery = null
        if (account?.provider === work.provider) prepared = await this.prepare(account.workspaceId, work.provider, work.connectionId, seen)
        else this.logger.warn(VideoComposeLogEvent.RenderAccountGone, { provider: work.provider, connectionId: work.connectionId })
        await this.entityManager.transaction(async (tx) => {
            const pending = await this.intake.lockPending(tx, type, work.connectionId, work.key)
            if (pending === null) return
            if (prepared !== null) await this.triggers.deliver(prepared, tx)
            await this.intake.complete(tx, pending)
        })
    }

    /** PREPARE of the row's completion; null for a row whose translation is no event (a status that is no terminal one). */
    private prepare(
        workspaceId: string,
        provider: string,
        connectionId: string,
        pending: PendingRow,
    ): Promise<OptionalPreparedDelivery> {
        const declaration = renderTriggerOf(provider)
        const value = declaration.raw.safeParse(pending.value)
        const event = value.success ? declaration.translate(value.data, { connectionId }) : null
        if (event === null) return Promise.resolve(null)
        return this.triggers.prepare({
            workspaceId,
            declaration,
            connectionId,
            agentId: null,
            events: [{ event, raw: { type: pending.type, id: pending.id } }],
        })
    }
}
