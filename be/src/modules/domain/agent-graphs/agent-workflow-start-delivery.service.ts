import { Injectable } from "@nestjs/common"
import { LATEST_VERSION } from "@nivo-lite/agent-sdk/graph"
import type { EntityManager } from "typeorm"
import { WORKFLOW_CALL_TRIGGER } from "@modules/domain/agent-schedules/workflow-call.trigger"
import { ProviderTriggersService } from "@modules/domain/provider-triggers"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import { payloadOfJob, type ClaimedJob } from "@modules/platform/jobs"
import { DELIVER_WORKFLOW_START_JOB } from "@modules/queues/workflow-start"
import { AgentGraphsError, AgentGraphsErrorCode } from "./errors/agent-graphs.error"

@Injectable()
/**
 * A PERSON'S START of a workflow enters the one event pipeline here (concept triggers rule 13), run by the api only (the one app that
 * drives runs; R24): the queued start (written by whichever app the person used, after the person's right, the workflow's runnability and
 * its contract were checked there) becomes ONE `workflow.called` event, its data the inputs, pinned to the workflow at its running version,
 * the person beside it, and is handed to the ONE delivery function for the installation's agent. NOT provided by the agent-graphs module:
 * only the api's job module composes it, so the mcp app composes no delivery.
 */
export class AgentWorkflowStartDeliveryService {
    constructor(
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
        private readonly triggers: ProviderTriggersService,
    ) {}

    /**
     * Delivers the start the claimed job names (its payload was checked against the job's declaration by the runner). The delivery and
     * its verdict are one transaction: a start no live registration of the agent took THROWS inside it, so nothing is claimed and a resume
     * can deliver it once the workflow runs again; a repeat of a start already delivered is a normal end.
     */
    async deliverJob(job: ClaimedJob): Promise<void> {
        const start = payloadOfJob(DELIVER_WORKFLOW_START_JOB, job)
        const event = WORKFLOW_CALL_TRIGGER.translate({ key: start.key, params: start.inputs }, { connectionId: null })
        if (event === null) return
        await this.entityManager.transaction(async (tx) => {
            const result = await this.triggers.deliver(
                {
                    workspaceId: start.workspaceId,
                    declaration: WORKFLOW_CALL_TRIGGER,
                    connectionId: null,
                    agentId: start.agentId,
                    events: [
                        {
                            event,
                            pin: { workflow: start.workflowKey, version: LATEST_VERSION },
                            actorMemberId: start.memberId,
                        },
                    ],
                },
                tx,
            )
            if (result.status !== "delivered" || (result.woken.length === 0 && result.repeats === 0)) {
                throw new AgentGraphsError({
                    code: AgentGraphsErrorCode.WorkflowStartUntaken,
                    params: { agentId: start.agentId, workflow: start.workflowKey },
                })
            }
        })
    }
}
