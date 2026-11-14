import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { ConnectionSecretsService } from "@modules/domain/connection-secrets"
import { ConnectionsErrorCode, ConnectionsService } from "@modules/domain/connections"
import { ZaloWizardDraftsService } from "@modules/domain/zalo-wizard-drafts"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import type { QueueDelivery } from "@modules/platform/queue"
import { ok, refused } from "@modules/platform/primitives"
import { RUN_ZALO_WIZARD_JOB, type ZaloWizardPayload } from "@modules/queues/zalo-wizard"
import { buildRunner, deliveryOf, networkDown, startsOf } from "@tests/fixtures/builders/provider-connections.builder"
import { ZaloCredentialsService } from "./zalo-credentials.service"
import { ZaloWizardService } from "./zalo-wizard.service"

/** The processor of the wizard job as the feature composes it: one domain method, the dead letter writes the ticket. */
class WizardProcessor extends FencedProcessor {
    override readonly queue = "zalo_wizard"
    override readonly definition: JobDefinition<ZaloWizardPayload> = RUN_ZALO_WIZARD_JOB
    constructor(private readonly steps: ZaloWizardService) {
        super()
    }
    async process(job: ClaimedJob): Promise<void> {
        await this.steps.run(job.payload)
    }
    override async onFailed(delivery: QueueDelivery, _cause: unknown): Promise<void> {
        await this.steps.stopped(delivery.payload)
    }
}

const wizard = { workspaceId: "ws-1", connectionId: "c-1", command: "app" as const, ticket: "ticket-1" }
const delivery = (attempt: number) => deliveryOf("zalo_wizard", "run-zalo-wizard", wizard, attempt)

const build = async () => {
    const secrets = mock<ConnectionSecretsService>()
    secrets.seal.mockImplementation((plain) => `sealed:${plain}`)
    secrets.save.mockResolvedValue(undefined)
    const drafts = mock<ZaloWizardDraftsService>()
    drafts.draftOf.mockResolvedValue({ present: true, appId: "app-1", appSecret: "app-secret", oaSecret: "" })
    drafts.dropDraft.mockResolvedValue(undefined)
    const connections = mock<ConnectionsService>()
    connections.intakeOf.mockResolvedValue(ok({ id: "c-1", workspaceId: "ws-1", status: "pending" }))
    connections.settleWizard.mockResolvedValue(undefined)
    const moduleRef = await Test.createTestingModule({
        providers: [
            ZaloWizardService,
            { provide: ConnectionSecretsService, useValue: secrets },
            { provide: ZaloWizardDraftsService, useValue: drafts },
            { provide: ConnectionsService, useValue: connections },
            { provide: ZaloCredentialsService, useValue: mock<ZaloCredentialsService>() },
        ],
    }).compile()
    return { service: moduleRef.get(ZaloWizardService), secrets, drafts, connections }
}

describe("zalo wizard chain: a failure ends as a bounded retry (transient only), then ONE dead letter, and a resume finishes", () => {
    it("the database unreachable: the waited ladder 1, 2, 4, 8 min, then one dead letter; the ticket reads failed meanwhile and done after the resume", async () => {
        const t = await build()
        const run = await buildRunner()
        const processor = new WizardProcessor(t.service)
        t.secrets.save.mockRejectedValue(networkDown())
        run.claimed(wizard)

        const seen = await startsOf(run.runner, processor, delivery, 5)

        expect(seen).toEqual([60, 120, 240, 480, "returned"])
        expect(run.claims.park).toHaveBeenCalledTimes(1)
        expect(run.deadLetters.raise).toHaveBeenCalledTimes(1)
        // The retries wrote no result; the dead letter wrote the stopped one, so the screen stops waiting.
        expect(t.connections.settleWizard.mock.calls).toEqual([
            ["c-1", "ticket-1", { command: "app", state: "failed", url: "", code: "CHANNELS_WIZARD_STOPPED", oaSecretSaved: false }],
        ])
        expect(t.drafts.dropDraft).not.toHaveBeenCalled()

        t.secrets.save.mockResolvedValue(undefined)
        const resumed = await buildRunner(1)
        resumed.claimed(wizard)
        await resumed.runner.run(processor, delivery(1))

        expect(t.drafts.dropDraft).toHaveBeenCalledTimes(1)
        expect(t.connections.settleWizard).toHaveBeenCalledTimes(2)
        expect(t.connections.settleWizard.mock.calls[1]?.[2]).toMatchObject({ command: "app", state: "done" })
        expect(resumed.claims.complete).toHaveBeenCalledTimes(1)
        expect(resumed.deadLetters.raise).not.toHaveBeenCalled()
    })

    it("a connection that is not the owner's is a typed answer: the ticket reads failed, the job completes, nothing is parked", async () => {
        const t = await build()
        const run = await buildRunner()
        const processor = new WizardProcessor(t.service)
        t.connections.intakeOf.mockResolvedValue(refused(ConnectionsErrorCode.NotFound))
        run.claimed(wizard)

        await run.runner.run(processor, delivery(1))

        expect(t.connections.settleWizard.mock.calls).toEqual([
            ["c-1", "ticket-1", { command: "app", state: "failed", url: "", code: "CHANNELS_CONNECTION_NOT_FOUND", oaSecretSaved: false }],
        ])
        expect(run.claims.complete).toHaveBeenCalledTimes(1)
        expect(run.claims.park).not.toHaveBeenCalled()
        expect(run.deadLetters.raise).not.toHaveBeenCalled()
    })
})
