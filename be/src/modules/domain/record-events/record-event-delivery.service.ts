import { Injectable, Optional } from "@nestjs/common"
import { AgentRunsService } from "@modules/domain/agent-runs"
import { EntityEngineService } from "@modules/domain/entity-engine"
import { ProviderTriggersService, triggerDeclarations, type DeliverResult } from "@modules/domain/provider-triggers"
import { payloadOfJob, type ClaimedJob } from "@modules/platform/jobs"
import { DELIVER_RECORD_EVENT_JOB, type RecordEventPayload } from "@modules/queues/record-events"
import { recordWrittenDeclarationOf, type RecordEventsSource } from "./record-written.trigger"

/** What one delivery came to: delivered (the pipeline's result), or dropped and why. */
export type RecordEventDelivery =
    | { readonly kind: "delivered"; readonly result: DeliverResult }
    /** The type no longer declares events (a newer package), or the record is no longer live and the event is not its deletion. */
    | { readonly kind: "dropped"; readonly reason: "undeclared" | "record_gone" }

@Injectable()
/**
 * A RECORD WRITE ENTERS THE ONE EVENT PIPELINE here (concept agent-data rules 2, 4), run by the api only (the one app that drives runs):
 * the write door's outbox row becomes ONE `nivo.trigger.record.written` event of the type's derived declaration, delivered to the agent that
 * OWNS the record (records rule: the graphs that share data belong to one agent; another agent's flow is reached by a call), with the writing
 * run named so no registration of its workflow starts on it and no wait of that run takes it. An event of a record that is no longer live
 * (an erased person's record, a record deleted since) is delivered only as its deletion; the erase itself writes no event.
 */
export class RecordEventDeliveryService {
    constructor(
        private readonly triggers: ProviderTriggersService,
        private readonly records: EntityEngineService,
        @Optional() private readonly runs?: AgentRunsService,
    ) {}

    /** Delivers the write the claimed job names; a repeat of a delivered write is a normal end. */
    async deliverJob(job: ClaimedJob): Promise<RecordEventDelivery> {
        return this.deliver(payloadOfJob(DELIVER_RECORD_EVENT_JOB, job))
    }

    /** Delivers one write event: prepared with no transaction open, committed in one of its own. */
    async deliver(payload: RecordEventPayload): Promise<RecordEventDelivery> {
        const source: RecordEventsSource | undefined = this.records.catalog.get(payload.type)
        if (source?.events === undefined) return { kind: "dropped", reason: "undeclared" }
        if (payload.op !== "deleted" && !(await this.live(payload))) return { kind: "dropped", reason: "record_gone" }
        const declaration = recordWrittenDeclarationOf(source)
        // Registering the same derived object again is a no-op: the first delivery of a type registers it (concept triggers rule 14).
        triggerDeclarations.register(declaration)
        const event = declaration.translate(payload, { connectionId: null })
        if (event === null) return { kind: "dropped", reason: "undeclared" }
        const writer = await this.writerOf(payload)
        const result = await this.triggers.deliverAlone({
            workspaceId: payload.workspaceId,
            declaration,
            connectionId: null,
            agentId: payload.agentId,
            events: [{ event, contactId: payload.contactId, writer }],
        })
        return { kind: "delivered", result }
    }

    /** True when the record is still live (read across the workspace's agents: the owner's record). */
    private live(payload: RecordEventPayload): Promise<boolean> {
        return this.records.scoped(
            payload.workspaceId,
            async (tx) => (await this.records.get(tx, payload.type, payload.recordId)) !== null,
            { id: payload.agentId, sees: "all" },
        )
    }

    /** The writing run and its workflow, when a step wrote. */
    private async writerOf(payload: RecordEventPayload): Promise<{ readonly runId: string; readonly workflowId: string | null } | null> {
        if (payload.writerRunId === null) return null
        const run = await this.runs?.runOf(payload.workspaceId, payload.writerRunId)
        const workflowId: unknown = run?.context.workflowId
        return { runId: payload.writerRunId, workflowId: typeof workflowId === "string" ? workflowId : null }
    }
}
