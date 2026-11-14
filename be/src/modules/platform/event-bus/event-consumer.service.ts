import { Injectable, Optional, type BeforeApplicationShutdown, type OnApplicationBootstrap } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { InjectCqrsReadiness, type CqrsReadinessService } from "@modules/platform/cqrs"
import { callDbFunction, InjectPrimaryEntityManager } from "@modules/platform/database"
import { InjectJobDeadLetters, type JobDeadLettersService } from "@modules/platform/jobs"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { eachInOrder } from "@modules/platform/primitives"
import { classifyFailure, workspaceOf } from "@modules/platform/queue"
import {
    DEFAULT_MAX_DELIVERIES,
    type BaseEvent,
    type EventMessage,
    type EventSubscriptionOptions,
} from "./event-bus.contracts"
import { isCorrelationId } from "./event-bus.correlation.policy"
import { InjectEventBusOptions } from "./event-bus.decorators"
import { EventBusLogEvent } from "./event-bus.log-events"
import type { EventBusOptions } from "./event-bus.options"
import type { EventConsumer, EventConsumerRegistry } from "./event-bus.port"

/** One row of event_bus_read: pgmq returns the bigint id as text. */
interface MessageRow {
    readonly msg_id: string
    readonly read_ct: number
    readonly message: unknown
}

/** One consumer: its queue `<topic>__<consumer>`, the door its deliveries go through and its delivery budget. */
export interface EventSubscription {
    /** The consumer's pgmq queue. */
    readonly queue: string
    /** The thin door the consumer's deliveries go through. */
    readonly consumer: EventConsumer<BaseEvent>
    /** The deliveries before the message moves to `<queue>__dead`. */
    readonly maxDeliveries: number
}

/** The correlation id of an envelope: its metadata when present and valid, else a safe event id; null refuses the message. */
const correlationOf = (message: unknown, eventId: string): string | null => {
    if (typeof message !== "object" || message === null || !("metadata" in message)) {
        return isCorrelationId(eventId) ? eventId : null
    }
    const metadata = message.metadata
    if (typeof metadata !== "object" || metadata === null || !("correlationId" in metadata)) return null
    return isCorrelationId(metadata.correlationId) ? metadata.correlationId : null
}

/** The workspace an envelope's payload names (a uuid), or undefined: the person to tell is that workspace's founder. */
const workspaceOfEnvelope = (message: unknown): string | undefined => {
    if (typeof message !== "object" || message === null || !("payload" in message)) return undefined
    const { payload } = message
    return typeof payload === "object" && payload !== null ? (workspaceOf(payload) ?? undefined) : undefined
}

/** The code a failure carries (a domain error's code, a system error's code), or a stand-in when it names none: the reason of the item. */
const reasonOfFailure = (cause: unknown): string => {
    const code = typeof cause === "object" && cause !== null && "code" in cause ? cause.code : undefined
    if (typeof code === "string" && code !== "") return code.slice(0, 200)
    return (cause instanceof Error ? cause.message : String(cause)).slice(0, 200)
}

/** Why a delivery was buried, as the item of a person and the dead-letter row read it: the class of the failure and its reason. */
interface Burial {
    /** The class `classifyFailure` gave the failure; `transient` for a delivery whose tries ran out. */
    readonly failureClass: "transient" | "input" | "code" | "config"
    /** The dead-letter row's reason: `malformed`, `max-deliveries`, or the class of a failure no retry can fix. */
    readonly reason: string
    /** The code or message of the failure, or the reason again when no failure is known (the tries ran out in earlier deliveries). */
    readonly detail: string
}

/** True for a usable business dedupe key. */
const isDedupeKey = (value: unknown): value is string =>
    typeof value === "string" && value.trim().length > 0 && value.length <= 256

@Injectable()
/**
 * The consuming side of the lite event bus: each consumer reads its own pgmq queue with a visibility timeout, archives a message it
 * handled, leaves a failed one to reappear, and moves one past its maxDeliveries, or malformed, to `<queue>__dead`. Delivery is at
 * least once and unordered, so the command a consumer dispatches claims (consumer, dedupeKey) in the inbox first and reads current
 * state rather than trusting the order of events (BE-EVENT-BUS-4). The loops start on application bootstrap in the app that enables
 * consumers; shutdown raises the stop flag, wakes every pause and awaits the batch in flight. It uses a plain abortable timer, not
 * `@nestjs/schedule` (R335 keeps that in platform/jobs).
 */
export class EventConsumerService implements EventConsumerRegistry, OnApplicationBootstrap, BeforeApplicationShutdown {
    private readonly subscriptions: Array<EventSubscription> = []
    private readonly abort = new AbortController()
    private loops: Promise<unknown> = Promise.resolve()

    constructor(
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
        @InjectEventBusOptions() private readonly options: EventBusOptions,
        @InjectLogger() private readonly logger: Logger,
        @Optional() @InjectCqrsReadiness() private readonly cqrs?: CqrsReadinessService,
        @Optional() @InjectJobDeadLetters() private readonly deadLetters?: JobDeadLettersService,
    ) {}

    /** Adds one static subscription; the registry is filled by the reactors' own modules before bootstrap. */
    subscribe<Event extends BaseEvent>(
        queue: string,
        consumer: EventConsumer<Event>,
        options: EventSubscriptionOptions = {},
    ): void {
        this.subscriptions.push({ queue, consumer, maxDeliveries: options.maxDeliveries ?? DEFAULT_MAX_DELIVERIES })
    }

    /** The consumer queues subscribed in this app, in the order they subscribed. */
    queues(): ReadonlyArray<string> {
        return this.subscriptions.map((subscription) => subscription.queue)
    }

    /**
     * Starts one read loop per subscription, only in the app that enables consumers, and only once the command, query and event
     * handlers are registered: a consumer drives them from outside a request, so the first message read must find its handler.
     */
    onApplicationBootstrap(): void {
        if (this.options.consumersEnabled !== true) {
            this.logger.info(EventBusLogEvent.ConsumersDisabled, { subscriptions: this.subscriptions.length })
            return
        }
        const ready = this.cqrs === undefined || this.cqrs.isReady() ? Promise.resolve() : this.cqrs.whenReady()
        this.loops = ready.then(() => Promise.all(this.subscriptions.map((subscription) => this.run(subscription))))
    }

    /** Stops admitting reads, wakes the pauses and waits for the batch in flight to settle. */
    async beforeApplicationShutdown(): Promise<void> {
        this.abort.abort()
        await this.loops
    }

    /** Reads one batch of the consumer's queue and settles each message in order; answers how many it read. */
    async drain(subscription: EventSubscription): Promise<number> {
        const rows = await callDbFunction<MessageRow>(this.entityManager, "public.event_bus_read", [
            subscription.queue,
            this.options.visibilitySeconds ?? 30,
            this.options.batch ?? 10,
        ])
        await eachInOrder(rows, (row) =>
            this.abort.signal.aborted
                ? Promise.resolve()
                : this.settle(subscription, { msgId: row.msg_id, readCt: row.read_ct, message: row.message }),
        )
        return rows.length
    }

    /** Polls one queue until shutdown: each pass starts only when the one before it settled, and the answer settles at the stop. */
    private run(subscription: EventSubscription): Promise<void> {
        return new Promise((stopped) => {
            const next = (): void => {
                if (this.abort.signal.aborted) {
                    stopped()
                    return
                }
                void this.poll(subscription).then(next)
            }
            next()
        })
    }

    /** One pass: drains a batch, and rests when the queue was empty or the read failed. */
    private async poll(subscription: EventSubscription): Promise<void> {
        const read = await this.drain(subscription).catch((cause: unknown) => {
            this.logger.error(EventBusLogEvent.ReadFailed, cause, { queue: subscription.queue })
            return 0
        })
        if (read === 0) await this.pause()
    }

    /** Waits `idleMs`, or less when shutdown aborts it. */
    private pause(): Promise<void> {
        return new Promise((rested) => {
            const timer = setTimeout(rested, this.options.idleMs ?? 500)
            this.abort.signal.addEventListener(
                "abort",
                () => {
                    clearTimeout(timer)
                    rested()
                },
                { once: true },
            )
        })
    }

    /** The event an envelope stands for; null when it is malformed or the event class refuses one of its values. */
    private parse(subscription: EventSubscription, message: EventMessage): BaseEvent | null {
        try {
            return subscription.consumer.event.parse(message.message)
        } catch (cause) {
            this.logger.error(EventBusLogEvent.ParseFailed, cause, {
                consumer: subscription.queue,
                msgId: message.msgId,
            })
            return null
        }
    }

    private async settle(subscription: EventSubscription, message: EventMessage): Promise<void> {
        const event = this.parse(subscription, message)
        const correlationId = event === null ? null : correlationOf(message.message, event.eventId)
        if (event === null || correlationId === null || !isDedupeKey(event.payload.dedupeKey)) {
            return this.dead(subscription, message, null, { failureClass: "code", reason: "malformed", detail: "malformed" })
        }
        if (message.readCt > subscription.maxDeliveries) {
            return this.dead(subscription, message, event, {
                failureClass: "transient",
                reason: "max-deliveries",
                detail: "max-deliveries",
            })
        }
        try {
            await subscription.consumer.handle({
                correlationId,
                eventId: event.eventId,
                consumer: subscription.queue,
                dedupeKey: event.payload.dedupeKey,
                event,
                attempt: message.readCt,
            })
        } catch (cause) {
            this.logger.error(EventBusLogEvent.ConsumerFailed, cause, {
                consumer: subscription.queue,
                event: event.eventName,
                attempt: message.readCt,
            })
            // The ONE classifier judges the failure. A transient one is left to reappear after the visibility timeout, bounded by the
            // subscription's deliveries; any other class cannot be fixed by another delivery, so it is buried at once with its item.
            const failureClass = classifyFailure(cause)
            if (failureClass === "transient") return
            return this.dead(subscription, message, event, { failureClass, reason: failureClass, detail: reasonOfFailure(cause) })
        }
        await callDbFunction(this.entityManager, "public.event_bus_archive", [subscription.queue, message.msgId])
    }

    /**
     * Moves the message to `<queue>__dead` and archives the original, in one call, then raises the ONE item of the burial through the
     * dead-letter road jobs use (`flowKind` = the consumer's queue, the id `event:<queue>:<event id>`), so a person is told once per
     * buried event and can send it back (`EventBus.requeue`). A message nobody could parse names no workspace: the item becomes an app
     * error the operator reads. An item that cannot be raised is logged; the message stays in the dead-letter queue.
     */
    private async dead(
        subscription: EventSubscription,
        message: EventMessage,
        event: BaseEvent | null,
        burial: Burial,
    ): Promise<void> {
        this.logger.warn(EventBusLogEvent.DeliveryDead, {
            consumer: subscription.queue,
            event: event?.eventName ?? null,
            msgId: message.msgId,
            reason: burial.reason,
            attempt: message.readCt,
        })
        await callDbFunction(this.entityManager, "public.event_bus_bury", [
            subscription.queue,
            message.msgId,
            message.readCt,
            JSON.stringify(message.message),
            burial.reason,
        ])
        const identity = event?.eventId ?? message.msgId
        await this.deadLetters
            ?.raise({
                kind: "flow-parked",
                jobId: `event:${subscription.queue}:${identity}`,
                workspaceId: workspaceOfEnvelope(message.message),
                flowKind: subscription.queue,
                failureClass: burial.failureClass,
                reason: burial.detail,
                episode: 0,
                correlationId: identity,
                build: this.options.buildId ?? "unknown",
                action: "resume",
            })
            .catch((cause: unknown) => {
                this.logger.error(EventBusLogEvent.DeadLetterNotRaised, cause, { consumer: subscription.queue, msgId: message.msgId })
            })
    }
}
