import { mock } from "@starci/jest-preset"
import { LATEST_VERSION } from "@nivo-lite/agent-sdk/graph"
import type { EntityManager } from "typeorm"
import { WORKFLOW_CALL_TRIGGER } from "@modules/domain/agent-schedules/workflow-call.trigger"
import type { DeliverResult, ProviderTriggersService } from "@modules/domain/provider-triggers"
import type { ClaimedJob } from "@modules/platform/jobs"
import type { WorkflowStartPayload } from "@modules/queues/workflow-start"
import { AgentWorkflowStartDeliveryService } from "./agent-workflow-start-delivery.service"
import { AgentGraphsError, AgentGraphsErrorCode } from "./errors/agent-graphs.error"

const PAYLOAD: WorkflowStartPayload = {
    workspaceId: "ws-1",
    agentId: "agent-1",
    memberId: "member-1",
    workflowKey: "after-sale",
    key: "workflow-run:user-1:op-1",
    inputs: { contactId: "c-1" },
}

const jobOf = (payload: object): ClaimedJob => ({ jobId: "job-1", kind: "workflow-start.deliver", fencingToken: 1, currentStep: null, payload })

const delivered = (woken: Extract<DeliverResult, { status: "delivered" }>["woken"], repeats = 0): DeliverResult => ({
    status: "delivered",
    events: 1,
    dropped: 0,
    sameFact: 0,
    woken,
    repeats,
    untaken: woken.length === 0 && repeats === 0 ? 1 : 0,
    held: 0,
})

const build = (result: DeliverResult) => {
    const tx = mock<EntityManager>()
    const entityManager = mock<EntityManager>()
    entityManager.transaction.mockImplementation(((work: (manager: EntityManager) => Promise<unknown>) => work(tx)) as never)
    const triggers = mock<ProviderTriggersService>()
    triggers.deliver.mockResolvedValue(result)
    return { service: new AgentWorkflowStartDeliveryService(entityManager, triggers), triggers, tx }
}

describe("AgentWorkflowStartDeliveryService: a queued person's start enters the one event pipeline in the api", () => {
    it("delivers ONE workflow.called event, its data the inputs, pinned to the workflow, the person beside it, for the agent", async () => {
        const { service, triggers, tx } = build(
            delivered([{ agentId: "agent-1", workflowId: "wf-1", eventId: PAYLOAD.key, wakeId: "wake-1" }]),
        )

        await service.deliverJob(jobOf(PAYLOAD))

        expect(triggers.deliver).toHaveBeenCalledWith(
            {
                workspaceId: "ws-1",
                declaration: WORKFLOW_CALL_TRIGGER,
                connectionId: null,
                agentId: "agent-1",
                events: [
                    {
                        event: { id: "workflow-run:user-1:op-1", data: { contactId: "c-1" } },
                        pin: { workflow: "after-sale", version: LATEST_VERSION },
                        actorMemberId: "member-1",
                    },
                ],
            },
            tx,
        )
    })

    it("THROWS when no live registration of the agent took the start (never a silent drop), inside the delivery transaction so nothing is claimed; a repeat is a normal end", async () => {
        const untaken = build(delivered([]))
        await expect(untaken.service.deliverJob(jobOf(PAYLOAD))).rejects.toMatchObject({
            code: AgentGraphsErrorCode.WorkflowStartUntaken,
            params: { agentId: "agent-1", workflow: "after-sale" },
        })
        await expect(untaken.service.deliverJob(jobOf(PAYLOAD))).rejects.toBeInstanceOf(AgentGraphsError)

        const repeat = build(delivered([], 1))
        await expect(repeat.service.deliverJob(jobOf(PAYLOAD))).resolves.toBeUndefined()
    })

    it("refuses a payload that is no start as an input failure (the runner dead-letters it at once)", async () => {
        const { service, triggers } = build(delivered([]))

        await expect(service.deliverJob(jobOf({ workspaceId: "ws-1" }))).rejects.toMatchObject({ params: { failureClass: "input" } })

        expect(triggers.deliver).not.toHaveBeenCalled()
    })
})
