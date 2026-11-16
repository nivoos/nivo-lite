import type { CredentialPrincipal } from "@modules/domain/identity"
import { Injectable } from "@nestjs/common"
import { IsNull, MoreThan, type EntityManager } from "typeorm"
import { EntitlementsService } from "@modules/domain/billing"
import { EventsService } from "@modules/domain/events"
import { StaffDirectoryService } from "@modules/domain/staff"
import { WorkspacesService } from "@modules/domain/workspaces"
import {
    InjectAccountDirectory,
    WorkspaceMembersService,
    type AccountDirectory,
    type MemberListing,
} from "@modules/domain/workspace-members"
import { InjectClock, type Clock } from "@modules/platform/clock"
import { InjectPrimaryEntityManager, callDbFunction } from "@modules/platform/database"
import { InjectEffects, type Effects } from "@modules/platform/effects"
import { unwrapOutcome } from "@modules/platform/primitives"
import { INVITE_TOKEN_EFFECT } from "@modules/queues/invite-command"
import { WorkspaceInvitesError, WorkspaceInvitesErrorCode } from "./errors/workspace-invites.error"
import { isEmailAddress, judgeInvite, normaliseEmail } from "./invite.policy"
import { firstChangedInvite } from "./changed-invite.policy"
import { hashInviteToken, keptTokenCall, mintedTokenOf, uuidOfRow } from "./invite-token.policy"
import { WorkspaceInviteEntity } from "./persistence/entities"
import type {
    AcceptedInvite,
    ChangedInvite,
    InviteAcceptor,
    InviteDelivery,
    InviteDeliveryPort,
    InviteIssuance,
    InvitePreview,
    InviteRequest,
    InviteResult,
    MintedToken,
    InviteState,
    PendingInvite,
} from "./workspace-invites.contracts"
import type { WorkspaceInvitesOptions } from "./workspace-invites.options"
import { InjectInviteDelivery, InjectWorkspaceInvitesOptions } from "./workspace-invites.port"

const DAY_MS = 86_400_000
const PENDING_INVITES_MAX = 200

/** The preview as the invitation row selects it. */
interface InvitePreviewRaw {
    /** The workspace the invitation is for. */
    readonly workspace_id: string
    /** The invited address. */
    readonly email: string
    /** The role it grants. */
    readonly role: string
    /** The staff row it links, when any. */
    readonly staff_id: string | null
    /** `pending`, `revoked`, `accepted` or `expired`. */
    readonly state: string
}

const MANAGERS = ["owner", "manager"] as const

@Injectable()
/** Email invitations into a workspace: issue, resend, copy the link, revoke and accept. */
export class WorkspaceInvitesService {
    constructor(
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
        @InjectClock() private readonly clock: Clock,
        @InjectWorkspaceInvitesOptions() private readonly options: WorkspaceInvitesOptions,
        @InjectAccountDirectory() private readonly accounts: AccountDirectory,
        @InjectInviteDelivery() private readonly delivery: InviteDeliveryPort,
        private readonly members: WorkspaceMembersService,
        private readonly events: EventsService,
        private readonly entitlements: EntitlementsService,
        private readonly workspaces: WorkspacesService,
        private readonly staff: StaffDirectoryService,
        @InjectEffects() private readonly effects: Effects,
    ) {}

    /** The invitations of the caller's workspace that can still be accepted; owner and manager only. */
    async listPending(userId: string, workspaceId: string): Promise<ReadonlyArray<PendingInvite>> {
        await this.members.require(userId, workspaceId, MANAGERS)
        const rows = await this.entityManager.find(WorkspaceInviteEntity, {
            select: { id: true, email: true, role: true, staffId: true, createdAt: true, expiresAt: true },
            where: {
                workspaceId,
                acceptedAt: IsNull(),
                revokedAt: IsNull(),
                declinedAt: IsNull(),
                expiresAt: MoreThan(this.clock.now()),
            },
            order: { createdAt: "DESC" },
            take: PENDING_INVITES_MAX,
        })
        return rows.map((row) => ({
            id: row.id,
            email: row.email,
            role: row.role,
            staffId: row.staffId,
            createdAt: row.createdAt.toISOString(),
            expiresAt: row.expiresAt.toISOString(),
        }))
    }

    /**
     * Issues an invitation and emails it; the token is returned once, inside the link. Owner and manager only. Made for a job
     * (`issuance`), the token is kept on the effect ledger before anything uses it and the invitation row is made once per token, so a run
     * again after a crash finds the invitation, sends no second link and kills no first one; the mail is a ledger effect that throws when
     * it cannot be sent. Made for a person waiting (no `issuance`), a mail that cannot be sent answers `none` and the link to copy.
     */
    async create(userId: string, workspaceId: string, request: InviteRequest, issuance?: InviteIssuance): Promise<InviteResult> {
        const actor = await this.members.require(userId, workspaceId, MANAGERS)
        const email = normaliseEmail(request.email)
        const kept = issuance === undefined ? null : await this.keptToken(issuance)
        const made = kept !== null && (await this.holdsToken(kept))
        if (!made) await this.requireIssuable(userId, workspaceId, request, email)
        const minted = kept ?? (await this.mintToken())
        if (!made) await this.store(userId, workspaceId, request, email, minted, actor.displayName)
        const delivery = await this.deliver(issuance, email, this.redirectOf(minted.token))
        return { email, link: this.linkOf(minted.token), delivery }
    }

    /** Gives a pending invitation a new link (the old one stops working) and emails it again; made for a job, the new link is kept first and a run again rotates nothing and records nothing twice. */
    async resend(userId: string, workspaceId: string, inviteId: string, issuance?: InviteIssuance): Promise<InviteResult> {
        const actor = await this.members.require(userId, workspaceId, MANAGERS)
        const { invite, minted, fresh } = await this.rotated(workspaceId, inviteId, issuance)
        if (fresh) {
            await this.events.record({
                workspaceId,
                kind: "member.invite_resent",
                actor: actor.displayName,
                summary: invite.email,
            })
        }
        const delivery = await this.deliver(issuance, invite.email, this.redirectOf(minted.token))
        return { email: invite.email, link: this.linkOf(minted.token), delivery }
    }

    /** Issues a fresh link without emailing it; the stored hash cannot be reversed, so the old link stops working. Made for a job, the link is kept first so a run again answers the same link. */
    async copyLink(userId: string, workspaceId: string, inviteId: string, issuance?: InviteIssuance): Promise<InviteResult> {
        await this.members.require(userId, workspaceId, MANAGERS)
        const { invite, minted } = await this.rotated(workspaceId, inviteId, issuance)
        return { email: invite.email, link: this.linkOf(minted.token), delivery: "none" }
    }

    /** Revokes a pending invitation: its link stops working at once. */
    async revoke(userId: string, workspaceId: string, inviteId: string): Promise<void> {
        const actor = await this.members.require(userId, workspaceId, MANAGERS)
        const result = await this.entityManager
            .createQueryBuilder(WorkspaceInviteEntity, "i")
            .update()
            .set({ revokedAt: this.clock.now() })
            .where(
                "id = :inviteId AND workspace_id = :workspaceId AND accepted_at IS NULL AND revoked_at IS NULL AND declined_at IS NULL",
                {
                    inviteId,
                    workspaceId,
                },
            )
            .returning("id, email, role")
            .execute()
        const revoked = firstChangedInvite(result.raw)
        if (revoked === undefined) throw new WorkspaceInvitesError({ code: WorkspaceInvitesErrorCode.NotFound })
        await this.events.record({
            workspaceId,
            kind: "member.invite_revoked",
            actor: actor.displayName,
            summary: revoked.email,
        })
    }

    /** Resolves a preview token to its stored invitation, including historical states. */
    async authenticateLink(token: string): Promise<CredentialPrincipal> {
        const row = await this.findByToken(token)
        if (row === null) throw new WorkspaceInvitesError({ code: WorkspaceInvitesErrorCode.Invalid })
        return { kind: "link-token", subject: row.id, workspaceId: row.workspaceId }
    }

    /** What the person sees before accepting; a token that matches nothing is refused. */
    async preview(token: string, principal?: CredentialPrincipal): Promise<InvitePreview> {
        if (principal !== undefined) {
            const bound = await this.authenticateLink(token)
            if (
                principal.kind !== bound.kind ||
                principal.subject !== bound.subject ||
                principal.workspaceId !== bound.workspaceId
            )
                throw new WorkspaceInvitesError({ code: WorkspaceInvitesErrorCode.Invalid })
        }
        const row = await this.entityManager
            .createQueryBuilder(WorkspaceInviteEntity, "i")
            .select("i.workspace_id", "workspace_id")
            .addSelect("i.email", "email")
            .addSelect("i.role", "role")
            .addSelect("i.staff_id", "staff_id")
            .addSelect(
                `CASE WHEN i.revoked_at IS NOT NULL THEN 'revoked'
                WHEN i.declined_at IS NOT NULL THEN 'declined'
                WHEN i.accepted_at IS NOT NULL THEN 'accepted'
                WHEN i.expires_at < :now THEN 'expired'
                ELSE 'pending' END`,
                "state",
            )
            .where("i.token_hash = :tokenHash", { tokenHash: hashInviteToken(token) })
            .setParameter("now", this.clock.now())
            .limit(1)
            .getRawOne<InvitePreviewRaw>()
        if (row === undefined) throw new WorkspaceInvitesError({ code: WorkspaceInvitesErrorCode.Invalid })
        const [workspaceName, linked] = await Promise.all([
            this.workspaces.nameOf(row.workspace_id),
            row.staff_id === null ? [] : this.staff.namesOf(row.workspace_id, [row.staff_id]),
        ])
        return {
            workspaceName,
            email: row.email,
            role: row.role,
            staffName: linked[0]?.name ?? null,
            state: row.state,
        }
    }

    /** Accepts the invitation as the signed-in person whose email matches it; answers the workspace they joined. */
    async accept(acceptor: InviteAcceptor, token: string): Promise<AcceptedInvite> {
        return this.acceptRow(acceptor, await this.findByToken(token))
    }

    /** Accepts, by its id, an invitation to the signed-in person (the lobby's pending invitations), as `accept` does by link. */
    async acceptById(acceptor: InviteAcceptor, inviteId: string): Promise<AcceptedInvite> {
        return this.acceptRow(
            acceptor,
            await this.entityManager.findOne(WorkspaceInviteEntity, { where: { id: inviteId } }),
        )
    }

    private async acceptRow(acceptor: InviteAcceptor, row: WorkspaceInviteEntity | null): Promise<AcceptedInvite> {
        const invite = unwrapOutcome(
            judgeInvite(row === null ? undefined : toInviteState(row), acceptor.email ?? "", this.clock.now()),
            WorkspaceInvitesError,
        )
        await this.entitlements.requireRoomForMember(invite.workspaceId)
        const account = await this.accounts.accountOf(acceptor.id)
        const displayName = account.kind === "ok" ? account.value.displayName : "Member"
        await this.members.join({
            workspaceId: invite.workspaceId,
            userId: acceptor.id,
            role: invite.role,
            staffId: invite.staffId,
            displayName,
        })
        await this.entityManager.update(
            WorkspaceInviteEntity,
            { id: invite.id, acceptedAt: IsNull() },
            { acceptedAt: this.clock.now(), acceptedBy: acceptor.id },
        )
        await this.events.record({
            workspaceId: invite.workspaceId,
            kind: "member.joined",
            actor: displayName,
            summary: acceptor.email ?? "",
        })
        return { workspaceId: invite.workspaceId }
    }

    private expiry(from: Date): Date {
        return new Date(from.getTime() + this.options.inviteDays * DAY_MS)
    }

    private linkOf(token: string): string {
        return `${this.options.siteUrl}/invite/${token}`
    }

    private redirectOf(token: string): string {
        return `${this.options.siteUrl}/auth/confirm?next=${encodeURIComponent("/invite/" + token)}`
    }

    private async requireStaffFree(
        workspaceId: string,
        staffId: string,
        email: string,
        people: ReadonlyArray<MemberListing>,
    ): Promise<void> {
        const held = await this.entityManager
            .createQueryBuilder(WorkspaceInviteEntity, "i")
            .select("i.id")
            .where("i.workspace_id = :workspaceId AND i.staff_id = :staffId", { workspaceId, staffId })
            .andWhere(
                "i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.declined_at IS NULL AND i.expires_at > :now",
                {
                    now: this.clock.now(),
                },
            )
            .andWhere("lower(i.email) <> :email", { email })
            .limit(1)
            .getRawOne<{ readonly i_id: string }>()
        if (people.some((member) => member.staffId === staffId) || held !== undefined) {
            throw new WorkspaceInvitesError({ code: WorkspaceInvitesErrorCode.StaffTaken })
        }
    }

    private async mintToken(): Promise<MintedToken> {
        const [first, second] = await Promise.all([this.uuid(), this.uuid()])
        return mintedTokenOf(first, second)
    }

    private async uuid(): Promise<string> {
        const [row] = await callDbFunction<{ gen_random_uuid: string }>(this.entityManager, "gen_random_uuid", [])
        return uuidOfRow(row)
    }

    private findByToken(token: string): Promise<WorkspaceInviteEntity | null> {
        return this.entityManager.findOne(WorkspaceInviteEntity, { where: { tokenHash: hashInviteToken(token) } })
    }

    /** What the room, the address, the staff row and the team say about a new invitation: the refusals a person is shown. */
    private async requireIssuable(userId: string, workspaceId: string, request: InviteRequest, email: string): Promise<void> {
        const pending = await this.entityManager.count(WorkspaceInviteEntity, {
            where: {
                workspaceId,
                acceptedAt: IsNull(),
                revokedAt: IsNull(),
                declinedAt: IsNull(),
                expiresAt: MoreThan(this.clock.now()),
            },
        })
        await this.entitlements.requireRoomForInvite(workspaceId, pending)
        if (!isEmailAddress(email)) throw new WorkspaceInvitesError({ code: WorkspaceInvitesErrorCode.EmailInvalid })
        const people = await this.members.list(userId, workspaceId)
        if (people.some((member) => member.email.toLowerCase() === email)) {
            throw new WorkspaceInvitesError({ code: WorkspaceInvitesErrorCode.AlreadyMember })
        }
        const staffId = request.staffId ?? null
        if (staffId !== null) await this.requireStaffFree(workspaceId, staffId, email, people)
    }

    /** Stores the invitation row (the earlier pending ones of the address are revoked in the same transaction) with the evidence line. */
    private async store(
        userId: string,
        workspaceId: string,
        request: InviteRequest,
        email: string,
        minted: MintedToken,
        actorName: string,
    ): Promise<void> {
        await this.entityManager.transaction(async (scoped) => {
            const now = this.clock.now()
            await scoped
                .createQueryBuilder(WorkspaceInviteEntity, "i")
                .update()
                .set({ revokedAt: now })
                .where(
                    "workspace_id = :workspaceId AND lower(email) = :email AND accepted_at IS NULL AND revoked_at IS NULL AND declined_at IS NULL",
                    {
                        workspaceId,
                        email,
                    },
                )
                .execute()
            await scoped.insert(WorkspaceInviteEntity, {
                workspaceId,
                email,
                role: request.role,
                staffId: request.staffId ?? null,
                tokenHash: hashInviteToken(minted.token),
                invitedBy: userId,
                expiresAt: this.expiry(now),
            })
            await this.events.record(
                { workspaceId, kind: "member.invited", actor: actorName, summary: `${email} \u00b7 ${request.role}` },
                scoped,
            )
        })
    }

    /** The token of a job's invitation: made once and KEPT SEALED on the effect ledger (a link token is a secret), so every run of the job reads the same one. */
    private keptToken(issuance: InviteIssuance): Promise<MintedToken> {
        return this.effects.once(`${issuance.key}:token`, INVITE_TOKEN_EFFECT, keptTokenCall(() => this.mintToken()))
    }

    /** True when an invitation row already holds this token's hash: an earlier run of the job made it. */
    private async holdsToken(minted: MintedToken): Promise<boolean> {
        const held = await this.entityManager.findOne(WorkspaceInviteEntity, {
            select: { id: true },
            where: { tokenHash: hashInviteToken(minted.token) },
        })
        return held !== null
    }

    /** Emails the invitation: a job's mail is a ledger effect that throws when it cannot be sent; a person waiting gets `none` and the link to copy. */
    private deliver(issuance: InviteIssuance | undefined, email: string, redirectTo: string): Promise<InviteDelivery> {
        return issuance === undefined
            ? this.delivery.deliverInvite(email, redirectTo)
            : this.delivery.deliverInviteOnce(issuance.key, email, redirectTo)
    }

    /**
     * Gives the invitation its new token. A job's token is the kept one, and an invitation that already holds its hash was rotated by
     * an earlier run (`fresh` false): it is read, not changed.
     */
    private async rotated(
        workspaceId: string,
        inviteId: string,
        issuance: InviteIssuance | undefined,
    ): Promise<{ invite: ChangedInvite; minted: MintedToken; fresh: boolean }> {
        const kept = issuance === undefined ? null : await this.keptToken(issuance)
        if (kept !== null) {
            const done = await this.entityManager.findOne(WorkspaceInviteEntity, {
                where: { id: inviteId, workspaceId, tokenHash: hashInviteToken(kept.token) },
            })
            if (done !== null) return { invite: { id: done.id, email: done.email, role: done.role }, minted: kept, fresh: false }
        }
        const minted = kept ?? (await this.mintToken())
        const result = await this.entityManager
            .createQueryBuilder(WorkspaceInviteEntity, "i")
            .update()
            .set({ tokenHash: hashInviteToken(minted.token), expiresAt: this.expiry(this.clock.now()) })
            .where(
                "id = :inviteId AND workspace_id = :workspaceId AND accepted_at IS NULL AND revoked_at IS NULL AND declined_at IS NULL",
                {
                    inviteId,
                    workspaceId,
                },
            )
            .returning("id, email, role")
            .execute()
        const invite = firstChangedInvite(result.raw)
        if (invite === undefined) throw new WorkspaceInvitesError({ code: WorkspaceInvitesErrorCode.NotFound })
        return { invite, minted, fresh: true }
    }
}

const toInviteState = (row: WorkspaceInviteEntity): InviteState => ({
    id: row.id,
    workspaceId: row.workspaceId,
    email: row.email,
    role: row.role,
    staffId: row.staffId,
    acceptedAt: row.acceptedAt === null ? null : row.acceptedAt.toISOString(),
    revokedAt: row.revokedAt === null ? null : row.revokedAt.toISOString(),
    declinedAt: row.declinedAt === null ? null : row.declinedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
})
