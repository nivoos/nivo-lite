import { Injectable } from "@nestjs/common"
import { ConnectionApiTokenService } from "@modules/domain/connection-secrets"
import { ConnectionsService, hostsOf, isProvider, type ConnectionActor, type ConnectionRecord } from "@modules/domain/connections"
import { InjectImap, type ImapClient } from "@modules/integrations/data-sources"
import { DataHubError, DataHubErrorCode } from "./errors/data-hub.error"
import type { ImapCredential, ImapInput, ImapView } from "./imap-connection.contracts"
import {
    credentialFromInput,
    mailboxAddressOf,
    metaFromSettings,
    parseConfig,
    parseCredential,
    settingsFromInput,
} from "./imap-connection.policy"
import { IMAP_INBOUND_PROVIDER, holdsInbound, inboundIsReadCredential } from "./imap-inbound.policy"
import { IMAP_CONNECTION_TEXT } from "./messages/imap-connection.messages"

const OWNER = ["owner"] as const

/** The account a save writes the inbound half onto: an existing account, or a new `imap` account. */
type SaveTarget = { readonly kind: "account"; readonly account: ConnectionRecord } | { readonly kind: "new" }

const invalid = (detail: string): DataHubError => new DataHubError({ code: DataHubErrorCode.Invalid, params: { detail } })

@Injectable()
/**
 * The wizard of a mailbox's INBOUND half (MAIL-IN rule MI-1: one mailbox = one account). A save writes the half onto the account of its
 * address: the workspace's mailbox `smtp` account of that address when there is one (the half beside its outbound one: the settings in
 * its public facts, the IMAP credential in its READ credential), else the `imap` account of that address, else a new `imap` account (an
 * inbound half standing alone, which receives and never sends). So an address never gets a second account. The poll's cadence is the
 * connection poll's schedule; the wizard sets none.
 */
export class ImapWizardService {
    constructor(
        private readonly connections: ConnectionsService,
        private readonly tokens: ConnectionApiTokenService,
        @InjectImap() private readonly imap: ImapClient,
    ) {}

    /** Logs in read only and lists the folders; saves nothing. */
    async test(actor: ConnectionActor, input: ImapInput): Promise<Array<string>> {
        await this.connections.authorize(actor, OWNER)
        const saved = input.connectionId === undefined || input.connectionId === null ? null : await this.own(actor.workspaceId, input.connectionId)
        const credential = credentialFromInput(input, saved === null ? null : await this.savedPassword(saved))
        return this.imap.listFolders(credential)
    }

    /** Writes the inbound half onto the mailbox's one account (made when the address has none); answers the account's id. */
    async save(actor: ConnectionActor, input: ImapInput): Promise<string> {
        await this.connections.authorize(actor, OWNER)
        const settings = settingsFromInput(input)
        const target = await this.targetOf(actor.workspaceId, input.connectionId ?? null, settings.email)
        const saved = target.kind === "account" ? await this.savedPassword(target.account) : null
        const credential = JSON.stringify(credentialFromInput(input, saved))
        const meta = metaFromSettings(settings)
        if (target.kind === "new") {
            return this.connections.create({
                workspaceId: actor.workspaceId,
                createdBy: actor.principalId,
                provider: IMAP_INBOUND_PROVIDER,
                name: settings.name,
                status: "connected",
                environment: "live",
                meta,
                secret: { plain: credential, webhookSecret: "" },
            })
        }
        const { account } = target
        if (inboundIsReadCredential(account)) {
            if (!(await this.tokens.write(account.id, credential))) throw invalid(IMAP_CONNECTION_TEXT.credentialMissing)
            await this.connections.patch(actor.workspaceId, account.id, { meta: { ...account.meta, ...meta }, lastError: null })
            return account.id
        }
        await this.connections.writeSecret(account.id, credential)
        await this.connections.patch(actor.workspaceId, account.id, {
            name: settings.name,
            meta: { ...account.meta, ...meta },
            status: "connected",
            lastError: null,
        })
        return account.id
    }

    /** The saved inbound half of a mailbox, minus the password (for editing). */
    async load(actor: ConnectionActor, connectionId: string): Promise<ImapView> {
        await this.connections.authorize(actor, OWNER)
        const account = await this.own(actor.workspaceId, connectionId)
        if (!holdsInbound(account)) throw new DataHubError({ code: DataHubErrorCode.NotFound })
        const credential = await this.credentialOf(account)
        const config = parseConfig(account.meta)
        return {
            id: account.id,
            name: account.name,
            email: account.meta.email ?? account.meta.from_email ?? "",
            host: credential?.host ?? "",
            port: credential?.port ?? 993,
            security: credential !== null && !credential.secure ? "starttls" : "tls",
            user: credential?.user ?? "",
            folders: config.folders,
            sinceDays: config.sinceDays,
            provider: account.provider,
            agentIds: [...new Set(await this.connections.agentIds(actor.workspaceId, connectionId))],
        }
    }

    /**
     * Where a save goes: the account named (an `imap` account, or a mailbox account whose address is the half's), else the workspace's
     * mailbox account of the address, else its `imap` account of the address, else a new one.
     */
    private async targetOf(workspaceId: string, named: string | null, email: string): Promise<SaveTarget> {
        const address = mailboxAddressOf(email)
        if (named !== null) {
            const account = await this.own(workspaceId, named)
            if (account.provider !== IMAP_INBOUND_PROVIDER && mailboxAddressOf(account.meta.from_email) !== address)
                throw invalid(IMAP_CONNECTION_TEXT.addressOther)
            return { kind: "account", account }
        }
        const hosts = (await Promise.all(hostsOf(IMAP_INBOUND_PROVIDER).map((provider) => this.listOf(workspaceId, provider)))).flat()
        const host = hosts.find((account) => mailboxAddressOf(account.meta.from_email) === address)
        if (host !== undefined) return { kind: "account", account: host }
        const alone = (await this.listOf(workspaceId, IMAP_INBOUND_PROVIDER)).find((account) => mailboxAddressOf(account.meta.email) === address)
        return alone === undefined ? { kind: "new" } : { kind: "account", account: alone }
    }

    private async listOf(workspaceId: string, provider: string): Promise<ReadonlyArray<ConnectionRecord>> {
        return isProvider(provider) ? await this.connections.listByProvider(workspaceId, provider, { includeDisconnected: false }) : []
    }

    /** A live mailbox account of the workspace (an `imap` account or one that may hold its half); anything else is a typed refusal. */
    private async own(workspaceId: string, id: string): Promise<ConnectionRecord> {
        const account = await this.connections.find(workspaceId, id)
        if (account === null || account.status === "disconnected") throw new DataHubError({ code: DataHubErrorCode.NotFound })
        if (account.provider !== IMAP_INBOUND_PROVIDER && !hostsOf(IMAP_INBOUND_PROVIDER).includes(account.provider))
            throw invalid(IMAP_CONNECTION_TEXT.notMailbox)
        return account
    }

    /** The account's inbound credential, or null when it holds none (or it cannot be opened). */
    private async credentialOf(account: ConnectionRecord): Promise<ImapCredential | null> {
        const raw = inboundIsReadCredential(account)
            ? await this.tokens.read(account.id)
            : ((await this.connections.readSecret(account.id))?.plain ?? null)
        return raw === null ? null : parseCredential(raw)
    }

    private async savedPassword(account: ConnectionRecord): Promise<string | null> {
        if (!holdsInbound(account)) return null
        return (await this.credentialOf(account))?.password ?? null
    }
}
