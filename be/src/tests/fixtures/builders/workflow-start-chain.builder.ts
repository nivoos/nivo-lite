import { fakeTransaction, mock, mockEntityManager } from "@starci/jest-preset"
import type { DeliverResult, ProviderTriggersService } from "@modules/domain/provider-triggers"
import { AgentWorkflowStartDeliveryService } from "@modules/domain/agent-graphs/agent-workflow-start-delivery.service"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import { DELIVER_WORKFLOW_START_JOB, WORKFLOW_START_QUEUE, type WorkflowStartPayload } from "@modules/queues/workflow-start"

/** The start every spec of the workflow-start chain delivers: one person's press of one workflow. */
export const START: WorkflowStartPayload = {
    workspaceId: "ws-1",
    agentId: "agent-1",
    memberId: "member-1",
    workflowKey: "after-sale",
    key: "workflow-run:user-1:op-1",
    inputs: { contactId: "c-1" },
}

/** What the one delivery answers: taken by a live registration, a repeat of an event it already holds, or taken by nobody. */
export const answers = {
    taken: { status: "delivered", events: 1, dropped: 0, sameFact: 0, woken: [{ agentId: "agent-1", workflowId: "wf-1", eventId: START.key, wakeId: "wake-1" }], repeats: 0, untaken: 0, held: 0 },
    repeat: { status: "delivered", events: 1, dropped: 0, sameFact: 0, woken: [], repeats: 1, untaken: 0, held: 0 },
    untaken: { status: "delivered", events: 1, dropped: 0, sameFact: 0, woken: [], repeats: 0, untaken: 1, held: 0 },
} as const satisfies Record<string, DeliverResult>

/** The processor of the delivery job as the feature composes it: one domain method, the runner judges every failure. */
export class StartProcessor extends FencedProcessor {
    override readonly queue = WORKFLOW_START_QUEUE
    override readonly definition: JobDefinition<WorkflowStartPayload> = DELIVER_WORKFLOW_START_JOB
    constructor(private readonly starts: AgentWorkflowStartDeliveryService) {
        super()
    }
    async process(job: ClaimedJob): Promise<void> {
        await this.starts.deliverJob(job)
    }
}

/** The real delivery service over a fake transaction and a mocked pipeline; `wakes` counts the starts the pipeline took. */
export const startChain = () => {
    const tx = fakeTransaction(mockEntityManager())
    const triggers = mock<ProviderTriggersService>()
    const state = { wakes: 0 }
    const answer = (result: DeliverResult): Promise<DeliverResult> => {
        if (result.status === "delivered" && result.woken.length > 0) state.wakes += 1
        return Promise.resolve(result)
    }
    triggers.deliver.mockImplementation(() => answer(answers.taken))
    const service = new AgentWorkflowStartDeliveryService(tx.em, triggers)
    return { service, processor: new StartProcessor(service), tx, triggers, state, answer }
}
