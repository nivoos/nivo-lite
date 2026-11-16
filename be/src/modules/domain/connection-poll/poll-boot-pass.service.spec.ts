import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { LOGGER, type Logger } from "@modules/platform/logging"
import { ConnectionPollLogEvent } from "./connection-poll.log-events"
import { PollBootPassService } from "./poll-boot-pass.service"
import { PollScheduleService } from "./poll-schedule.service"

const build = async () => {
    const schedule = mock<PollScheduleService>()
    const logger = mock<Logger>()
    const moduleRef = await Test.createTestingModule({
        providers: [
            PollBootPassService,
            { provide: PollScheduleService, useValue: schedule },
            { provide: LOGGER, useValue: logger },
        ],
    }).compile()
    return { pass: moduleRef.get(PollBootPassService), schedule, logger }
}

describe("PollBootPassService the pass at process start", () => {
    it("makes every scheduled account due now, once, when the application bootstraps", async () => {
        const { pass, schedule, logger } = await build()
        schedule.dueNow.mockResolvedValue(undefined)

        await pass.onApplicationBootstrap()

        expect(schedule.dueNow).toHaveBeenCalledTimes(1)
        expect(logger.error).not.toHaveBeenCalled()
    })

    it("never stops the boot: a failure to mark is logged with its cause and the cadence reads the accounts later", async () => {
        const { pass, schedule, logger } = await build()
        const cause = new Error("database down")
        schedule.dueNow.mockRejectedValue(cause)

        await expect(pass.onApplicationBootstrap()).resolves.toBeUndefined()

        expect(logger.error).toHaveBeenCalledWith(ConnectionPollLogEvent.BootPassFailed, cause, {})
    })
})
