import { CommandRunner, SubCommand } from "nest-commander"
import { InjectEventBus, type EventBus } from "@modules/platform/event-bus"

@SubCommand({
    name: "requeue-event",
    description: "Send one buried event back to its consumer queue",
    arguments: "<queue> <deadLetterId>",
})
/** `cli jobs requeue-event <queue> <deadLetterId>`: sends one buried event of a consumer back to that consumer (the reactor reads it again). */
export class RequeueEventJobsCli extends CommandRunner {
    constructor(@InjectEventBus() private readonly bus: EventBus) {
        super()
    }

    /** Prints whether the event went back or the queue holds no buried event with that id. */
    async run([queue = "", deadLetterId = ""]: Array<string>): Promise<void> {
        const sent = await this.bus.requeue(queue, deadLetterId)
        process.stdout.write(sent ? "requeued\n" : "not a buried event\n")
    }
}
