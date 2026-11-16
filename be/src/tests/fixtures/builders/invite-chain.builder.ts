import { Test } from "@nestjs/testing"
import { FakeClock, fakeTransaction, mock, mockEntityManager } from "@starci/jest-preset"
import { AppCommandsService } from "@modules/domain/app-commands"
import type { AppCommand } from "@modules/domain/app-commands"
import { EntitlementsService } from "@modules/domain/billing"
import { EventsService } from "@modules/domain/events"
import { PlatformAuditService } from "@modules/domain/platform-audit"
import { StaffDirectoryService } from "@modules/domain/staff"
import { InviteCommandsService, InviteSupportService, WorkspaceInvitesService } from "@modules/domain/workspace-invites"
import { INVITE_DELIVERY, WORKSPACE_INVITES_OPTIONS } from "@modules/domain/workspace-invites/workspace-invites.port"
import type { InviteDeliveryPort } from "@modules/domain/workspace-invites/workspace-invites.contracts"
import { WorkspaceInviteEntity } from "@modules/domain/workspace-invites/persistence/entities"
import { ACCOUNT_DIRECTORY, WorkspaceMembersService } from "@modules/domain/workspace-members"
import type { AccountDirectory } from "@modules/domain/workspace-members"
import { WorkspacesService } from "@modules/domain/workspaces"
import { CLOCK } from "@modules/platform/clock"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { INVITE_MAIL_EFFECT } from "@modules/queues/invite-command"
import { actorOf, listingOf, NOW } from "./l2-workspace-invites.builder"
import { fakeQueryBuilder } from "./entity-query-builder-fake.builder"
import { keptEffectsLedger } from "./kept-effects.builder"
import { MINTED } from "./workspace-invites-service.builder"

/** The command a person asked for: invite an address as staff. */
export const CREATE_COMMAND: AppCommand = {
    id: "command-1",
    workspaceId: "ws-1",
    requestedBy: "owner-1",
    kind: "invite.create",
    input: { email: "an@example.test", role: "staff" },
}

/** The invitation row a look by token hash finds once an earlier run made it. */
const MADE_INVITE = { id: "invite-1", email: "an@example.test", role: "staff" } as WorkspaceInviteEntity

/**
 * The invitation chain as the web app's command job runs it: the real command service and the real invitations service over mocked
 * ports, the semantics of a kept effects ledger, and a mail that is a ledger effect keyed by the job (`<jobId>:mail`). It counts the
 * mails that left and the invitation rows made, and keeps the command's state the way `app_commands` does (a resume also takes the
 * command its own dead letter stopped).
 */
export const buildInviteChain = async (command: AppCommand = CREATE_COMMAND) => {
    const ledger = keptEffectsLedger()
    const em = mockEntityManager({
        query: MINTED,
        count: [WorkspaceInviteEntity, 0],
        findOne: [
            [WorkspaceInviteEntity, null],
            [WorkspaceInviteEntity, MADE_INVITE],
        ],
        insert: [WorkspaceInviteEntity, { identifiers: [], generatedMaps: [], raw: [] }],
    })
    const tx = fakeTransaction(em)
    const sent: Array<string> = []
    const failMail = { error: null as Error | null }
    const delivery: InviteDeliveryPort = {
        deliverInvite: () => Promise.resolve("none"),
        deliverInviteOnce: async (key, _email, redirectTo) => {
            await ledger.effects.once(`${key}:mail`, INVITE_MAIL_EFFECT, {
                act: () => {
                    if (failMail.error !== null) return Promise.reject(failMail.error)
                    sent.push(redirectTo)
                    return Promise.resolve(true)
                },
                keep: () => true,
                from: () => true,
            })
            return "invited"
        },
    }
    const row = { state: "queued" as "queued" | "running" | "done" | "failed" | "stopped", code: null as string | null }
    const commands = mock<AppCommandsService>()
    commands.begin.mockImplementation((_id, resumed) => {
        if (row.state === "queued" || row.state === "running" || (resumed === true && row.state === "stopped")) {
            row.state = "running"
            return Promise.resolve(command)
        }
        return Promise.resolve(null)
    })
    commands.succeed.mockImplementation(() => {
        row.state = "done"
        return Promise.resolve()
    })
    commands.fail.mockImplementation((_id, code) => {
        row.state = code === "unavailable" ? "stopped" : "failed"
        row.code = code
        return Promise.resolve()
    })
    const members = mock<WorkspaceMembersService>()
    members.require.mockResolvedValue(actorOf())
    members.list.mockResolvedValue([listingOf()])
    const revoke = fakeQueryBuilder({ execute: { raw: [{ id: "invite-1", email: "an@example.test", role: "staff" }] } })
    em.createQueryBuilder.mockReturnValue(revoke.builder)
    const events = mock<EventsService>()
    const moduleRef = await Test.createTestingModule({
        providers: [
            WorkspaceInvitesService,
            InviteCommandsService,
            ...ledger.providers,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: em },
            { provide: CLOCK, useValue: new FakeClock(NOW) },
            { provide: WORKSPACE_INVITES_OPTIONS, useValue: { delivery: "invite-delivery", siteUrl: "https://app.test", inviteDays: 7 } },
            { provide: ACCOUNT_DIRECTORY, useValue: mock<AccountDirectory>() },
            { provide: INVITE_DELIVERY, useValue: delivery },
            { provide: WorkspaceMembersService, useValue: members },
            { provide: EventsService, useValue: events },
            { provide: EntitlementsService, useValue: mock<EntitlementsService>() },
            { provide: WorkspacesService, useValue: mock<WorkspacesService>() },
            { provide: StaffDirectoryService, useValue: mock<StaffDirectoryService>() },
            { provide: AppCommandsService, useValue: commands },
            { provide: InviteSupportService, useValue: mock<InviteSupportService>() },
            { provide: PlatformAuditService, useValue: mock<PlatformAuditService>() },
        ],
    }).compile()
    return { service: moduleRef.get(InviteCommandsService), ledger, em, tx, sent, row, commands, events, members, failMail }
}
