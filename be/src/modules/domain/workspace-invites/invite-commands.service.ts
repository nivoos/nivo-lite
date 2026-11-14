import { Injectable } from "@nestjs/common"
import { AppCommandsService, COMMAND_STOPPED, type AppCommand, type AppCommandResult } from "@modules/domain/app-commands"
import { PlatformAuditService } from "@modules/domain/platform-audit"
import { isDomainError } from "@modules/platform/errors"
import { EffectsError } from "@modules/platform/effects"
import type { ClaimedJob } from "@modules/platform/jobs"
import { classifyFailure, QueueErrorCode } from "@modules/platform/queue"
import { inviteCommandPayloadOf } from "@modules/queues/invite-command"
import { InviteSupportService } from "./invite-support.service"
import type { InviteIssuance } from "./workspace-invites.contracts"
import { WorkspaceInvitesService } from "./workspace-invites.service"

/** True for a refusal the input itself earned: a capability error of class `input` that is not the effects ledger's own. A missing setting, a failure a later try may mend and the ledger's unknown outcome are the runner's (ladder, dead letter). */
const isRefusal = (cause: unknown): cause is { readonly code: string } =>
    isDomainError(cause) && !(cause instanceof EffectsError) && classifyFailure(cause) === "input"

/** The text a command input field holds, or empty when it holds no text. */
const textOf = (value: unknown): string => (typeof value === "string" ? value : "")

@Injectable()
/**
 * Serves the invitation commands the web app writes to the database: an invitation is created, sent again, linked or re-issued by the
 * platform team, and the asker finds the answer (or the code of the refusal) on the command row.
 */
export class InviteCommandsService {
    constructor(
        private readonly commands: AppCommandsService,
        private readonly invites: WorkspaceInvitesService,
        private readonly support: InviteSupportService,
        private readonly audits: PlatformAuditService,
    ) {}

    /**
     * Serves the command a claimed job names. The invitation is made once per command: its token and its mail are effects keyed by the
     * job (`<jobId>:...`), so a run again after a crash finds what was made and sends nothing twice, and a resume never rotates the token.
     * A refusal the input earned (a bad address, a taken staff row, a missing invitation: a domain error of class input) settles
     * the command as failed with its code and the job ends; anything else is thrown for the runner (ladder, then ONE dead letter). A
     * payload that names no command, or a command already settled, is left as it is.
     */
    async run(payload: object, job: ClaimedJob): Promise<void> {
        const named = inviteCommandPayloadOf(payload)
        if (named === null) return
        const command = await this.commands.begin(named.commandId, (job.resumeCount ?? 0) > 0)
        if (command === null) return
        try {
            const result = await this.serve(command, { key: job.jobId })
            if (result === null) await this.commands.fail(command.id, QueueErrorCode.Unrecoverable)
            else await this.commands.succeed(command.id, result)
        } catch (cause) {
            if (!isRefusal(cause)) throw cause
            await this.commands.fail(command.id, cause.code)
        }
    }

    /** The job was dead-lettered (the work stopped; nothing was refused): the command says so, so the asker stops waiting, and a resume of the job takes it back. */
    async stopped(payload: object): Promise<void> {
        const named = inviteCommandPayloadOf(payload)
        if (named !== null) await this.commands.fail(named.commandId, COMMAND_STOPPED)
    }

    /** Does what the command asks, as the person who asked; answers what the web app shows, or null for a kind it does not know. */
    private async serve(command: AppCommand, issuance: InviteIssuance): Promise<AppCommandResult | null> {
        const workspaceId = command.workspaceId ?? ""
        const inviteId = textOf(command.input.inviteId)
        if (command.kind === "invite.create") {
            const staffId = textOf(command.input.staffId)
            const created = await this.invites.create(
                command.requestedBy,
                workspaceId,
                {
                    email: textOf(command.input.email),
                    role: command.input.role === "manager" ? "manager" : "staff",
                    staffId: staffId === "" ? null : staffId,
                },
                issuance,
            )
            return { ...created }
        }
        if (command.kind === "invite.resend") {
            return { ...(await this.invites.resend(command.requestedBy, workspaceId, inviteId, issuance)) }
        }
        if (command.kind === "invite.link") {
            return { ...(await this.invites.copyLink(command.requestedBy, workspaceId, inviteId, issuance)) }
        }
        if (command.kind === "admin.invite.resend") {
            const issued = await this.support.reissue(workspaceId, inviteId, issuance)
            await this.audits.record({
                actorId: command.requestedBy,
                actorEmail: textOf(command.input.actorEmail),
                action: "invite.resend",
                workspaceId,
                data: { inviteId, email: issued.email, delivery: issued.delivery },
            })
            return { ...issued }
        }
        return null
    }
}
