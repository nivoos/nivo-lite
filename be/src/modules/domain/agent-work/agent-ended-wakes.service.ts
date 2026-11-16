import { Injectable } from "@nestjs/common"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { eachInOrder } from "@modules/platform/primitives"
import { AgentWorkHandlersService } from "./agent-work-handlers.service"
import { AgentWorkLogEvent } from "./agent-work.log-events"
import { wakeSources } from "./agent-wake-source.policy"
import type { AgentEndedWake } from "./agent-work-turns.contracts"
import type { AgentWakeView } from "./agent-work.contracts"

/** The code a wake `begin` found dead past its attempts is reported with (the reason `begin` wrote on it). */
const DEAD_CODE = "attempts"

/** The reason a wake of a source this process no longer serves is closed with, and the code it is reported with (rule RETIRED SOURCE). */
export const SOURCE_RETIRED = "source_retired"

@Injectable()
/**
 * Tells the handler of each wake that `begin` ended with no turn to run. A wake held because the switch is off gets the holding line its
 * handler says; a wake dead past its attempts is logged and told once: a wake of the flow (an event of the one pipeline, a workflow call)
 * is REPORTED by the flow to the team (the engine gave up on it: never a silent death, DEF-5), any other the handler of its source tells
 * (the owner for background work, the colleague or the customer otherwise). `begin` reports a wake once, so it is told once; a handler or
 * a report that fails is logged and the rest are still told. A wake of a source the engine no longer serves (rule RETIRED SOURCE) has no
 * handler to speak for it: it is reported once as retired (`retired`).
 */
export class AgentEndedWakesService {
    constructor(
        @InjectLogger() private readonly logger: Logger,
        private readonly handlers: AgentWorkHandlersService,
    ) {}

    /** Tells the handlers, in the order `begin` ended the wakes. */
    tell(ended: ReadonlyArray<AgentEndedWake>): Promise<void> {
        return eachInOrder(ended, async ({ state, wake }) => {
            if (wakeSources.lookup(wake.source) === undefined) {
                await this.retired(wake)
                return
            }
            if (state === "dead") {
                this.logger.warn(AgentWorkLogEvent.WakeDead, { agentId: wake.agentId, wakeId: wake.wakeId })
                if (await this.reportedByFlow(wake, DEAD_CODE)) return
            }
            const handler = this.handlers.of(wake.source)
            if (handler === undefined) return
            await handler.holdOver(wake, state === "dead" ? "error" : "killed").then(
                () => undefined,
                (cause: unknown) => {
                    this.logger.error(AgentWorkLogEvent.TurnFailed, cause, {
                        agentId: wake.agentId,
                        wakeId: wake.wakeId,
                    })
                },
            )
        })
    }

    /**
     * Reports, once, a wake whose source this process no longer serves (rule RETIRED SOURCE): one warn line, and the flow's report of a
     * wake it gave up on when the wake is the flow's (an event of the one pipeline, a pinned call). The caller closes the wake, so it is
     * never handed out again and never told twice.
     */
    async retired(wake: AgentWakeView): Promise<void> {
        this.logger.warn(AgentWorkLogEvent.WakeSourceRetired, { agentId: wake.agentId, wakeId: wake.wakeId, source: wake.source })
        await this.reportedByFlow(wake, SOURCE_RETIRED)
    }

    /** True when the flow took the wake as its own and reported it; false with no flow, for a wake not its own, or a report that failed. */
    private async reportedByFlow(wake: AgentWakeView, code: string): Promise<boolean> {
        const flow = this.handlers.flowOf()
        if (flow === undefined) return false
        try {
            return await flow.gaveUp(wake, code)
        } catch (cause) {
            this.logger.error(AgentWorkLogEvent.TurnFailed, cause, { agentId: wake.agentId, wakeId: wake.wakeId })
            return false
        }
    }
}
