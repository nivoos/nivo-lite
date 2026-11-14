import { Injectable } from "@nestjs/common"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { JobsLogEvent } from "./jobs.log-events"
import type { FlowAlerts, ParkedFlowAlert } from "./jobs.port"

@Injectable()
/**
 * Where a dead letter tells a person: the capability that files the person's item binds itself here when its module starts
 * (`bind`, from `onModuleInit`), so the jobs platform never holds that capability in a constructor (it reaches the jobs itself, and a
 * constructor dependency would be a provider cycle). The runner raises ONE alert per park episode; with nothing bound the alert is a
 * warn line the operator reads (`cli queues resume`).
 */
export class JobDeadLettersService implements FlowAlerts {
    private readonly bound: Array<FlowAlerts> = []

    constructor(@InjectLogger() private readonly logger: Logger) {}

    /** Binds where the alerts of parked jobs go; every bound target is told each alert. */
    bind(alerts: FlowAlerts): void {
        this.bound.push(alerts)
    }

    /** Tells every bound target, one after the other; the item is the target's, keyed by job and episode, so a repeat writes nothing. */
    async raise(alert: ParkedFlowAlert): Promise<void> {
        if (this.bound.length === 0) {
            this.logger.warn(JobsLogEvent.DeadLetterUnbound, { jobId: alert.jobId, flowKind: alert.flowKind })
            return
        }
        await this.bound.reduce<Promise<void>>((told, each) => told.then(() => each.raise(alert)), Promise.resolve())
    }
}
