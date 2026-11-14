import { renderChain, RENDER_DELIVERY } from "@tests/fixtures/builders/video-render-chain.builder"
import { FAKE_COMPOSE, FAKE_OUTPUT } from "@tests/fixtures/builders/video-compose.builder"
import type { ClaimedJob } from "@modules/platform/jobs"
import { renderTriggerOf } from "./video-render.trigger"

const job = (payload: object): ClaimedJob => ({ jobId: "job-1", kind: "video-render.deliver", fencingToken: 1, currentStep: null, payload })

describe("VideoRenderDeliveryService", () => {
    it("hands the kept row's completion to the ONE delivery as the provider's render trigger translates it, and completes the row, in one transaction", async () => {
        const { service, intake, triggers, tx } = await renderChain()

        await service.deliver(job(RENDER_DELIVERY))

        expect(triggers.deliver.mock.calls[0]?.[0]).toEqual({
            workspaceId: "ws-1",
            declaration: renderTriggerOf(FAKE_COMPOSE),
            connectionId: "conn-1",
            agentId: null,
            events: [
                {
                    event: { id: "r-1", data: { renderId: "r-1", status: "done", outputUrl: FAKE_OUTPUT, provider: FAKE_COMPOSE } },
                    raw: { type: `${FAKE_COMPOSE}.render`, id: "row-r-1" },
                },
            ],
        })
        expect(intake.complete).toHaveBeenCalledTimes(1)
        expect(tx.commits).toBe(1)
    })

    it("does nothing for a row already completed (a redelivery)", async () => {
        const { service, state, triggers, intake } = await renderChain()
        state.completed = true

        await service.deliver(job(RENDER_DELIVERY))

        expect(triggers.deliver).not.toHaveBeenCalled()
        expect(intake.complete).not.toHaveBeenCalled()
    })

    it("completes the row and wakes nobody when its account is gone (a typed end, not a failure)", async () => {
        const { service, bindings, triggers, intake } = await renderChain()
        bindings.accountOf.mockResolvedValue(null)

        await expect(service.deliver(job(RENDER_DELIVERY))).resolves.toBeUndefined()

        expect(triggers.deliver).not.toHaveBeenCalled()
        expect(intake.complete).toHaveBeenCalledTimes(1)
    })

    it("swallows nothing: a failed delivery throws, the transaction rolls back and the row stays pending", async () => {
        const { service, triggers, intake, tx } = await renderChain()
        const down = new Error("down")
        triggers.deliver.mockRejectedValue(down)

        await expect(service.deliver(job(RENDER_DELIVERY))).rejects.toBe(down)

        expect(intake.complete).not.toHaveBeenCalled()
        expect(tx.rollbacks).toBe(1)
    })

    it("refuses a payload the declaration does not accept, as input (the runner dead-letters it at once)", async () => {
        const { service } = await renderChain()

        await expect(service.deliver(job({ provider: "", connectionId: "c", key: "k" }))).rejects.toMatchObject({ params: { failureClass: "input" } })
    })
})
