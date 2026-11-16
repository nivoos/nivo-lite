import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { deadLettersProviders } from "@tests/fixtures/builders/stopped-work-providers.builder"
import { TeamChatNoticesService } from "@modules/domain/team-chat"
import { ERROR_REPORTER } from "@modules/platform/errors"
import type { ErrorReporter } from "@modules/platform/errors"
import { JobDeadLettersService, type ParkedFlowAlert } from "@modules/platform/jobs"
import { LOGGER } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { JobOpsLogEvent } from "./job-ops.log-events"
import { JobParkedAlertsService } from "./job-parked-alerts.service"

const WS = "11111111-1111-4111-8111-111111111111"
const JOB = "44444444-4444-4444-8444-444444444444"

const ALERT: ParkedFlowAlert = {
    kind: "flow-parked",
    jobId: JOB,
    workspaceId: WS,
    flowKind: "extract-knowledge-facts",
    failureClass: "input",
    reason: "KNOWLEDGE_SOURCE_UNREADABLE",
    episode: 0,
    correlationId: JOB,
    build: "build-1",
    action: "resume",
}

/** The binder beside the REAL dead-letter registry it binds to; the chat notices, the error reporter and the logger are doubles. */
const build = async () => {
    const notices = mock<TeamChatNoticesService>()
    notices.postJobParked.mockResolvedValue("posted")
    const reporter = mock<ErrorReporter>()
    reporter.report.mockResolvedValue()
    const logger = mock<Logger>()
    const moduleRef = await Test.createTestingModule({
        providers: [
            JobParkedAlertsService,
            ...deadLettersProviders,
            { provide: TeamChatNoticesService, useValue: notices },
            { provide: ERROR_REPORTER, useValue: reporter },
            { provide: LOGGER, useValue: logger },
        ],
    }).compile()
    await moduleRef.init()
    return { registry: moduleRef.get(JobDeadLettersService), notices, reporter, logger }
}

describe("JobParkedAlertsService", () => {
    it("binds itself on start: an alert raised on the registry posts the job's card in its workspace", async () => {
        const { registry, notices } = await build()

        await registry.raise(ALERT)

        expect(notices.postJobParked).toHaveBeenCalledTimes(1)
        expect(notices.postJobParked).toHaveBeenCalledWith(WS, {
            jobId: JOB,
            job: "extract-knowledge-facts",
            failureClass: "input",
            reason: "KNOWLEDGE_SOURCE_UNREADABLE",
            episode: 0,
        })
    })

    it("hands the notices the episode: the card is once per episode, a person's resume opens the next", async () => {
        const { registry, notices } = await build()
        notices.postJobParked.mockResolvedValueOnce("posted").mockResolvedValueOnce("already").mockResolvedValueOnce("posted")

        await registry.raise(ALERT)
        await registry.raise(ALERT)
        await registry.raise({ ...ALERT, episode: 1 })

        expect(notices.postJobParked.mock.calls.map(([, report]) => report.episode)).toEqual([0, 0, 1])
    })

    it("a job with no workspace posts no card: it is recorded as an app error", async () => {
        const { registry, notices, reporter } = await build()

        await registry.raise({ ...ALERT, workspaceId: undefined })

        expect(notices.postJobParked).not.toHaveBeenCalled()
        expect(reporter.report).toHaveBeenCalledTimes(1)
        expect(reporter.report).toHaveBeenCalledWith(
            "job.parked",
            expect.any(Error),
            expect.objectContaining({ jobId: JOB, job: "extract-knowledge-facts", failureClass: "input", episode: 0 }),
        )
    })

    it("a workspace with no owner is logged and nothing is thrown (the job stays parked and listed)", async () => {
        const { registry, notices, logger } = await build()
        notices.postJobParked.mockResolvedValue("no_owner")

        await expect(registry.raise(ALERT)).resolves.toBeUndefined()

        expect(logger.warn).toHaveBeenCalledWith(JobOpsLogEvent.ParkedCardFailed, { jobId: JOB, workspaceId: WS })
    })
})
