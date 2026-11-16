import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { LOGGER } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { JobDeadLettersService } from "./job-dead-letters.service"
import { JobsLogEvent } from "./jobs.log-events"
import type { FlowAlerts, ParkedFlowAlert } from "./jobs.port"

const alert: ParkedFlowAlert = {
    kind: "flow-parked",
    jobId: "j-1",
    flowKind: "mail.send",
    failureClass: "code",
    reason: "a bug",
    episode: 0,
    correlationId: "k-1",
    build: "b-1",
    action: "resume",
}

const build = async () => {
    const logger = mock<Logger>()
    const moduleRef = await Test.createTestingModule({
        providers: [JobDeadLettersService, { provide: LOGGER, useValue: logger }],
    }).compile()
    return { deadLetters: moduleRef.get(JobDeadLettersService), logger }
}

describe("JobDeadLettersService", () => {
    it("warns for the operator when nothing is bound to tell a person", async () => {
        const { deadLetters, logger } = await build()

        await expect(deadLetters.raise(alert)).resolves.toBeUndefined()

        expect(logger.warn).toHaveBeenCalledWith(JobsLogEvent.DeadLetterUnbound, { jobId: "j-1", flowKind: "mail.send" })
    })

    it("tells every bound target the alert, one after the other, and warns no more", async () => {
        const { deadLetters, logger } = await build()
        const order: Array<string> = []
        const first = mock<FlowAlerts>()
        const second = mock<FlowAlerts>()
        first.raise.mockImplementation(async () => {
            await Promise.resolve()
            order.push("first")
        })
        second.raise.mockImplementation(() => {
            order.push("second")
            return Promise.resolve()
        })
        deadLetters.bind(first)
        deadLetters.bind(second)

        await deadLetters.raise(alert)

        expect(first.raise).toHaveBeenCalledWith(alert)
        expect(second.raise).toHaveBeenCalledWith(alert)
        expect(order).toEqual(["first", "second"])
        expect(logger.warn).not.toHaveBeenCalled()
    })

    it("lets a failing target fail the raise and leaves the ones after it untold", async () => {
        const { deadLetters } = await build()
        const down = new Error("room down")
        const first = mock<FlowAlerts>()
        const second = mock<FlowAlerts>()
        first.raise.mockRejectedValue(down)
        deadLetters.bind(first)
        deadLetters.bind(second)

        await expect(deadLetters.raise(alert)).rejects.toBe(down)

        expect(second.raise).not.toHaveBeenCalled()
    })
})
