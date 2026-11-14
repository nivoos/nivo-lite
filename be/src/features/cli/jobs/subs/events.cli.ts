import { CommandRunner, SubCommand } from "nest-commander"
import { InjectEventBus, type EventBus } from "@modules/platform/event-bus"

/** The most buried events one `cli jobs events` prints when the operator names no limit. */
const DEFAULT_LIMIT = 20

@SubCommand({
    name: "events",
    description: "Print the events a consumer queue buried (id, reason, deliveries, event id), oldest first (default 20)",
    arguments: "<queue> [limit]",
})
/** `cli jobs events <queue> [limit]`: the operator's read of a consumer's dead-letter queue, for an event that names no workspace (a workspace's owner has the stopped-events door). */
export class EventsJobsCli extends CommandRunner {
    constructor(@InjectEventBus() private readonly bus: EventBus) {
        super()
    }

    /** Prints one line per buried event: the dead-letter id `requeue-event` takes, why it was buried, its deliveries and the id of the event. */
    async run([queue = "", limit]: Array<string>): Promise<void> {
        const size = Number.parseInt(limit ?? "", 10)
        const buried = await this.bus.deadLetters(queue, Number.isInteger(size) && size > 0 ? size : DEFAULT_LIMIT)
        for (const letter of buried) {
            const eventId =
                typeof letter.message === "object" && letter.message !== null && "eventId" in letter.message ? String(letter.message.eventId) : "-"
            process.stdout.write(`${letter.id} ${letter.reason} ${String(letter.readCount)} ${eventId}\n`)
        }
        if (buried.length === 0) process.stdout.write("no buried events\n")
    }
}
