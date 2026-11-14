import { Injectable } from "@nestjs/common"
import { InjectClock, type Clock } from "@modules/platform/clock"
import { InjectConnectionPollOptions, InjectPollLimiterStore } from "./connection-poll.decorators"
import type { PollLimits } from "./connection-poll.contracts"
import { ConnectionPollError, ConnectionPollErrorCode } from "./errors/connection-poll.error"
import type { OptionalPollSlot, PollLimiterStore } from "./poll-limiter.contracts"
import type { ConnectionPollOptions } from "./connection-poll.options"

@Injectable()
/**
 * The two limits a provider declares, spent per credential: a token bucket per connection (every tenant has its own provider token, so the provider
 * limits each separately) and a cap on the calls in flight to the provider across all of them. The state lives in the store, shared by every replica
 * when the app declares Redis.
 */
export class PollLimiterService {
    constructor(
        @InjectClock() private readonly clock: Clock,
        @InjectPollLimiterStore() private readonly store: PollLimiterStore,
        @InjectConnectionPollOptions() private readonly options: ConnectionPollOptions,
    ) {}

    /** Takes one of the provider's concurrency slots for the connection; undefined when all are taken. */
    async enter(provider: string, connectionId: string, limits: PollLimits): Promise<OptionalPollSlot> {
        const { leaseMs } = this.options.schedule
        const granted = await this.store.enter(
            provider,
            connectionId,
            limits.concurrency,
            leaseMs,
            this.clock.now().getTime(),
        )
        return granted ? { release: () => this.store.leave(provider, connectionId) } : undefined
    }

    /**
     * Passes when the connection's bucket holds a token. A bucket with none ends the poll with a `Deferred` error that names the wait the
     * provider's declared limit asks for, so the scheduler plans the connection again after it (the declared schedule, never a wait inside
     * the poll: nothing here sleeps or tries again).
     */
    async pass(provider: string, connectionId: string, limits: PollLimits): Promise<void> {
        const answer = await this.store.take(`${provider}:${connectionId}`, limits, this.clock.now().getTime())
        if (answer.allowed) return
        throw new ConnectionPollError({ code: ConnectionPollErrorCode.Deferred, params: { waitMs: answer.waitMs } })
    }
}
