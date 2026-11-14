import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { InjectQueueOutbox, type QueueOutbox } from "@modules/platform/queue"
import type { GenericWebhookPayload } from "./generic-webhook.contracts"
import { DELIVER_GENERIC_WEBHOOK_JOB } from "./generic-webhook.jobs"

@Injectable()
/** Queues a verified receipt in the intake transaction, preserving its delivery identity through the relay. */
export class GenericWebhookQueue {
    constructor(@InjectQueueOutbox() private readonly outbox: QueueOutbox) {}

    /** The delivery job commits with its inbox receipt; redelivery keeps the same durable job identity. */
    enqueueDeliver(payload: GenericWebhookPayload, tx: EntityManager): Promise<void> {
        return this.outbox.write(tx, DELIVER_GENERIC_WEBHOOK_JOB.queue, payload, {
            job: DELIVER_GENERIC_WEBHOOK_JOB.name,
            dedupeKey: DELIVER_GENERIC_WEBHOOK_JOB.onceKey(payload),
        })
    }
}
