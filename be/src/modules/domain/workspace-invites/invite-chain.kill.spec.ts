import { buildInviteChain } from "@tests/fixtures/builders/invite-chain.builder"
import type { ClaimedJob } from "@modules/platform/jobs"
import { WorkspaceInviteEntity } from "./persistence/entities"

const JOB: ClaimedJob = { jobId: "job-1", kind: "invite_command", fencingToken: 1, currentStep: null, payload: { commandId: "command-1" } }
const payload = { commandId: "command-1" }

/** The process "dies" here: the error a call throws when its worker is gone before the call's outcome is known. */
const killed = (): Error => Object.assign(new Error("worker killed"), { code: "ECONNRESET" })

describe("invite chain: the job is run twice, the second run repeats no finished step and no settled effect", () => {
    it("a kill after the invitation row was made and before the mail: the second run finds the row, makes no second invitation and sends the one mail with the link of the first token", async () => {
        const t = await buildInviteChain()
        t.ledger.failNext("job-1:mail", killed())

        await expect(t.service.run(payload, JOB)).rejects.toMatchObject({ code: "ECONNRESET" })

        expect(t.em.insert).toHaveBeenCalledTimes(1)
        expect(t.sent).toEqual([])
        expect(t.row.state).toBe("running")
        expect(t.ledger.rows.get("job-1:token")?.done).toBe(true)
        // The link token is a secret: the ledger keeps it as a sealed text, never the token itself.
        expect(String(t.ledger.rows.get("job-1:token")?.kept)).toMatch(/^sealed:/u)

        await t.service.run(payload, JOB)

        // One invitation row, one token minted (two uuids), one mail, one answer on the command.
        expect(t.em.insert).toHaveBeenCalledTimes(1)
        expect(t.em.insert).toHaveBeenCalledWith(WorkspaceInviteEntity, expect.objectContaining({ email: "an@example.test", workspaceId: "ws-1" }))
        expect(t.em.query).toHaveBeenCalledTimes(2)
        expect(t.ledger.rows.get("job-1:token")?.acts).toBe(1)
        expect(t.sent).toHaveLength(1)
        expect(t.events.record).toHaveBeenCalledTimes(1)
        expect(t.commands.succeed).toHaveBeenCalledTimes(1)
        const answered = t.commands.succeed.mock.calls[0]?.[1]
        expect(answered).toMatchObject({ email: "an@example.test", delivery: "invited" })
        // The link the asker is shown carries the very token the mail carries: no rotation between the runs.
        const token = String(answered?.link).split("/invite/")[1] ?? ""
        expect(token).not.toBe("")
        expect(decodeURIComponent(t.sent[0] ?? "")).toContain(token)
    })

    it("a kill after the mail left and before the command was answered: the second run mails the SAME link again (the lost outcome of a repeatable effect) and a third run sends nothing", async () => {
        const t = await buildInviteChain()
        t.ledger.loseNext("job-1:mail", killed())

        await expect(t.service.run(payload, JOB)).rejects.toMatchObject({ code: "ECONNRESET" })
        await t.service.run(payload, JOB)

        expect(t.em.insert).toHaveBeenCalledTimes(1)
        expect(t.sent).toHaveLength(2)
        expect(t.sent[1]).toBe(t.sent[0])
        expect(t.commands.succeed).toHaveBeenCalledTimes(1)

        // The command is settled: a delivery of the same job again begins nothing and sends nothing.
        await t.service.run(payload, JOB)

        expect(t.sent).toHaveLength(2)
        expect(t.commands.succeed).toHaveBeenCalledTimes(1)
    })

    it("a resend killed after its link was kept rotates once: the second run reads the rotated invitation, mails once and records the evidence once", async () => {
        const t = await buildInviteChain({ id: "command-1", workspaceId: "ws-1", requestedBy: "owner-1", kind: "invite.resend", input: { inviteId: "invite-1" } })
        t.ledger.failNext("job-1:mail", killed())

        await expect(t.service.run(payload, JOB)).rejects.toMatchObject({ code: "ECONNRESET" })
        await t.service.run(payload, JOB)

        expect(t.ledger.rows.get("job-1:token")?.acts).toBe(1)
        expect(t.sent).toHaveLength(1)
        expect(t.events.record).toHaveBeenCalledTimes(1)
        expect(t.commands.succeed).toHaveBeenCalledTimes(1)
    })
})
