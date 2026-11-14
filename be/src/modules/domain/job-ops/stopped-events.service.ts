import { Injectable } from "@nestjs/common"
import { WorkspaceMemberSeatsService } from "@modules/domain/workspace-members"
import {
    InjectEventBus,
    InjectEventConsumerRegistry,
    type EventBus,
    type EventConsumerRegistry,
} from "@modules/platform/event-bus"
import { eachInOrder } from "@modules/platform/primitives"
import { JobOpsError, JobOpsErrorCode } from "./errors/job-ops.error"
import { STOPPED_EVENTS_LIMIT, type StoppedEventView } from "./stopped-events.contracts"
import { envelopeFactsOf } from "./stopped-events.policy"

@Injectable()
/**
 * The person's door to buried events, beside the door to stopped jobs: an event no reactor could handle is moved to its consumer's
 * dead-letter queue with ONE item for the founder (the same `job.parked` card jobs use, its id `event:<queue>:<eventId>`). The owner
 * lists the events of the workspace and sends one back to its consumer ("requeue": the reactor reads it again). Only the workspace
 * OWNER may, and only an event whose payload names THIS workspace: an event of another workspace, an event with no workspace and an id
 * nobody buried all answer the same (false / absent), so an id tells nothing. An event that names no workspace is for the operator's cli.
 */
export class StoppedEventsService {
    constructor(
        @InjectEventBus() private readonly bus: EventBus,
        @InjectEventConsumerRegistry() private readonly consumers: EventConsumerRegistry,
        private readonly seats: WorkspaceMemberSeatsService,
    ) {}

    /** The workspace's buried events, queue by queue, oldest first within a queue. */
    async list(userId: string, workspaceId: string): Promise<ReadonlyArray<StoppedEventView>> {
        await this.requireOwner(userId, workspaceId)
        const found: Array<StoppedEventView> = []
        await eachInOrder(this.consumers.queues(), async (queue) => {
            const buried = await this.bus.deadLetters(queue, STOPPED_EVENTS_LIMIT)
            for (const letter of buried) {
                const facts = envelopeFactsOf(letter.message)
                if (facts?.workspaceId !== workspaceId) continue
                found.push({
                    queue,
                    eventId: facts.eventId,
                    eventName: facts.eventName,
                    reason: letter.reason,
                    readCount: letter.readCount,
                })
            }
        })
        return found
    }

    /** Sends one buried event of the workspace back to its consumer's queue; false when it is not a buried event of this workspace. */
    async requeue(userId: string, workspaceId: string, queue: string, eventId: string): Promise<boolean> {
        await this.requireOwner(userId, workspaceId)
        if (!this.consumers.queues().includes(queue)) return false
        const buried = await this.bus.deadLetters(queue, STOPPED_EVENTS_LIMIT)
        const letter = buried.find((candidate) => {
            const facts = envelopeFactsOf(candidate.message)
            return facts?.eventId === eventId && facts.workspaceId === workspaceId
        })
        return letter === undefined ? false : this.bus.requeue(queue, letter.id)
    }

    private async requireOwner(userId: string, workspaceId: string): Promise<void> {
        const seat = await this.seats.activeSeatOfUser(workspaceId, userId)
        if (seat?.role !== "owner") throw new JobOpsError({ code: JobOpsErrorCode.StoppedWorkNeedsOwner })
    }
}
