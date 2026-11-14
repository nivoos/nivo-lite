import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { InjectQueueOutbox, type QueueOutbox } from "@modules/platform/queue"
import type { GenerateWithAgentPayload, SetupTurnPayload } from "./agents.contracts"
import { GENERATE_JOB, SETUP_TURN_JOB } from "./agents.jobs"

@Injectable()
/** The typed producer of the agents queue: the one way a generation or a setup-turn job starts from the back end. */
export class AgentsQueue {
    constructor(@InjectQueueOutbox() private readonly outbox: QueueOutbox) {}

    /** Enqueues the run of a queued generation in the caller's transaction: the job exists exactly when the ai_generations row does. */
    enqueueGenerate(payload: GenerateWithAgentPayload, tx: EntityManager): Promise<void> {
        return this.outbox.write(tx, GENERATE_JOB.queue, payload, { job: GENERATE_JOB.name, dedupeKey: GENERATE_JOB.onceKey(payload) })
    }

    /** Enqueues the answer to an owner message of the setup chat in the caller's transaction: one job per message. */
    enqueueSetupTurn(payload: SetupTurnPayload, tx: EntityManager): Promise<void> {
        return this.outbox.write(tx, SETUP_TURN_JOB.queue, payload, { job: SETUP_TURN_JOB.name, dedupeKey: SETUP_TURN_JOB.onceKey(payload) })
    }
}
