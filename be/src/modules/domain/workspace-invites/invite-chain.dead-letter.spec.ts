import { buildInviteChain } from "@tests/fixtures/builders/invite-chain.builder"
import { buildJobRunner, deliveryOf, refusedByNetwork } from "@tests/fixtures/builders/job-runner-harness.builder"
import { FencedProcessor, type ClaimedJob } from "@modules/platform/jobs"
import { QueueError, QueueErrorCode, type QueueDelivery } from "@modules/platform/queue"
import { INVITE_COMMAND_QUEUE, ISSUE_INVITE_JOB } from "@modules/queues/invite-command"
import { IdentityError, IdentityErrorCode } from "@modules/domain/identity/errors/identity.error"
import type { InviteCommandsService } from "./invite-commands.service"

const payload = { commandId: "command-1" }
const delivery = (attempt: number): QueueDelivery => deliveryOf(INVITE_COMMAND_QUEUE, ISSUE_INVITE_JOB.name, payload, attempt)

/** The processor of the issue-invite job as the feature composes it: one domain method, the dead letter writes the command's state. */
const processorOf = (commands: InviteCommandsService): FencedProcessor =>
    new (class extends FencedProcessor {
        override readonly queue = INVITE_COMMAND_QUEUE
        override readonly definition = ISSUE_INVITE_JOB
        async process(job: ClaimedJob): Promise<void> {
            await commands.run(job.payload, job)
        }
        override async onFailed(deliveryOf2: QueueDelivery): Promise<void> {
            await commands.stopped(deliveryOf2.payload)
        }
    })()

describe("invite chain: a failure ends as a bounded retry (transient only), then ONE dead letter, and a resume finishes without repeating", () => {
    it("a mail that no retry can send (a missing setting: class config) parks at once with ONE item, the command says stopped, and after the cause is fixed the resume re-opens it and finishes with one invitation and one mail", async () => {
        const t = await buildInviteChain()
        const processor = processorOf(t.service)
        const h = await buildJobRunner()
        h.claimed(payload)
        t.failMail.error = new IdentityError({ code: IdentityErrorCode.EffectsMissing })

        await h.runner.run(processor, delivery(1))

        expect(h.claims.fail).not.toHaveBeenCalled()
        expect(h.claims.park).toHaveBeenCalledTimes(1)
        expect(h.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "config", queue: INVITE_COMMAND_QUEUE }))
        expect(h.deadLetters.raise).toHaveBeenCalledTimes(1)
        expect(h.deadLetters.raise).toHaveBeenCalledWith(expect.objectContaining({ kind: "flow-parked", failureClass: "config", jobId: "job-1" }))
        // The row the asker watches: stopped (so they stop waiting), not refused by their input.
        expect(t.row.state).toBe("stopped")
        expect(t.commands.fail).toHaveBeenCalledWith("command-1", "unavailable")
        expect(t.em.insert).toHaveBeenCalledTimes(1)

        // The cause is fixed; a person resumes the job: the command is taken back and the job finishes.
        t.failMail.error = null
        const resumed = await buildJobRunner(1)
        resumed.claimed(payload)
        await resumed.runner.run(processor, delivery(1))

        expect(resumed.claims.complete).toHaveBeenCalledTimes(1)
        expect(resumed.claims.park).not.toHaveBeenCalled()
        expect(resumed.deadLetters.raise).not.toHaveBeenCalled()
        expect(t.row.state).toBe("done")
        expect(t.em.insert).toHaveBeenCalledTimes(1)
        expect(t.ledger.rows.get("job-1:token")?.acts).toBe(1)
        expect(t.sent).toHaveLength(1)
    })

    it("a refusal the input earned (a bad address) settles the command as failed with its code and the job ENDS: no retry, no dead letter", async () => {
        const t = await buildInviteChain({ id: "command-1", workspaceId: "ws-1", requestedBy: "owner-1", kind: "invite.create", input: { email: "not-an-address", role: "staff" } })
        const h = await buildJobRunner()
        h.claimed(payload)

        await h.runner.run(processorOf(t.service), delivery(1))

        expect(t.commands.fail).toHaveBeenCalledWith("command-1", "WORKSPACE_INVITES_EMAIL_INVALID")
        expect(h.claims.complete).toHaveBeenCalledTimes(1)
        expect(h.claims.park).not.toHaveBeenCalled()
        expect(t.sent).toEqual([])
    })

    it("a mail server that is away retries on the waited ladder (60, 120, 240, 480 s), then parks with ONE item; the resume sends the one mail", async () => {
        const t = await buildInviteChain()
        const processor = processorOf(t.service)
        const h = await buildJobRunner()
        h.claimed(payload)
        t.failMail.error = refusedByNetwork()

        const pauses: Array<number> = []
        for (const attempt of [1, 2, 3, 4]) {
            const thrown = await h.runner.run(processor, delivery(attempt)).catch((cause: unknown) => cause)
            expect(thrown).toBeInstanceOf(QueueError)
            expect(thrown).toMatchObject({ code: QueueErrorCode.RetryAfter })
            pauses.push((thrown as QueueError).params.seconds as number)
        }
        expect(pauses).toEqual([60, 120, 240, 480])
        expect(h.claims.park).not.toHaveBeenCalled()

        await h.runner.run(processor, delivery(5))

        expect(h.claims.park).toHaveBeenCalledTimes(1)
        expect(h.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "transient" }))
        expect(h.deadLetters.raise).toHaveBeenCalledTimes(1)
        expect(t.row.state).toBe("stopped")
        // Every start found the invitation made by the first one: one row, one token, the same link.
        expect(t.em.insert).toHaveBeenCalledTimes(1)
        expect(t.ledger.rows.get("job-1:token")?.acts).toBe(1)

        t.failMail.error = null
        const resumed = await buildJobRunner(1)
        resumed.claimed(payload)
        await resumed.runner.run(processor, delivery(1))

        expect(resumed.claims.complete).toHaveBeenCalledTimes(1)
        expect(t.row.state).toBe("done")
        expect(t.sent).toHaveLength(1)
        expect(t.em.insert).toHaveBeenCalledTimes(1)
    })
})
