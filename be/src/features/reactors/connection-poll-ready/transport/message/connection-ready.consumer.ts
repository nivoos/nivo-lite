import { Injectable } from "@nestjs/common"
import type { CommandBus } from "@nestjs/cqrs"
import { ConnectionReadyEvent } from "@modules/events/api"
import { InjectCommandBus } from "@modules/platform/cqrs"
import type { EventConsumer, EventDelivery } from "@modules/platform/event-bus"
import { StartConnectionPollCommand } from "../../application/start-connection-poll.command"

@Injectable()
/** The consumer door of the connection_ready event in the connection-poll-ready reactor: it dispatches one command and forwards the event id. */
export class ConnectionReadyConsumer implements EventConsumer<ConnectionReadyEvent> {
    readonly event: typeof ConnectionReadyEvent = ConnectionReadyEvent

    constructor(@InjectCommandBus() private readonly commandBus: CommandBus) {}

    /** Delivery is at least once: marking an account ready twice is the same state, so a repeat changes nothing. */
    async handle(delivery: EventDelivery<ConnectionReadyEvent>): Promise<void> {
        await this.commandBus.execute(
            new StartConnectionPollCommand({
                request: { eventId: delivery.eventId, delivery, correlationId: delivery.correlationId },
            }),
        )
    }
}
