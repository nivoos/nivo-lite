import { Test } from "@nestjs/testing"
import { builder, mock, mockEntityManager } from "@starci/jest-preset"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { JOB_DEAD_LETTERS } from "@modules/platform/jobs"
import type { JobDeadLettersService } from "@modules/platform/jobs"
import { LOGGER } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { QueueError, QueueErrorCode } from "@modules/platform/queue"
import { BaseEvent } from "./event-bus.contracts"
import type { EventDelivery, ParsedEvent } from "./event-bus.contracts"
import { EventBusError, EventBusErrorCode } from "./errors/event-bus.error"
import { EventBusLogEvent } from "./event-bus.log-events"
import { EVENT_BUS_OPTIONS } from "./event-bus.decorators"
import type { EventBusOptions } from "./event-bus.options"
import type { EventConsumer } from "./event-bus.port"
import { EventConsumerService } from "./event-consumer.service"

// The statements callDbFunction of platform/database sends for the bus functions of the migration.
const READ = 'SELECT * FROM "public"."event_bus_read"($1, $2, $3)'
const BURY = 'SELECT * FROM "public"."event_bus_bury"($1, $2, $3, $4, $5)'
const QUEUE = "spec_delivery_recorded__mailer"
const WS = "11111111-1111-4111-8111-111111111111"

/** The payload of the spec event. */
interface ReceiptPayload {
    readonly dedupeKey: string
}

/** The spec event: a business fact with a dedupe key. */
class ReceiptEvent extends BaseEvent {
    static readonly eventName = "spec.delivery-recorded"
    static readonly version = 1
    readonly eventName = ReceiptEvent.eventName

    constructor(
        readonly eventId: string,
        readonly payload: ReceiptPayload,
    ) {
        super()
    }

    static parse(envelope: unknown): ParsedEvent<ReceiptEvent> {
        if (typeof envelope !== "object" || envelope === null || !("eventId" in envelope) || typeof envelope.eventId !== "string") return null
        if (!("payload" in envelope) || typeof envelope.payload !== "object" || envelope.payload === null || !("dedupeKey" in envelope.payload)) return null
        const dedupeKey = envelope.payload.dedupeKey
        return typeof dedupeKey === "string" ? new ReceiptEvent(envelope.eventId, { dedupeKey }) : null
    }
}

const envelope = {
    metadata: { correlationId: "request-1" },
    eventId: "event-1",
    eventName: "spec.delivery-recorded",
    payload: { dedupeKey: "receipt-1" },
}
/** An envelope whose payload names the workspace the item is for. */
const envelopeOfWorkspace = { ...envelope, payload: { ...envelope.payload, workspaceId: WS } }

/** A reactor whose deliveries throw what the spec says (a domain error: the thrower's own class). */
class FailingConsumer implements EventConsumer<ReceiptEvent> {
    readonly event = ReceiptEvent
    constructor(private readonly failure: QueueError | EventBusError | undefined) {}

    handle(_delivery: EventDelivery<ReceiptEvent>): Promise<void> {
        return this.failure === undefined ? Promise.resolve() : Promise.reject(this.failure)
    }
}

/** A failure that names its class, as a flow does when it knows what the failure is. */
const named = (failureClass: "transient" | "input" | "code" | "config", reason: string): QueueError =>
    new QueueError({ code: QueueErrorCode.FlowFailure, params: { failureClass, reason } })

const build = async (primary: ReturnType<typeof mockEntityManager>, options: EventBusOptions = {}) => {
    const logger = mock<Logger>()
    const deadLetters = mock<JobDeadLettersService>()
    deadLetters.raise.mockResolvedValue(undefined)
    const moduleRef = await Test.createTestingModule({
        providers: [
            EventConsumerService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: primary },
            { provide: EVENT_BUS_OPTIONS, useValue: builder<EventBusOptions>({})(options) },
            { provide: LOGGER, useValue: logger },
            { provide: JOB_DEAD_LETTERS, useValue: deadLetters },
        ],
    }).compile()
    return { subject: moduleRef.get(EventConsumerService), logger, deadLetters }
}

describe("EventConsumerService burial: a failure is judged by the one classifier and a burial raises ONE item", () => {
    it("leaves a transient failure to reappear: nothing is buried and nobody is told", async () => {
        const primary = mockEntityManager({ query: [READ, [{ msg_id: "1", read_ct: 2, message: envelopeOfWorkspace }]] })
        const { subject, deadLetters } = await build(primary)

        await subject.drain({ queue: QUEUE, consumer: new FailingConsumer(named("transient", "ECONNRESET")), maxDeliveries: 5 })

        expect(primary.query).toHaveBeenCalledTimes(1)
        expect(deadLetters.raise).not.toHaveBeenCalled()
    })

    it("buries a failure no other delivery can fix at once (class input) and raises ONE item for the workspace", async () => {
        const primary = mockEntityManager({ query: [[READ, [{ msg_id: "1", read_ct: 1, message: envelopeOfWorkspace }]], [BURY, [{ event_bus_bury: true }]]] })
        const { subject, deadLetters } = await build(primary, { buildId: "b-7" })
        const refused = new EventBusError({ code: EventBusErrorCode.CorrelationInvalid })

        await subject.drain({ queue: QUEUE, consumer: new FailingConsumer(refused), maxDeliveries: 5 })

        expect(primary.query).toHaveBeenCalledWith(BURY, [QUEUE, "1", 1, JSON.stringify(envelopeOfWorkspace), "input"])
        expect(deadLetters.raise).toHaveBeenCalledTimes(1)
        expect(deadLetters.raise).toHaveBeenCalledWith({
            kind: "flow-parked",
            jobId: `event:${QUEUE}:event-1`,
            workspaceId: WS,
            flowKind: QUEUE,
            failureClass: "input",
            reason: EventBusErrorCode.CorrelationInvalid,
            episode: 0,
            correlationId: "event-1",
            build: "b-7",
            action: "resume",
        })
    })

    it("buries a bug (class code) at once; an event that names no workspace raises an item with none", async () => {
        const primary = mockEntityManager({ query: [[READ, [{ msg_id: "1", read_ct: 1, message: envelope }]], [BURY, [{ event_bus_bury: true }]]] })
        const { subject, deadLetters } = await build(primary)

        await subject.drain({ queue: QUEUE, consumer: new FailingConsumer(named("code", "boom")), maxDeliveries: 5 })

        expect(primary.query).toHaveBeenCalledWith(BURY, [QUEUE, "1", 1, JSON.stringify(envelope), "code"])
        expect(deadLetters.raise).toHaveBeenCalledWith(
            expect.objectContaining({ failureClass: "code", workspaceId: undefined, reason: "QUEUE_FLOW_FAILURE", build: "unknown" }),
        )
    })

})

describe("EventConsumerService burial: what is told, and when the telling fails", () => {
    it("keeps the message in the dead-letter queue and logs when its item cannot be raised, and goes on", async () => {
        const primary = mockEntityManager({ query: [[READ, [{ msg_id: "1", read_ct: 1, message: envelopeOfWorkspace }]], [BURY, [{ event_bus_bury: true }]]] })
        const { subject, deadLetters, logger } = await build(primary)
        const down = new EventBusError({ code: EventBusErrorCode.CorrelationInvalid })
        deadLetters.raise.mockRejectedValue(down)

        await expect(
            subject.drain({ queue: QUEUE, consumer: new FailingConsumer(named("input", "refused")), maxDeliveries: 5 }),
        ).resolves.toBe(1)

        expect(logger.error).toHaveBeenCalledWith(EventBusLogEvent.DeadLetterNotRaised, down, { consumer: QUEUE, msgId: "1" })
    })

    it("raises the one item of a delivery whose tries ran out (class transient, reason max-deliveries)", async () => {
        const primary = mockEntityManager({ query: [[READ, [{ msg_id: "1", read_ct: 6, message: envelopeOfWorkspace }]], [BURY, [{ event_bus_bury: true }]]] })
        const { subject, deadLetters } = await build(primary)

        await subject.drain({ queue: QUEUE, consumer: new FailingConsumer(undefined), maxDeliveries: 5 })

        expect(deadLetters.raise).toHaveBeenCalledTimes(1)
        expect(deadLetters.raise).toHaveBeenCalledWith(
            expect.objectContaining({ jobId: `event:${QUEUE}:event-1`, workspaceId: WS, failureClass: "transient", reason: "max-deliveries" }),
        )
    })

    it("raises an item for a malformed delivery too, with the message id as its identity and no workspace", async () => {
        const primary = mockEntityManager({ query: [[READ, [{ msg_id: "9", read_ct: 1, message: { eventId: 42 } }]], [BURY, [{ event_bus_bury: true }]]] })
        const { subject, deadLetters } = await build(primary)

        await subject.drain({ queue: QUEUE, consumer: new FailingConsumer(undefined), maxDeliveries: 5 })

        expect(deadLetters.raise).toHaveBeenCalledWith(
            expect.objectContaining({ jobId: `event:${QUEUE}:9`, workspaceId: undefined, failureClass: "code", reason: "malformed" }),
        )
    })

    it("lists the queues subscribed, in order", async () => {
        const { subject } = await build(mockEntityManager({}))
        subject.subscribe(QUEUE, new FailingConsumer(undefined))
        subject.subscribe("spec_other__reader", new FailingConsumer(undefined))

        expect(subject.queues()).toEqual([QUEUE, "spec_other__reader"])
    })
})
