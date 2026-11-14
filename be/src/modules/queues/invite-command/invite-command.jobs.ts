import { defineJob, type JobDefinition, type JobEffectDeclaration } from "@modules/platform/jobs"
import { INVITE_COMMAND_QUEUE, isInviteCommandPayload, type InviteCommandPayload } from "./invite-command.queue"

/**
 * The effect that makes the single-use token of an invitation link. The token is KEPT on the ledger row, so a run again reads the one
 * it made: the link in the mail, the link the asker is shown and the hash the invitation row stores are the same token, whatever the
 * crashes between them. A lost outcome makes a token again (nothing has used it yet).
 */
export const INVITE_TOKEN_EFFECT: JobEffectDeclaration = { name: "invite.token", settle: "repeatable" }

/** The effect that settles who the invitation mail goes to and which link it carries (an account for a new person, its one password link); kept, so a run again sends the same link. */
export const INVITE_PLAN_EFFECT: JobEffectDeclaration = { name: "invite.plan", settle: "repeatable" }

/** The effect of sending the invitation mail. A repeat is the same mail with the same link; the one declared `repeatable` because the plan is kept. */
export const INVITE_MAIL_EFFECT: JobEffectDeclaration = { name: "invite.mail", settle: "repeatable" }

/**
 * The job that serves one invitation command a person asked for (create, send again, copy the link, platform re-issue). The asker waits
 * on the command row, so it is on the `waited` ladder. The once key is the command: the web app's request function writes the command and the job
 * in one transaction, so the invitation is made once per command.
 */
export const ISSUE_INVITE_JOB: JobDefinition<InviteCommandPayload> = defineJob<InviteCommandPayload>({
    name: INVITE_COMMAND_QUEUE,
    queue: INVITE_COMMAND_QUEUE,
    ladder: "waited",
    payload: isInviteCommandPayload,
    onceKey: (payload) => `${INVITE_COMMAND_QUEUE}:${payload.commandId}`,
    next: [],
    effects: [INVITE_TOKEN_EFFECT, INVITE_PLAN_EFFECT, INVITE_MAIL_EFFECT],
})
