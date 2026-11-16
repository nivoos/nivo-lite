import { Inject, Injectable, Optional } from "@nestjs/common"
import { latestTemplateVersion } from "@nivo-lite/agent-sdk/template"
import { BrainPolicyStoreService } from "@modules/domain/brain"
import { BrainFactsService, type FactRecord } from "@modules/domain/brain-facts"
import { ConnectionApiTokenService } from "@modules/domain/connection-secrets"
import { ConnectionsService, type ConnectionRecord } from "@modules/domain/connections"
import { INSTALLED } from "@modules/domain/installed-plugins"
import { InstallationRecordsService } from "@modules/domain/module-installations"
import { WorkspacesService } from "@modules/domain/workspaces"
import { parseJsonText } from "@modules/platform/primitives"
import { WorkspaceSeedError, WorkspaceSeedErrorCode } from "./errors/workspace-seed.error"
import type { SeedStandardTarget, SeedStandardTargets } from "./seed-standard.port"
import { placeOf } from "@modules/domain/channel-provisioning"
import { SEED_DOCUMENT_PATH, sealedPathOf } from "./seed-standard.policy"
import { SET_SEED_SCHEMA } from "./set-seed.contracts"
import { InjectWorkspaceSeedOptions, SEED_STANDARD_TARGETS } from "./workspace-seed.decorators"
import type { WorkspaceSeedOptions } from "./workspace-seed.options"

/** The most workspaces looked through for a named one. */
const WORKSPACE_SCAN_LIMIT = 1000
/** The most truths one export reads (the truth graph's own ceiling). */
const TRUTHS_MAX = 5000
/** The sources a seed may state a truth as (a customer's or the model's word is never a seed's). */
const SEED_SOURCES: ReadonlySet<string> = new Set(["owner", "manager", "document", "staff"])

type Raw = Readonly<Record<string, unknown>>

const isRecord = (value: unknown): value is Raw => value !== null && typeof value === "object" && !Array.isArray(value)

const refused = (field: string): never => {
    throw new WorkspaceSeedError({ code: WorkspaceSeedErrorCode.InputInvalid, params: { field } })
}

/** A key for an account the checkout does not name yet: its provider and a running number (`zalo_oa-1` becomes `zalo-oa-1`). */
const freshKeyOf = (provider: string, taken: ReadonlySet<string>): string => {
    const stem = provider.replaceAll(/[^a-z0-9]+/gu, "-").replaceAll(/^-|-$/gu, "")
    let n = 1
    while (taken.has(`${stem}-${String(n)}`)) n += 1
    return `${stem}-${String(n)}`
}

/** One truth as the seed document writes it (the truth graph's labels, never its ids). */
const truthOf = (fact: FactRecord, policy: { readonly title: string; readonly group: string } | null): Raw => ({
    type: fact.subjectType,
    subject: fact.subjectLabel,
    attribute: fact.attributeLabel,
    value: fact.value,
    ...(fact.unit === null ? {} : { unit: fact.unit }),
    scope: fact.scope,
    source: fact.sourceKind,
    ...(fact.validFrom === null ? {} : { from: fact.validFrom.slice(0, 10) }),
    ...(fact.validTo === null ? {} : { to: fact.validTo.slice(0, 10) }),
    ...(policy === null ? {} : { policy }),
})

@Injectable()
/**
 * THE EXPORT DOOR (the reverse of the applier): writes a working workspace into a CHECKOUT of its `-seed-standard` repo for a person to review
 * and re-pin (never straight to the pin): `seed.json` (the workspace, its accounts with the NAMES of their secret members, its agents pinned
 * to their primary template + version, its truths in force with their policy judgement), keeping the curated fields the checkout already
 * holds (target, owner, plugins, node settings, documents, time zone). Each live account's credential is read from the app's sealed store
 * IN MEMORY and handed only to the target's `seal` (sops encryption fed on stdin): no value is printed, logged, thrown or written in plain.
 * It writes the workspace's DEFINITION only (accounts, agents, settings, knowledge, truths), PLAIN, and the credentials into the sealed
 * file of the CURRENT place only; it never exports operational personal data (contacts, routes, messages, orders, runs): that is the
 * deployment backup's. Runs only where the app's own key is (the restart owner, on dev).
 */
export class SeedStandardExportService {
    constructor(
        @InjectWorkspaceSeedOptions() private readonly options: WorkspaceSeedOptions,
        private readonly workspaces: WorkspacesService,
        private readonly connections: ConnectionsService,
        private readonly installations: InstallationRecordsService,
        private readonly facts: BrainFactsService,
        private readonly judgements: BrainPolicyStoreService,
        private readonly apiTokens: ConnectionApiTokenService,
        @Optional() @Inject(SEED_STANDARD_TARGETS) private readonly targets?: SeedStandardTargets,
    ) {}

    /**
     * Exports the workspace named `workspaceName` into the checkout at `to`, sealing the credentials for `environment`. With
     * `credentialsOnly` it writes NOTHING but the sealed file: for each live account the checkout declares, the credential the app holds
     * NOW (with the tokens a provider issued and rotates: the remedy before a wipe) of the workspace's live connection of the same provider
     * and name (else its only live connection of that provider); an account with no such connection is named and left as it is.
     */
    async export(workspaceName: string, to: string, environment: string, credentialsOnly = false): Promise<void> {
        if (this.targets === undefined) throw new WorkspaceSeedError({ code: WorkspaceSeedErrorCode.DriverMissing, params: { name: to } })
        const target = await this.targets.open(to)
        const workspaceId = await this.workspaceOf(workspaceName)
        const existing = this.existingOf(await target.readText(SEED_DOCUMENT_PATH))
        if (credentialsOnly) {
            await this.exportCredentials(workspaceId, existing, target, sealedPathOf(placeOf(environment)))
            return
        }
        const connections = (await this.connections.list(workspaceId)).toSorted((left, right) => left.id.localeCompare(right.id))
        const accounts = this.accountsOf(connections, existing)
        const values: Record<string, Record<string, string>> = {}
        const members = new Map<string, ReadonlyArray<string>>()
        for (const { key, connection, sealedFacts } of accounts.filter((one) => !one.connection.sandbox)) {
            const stored = await this.connections.readSecret(connection.id)
            const token = await this.apiTokens.read(connection.id)
            values[key] = {
                credential: stored?.plain ?? "",
                webhookSecret: stored?.webhookSecret ?? "",
                ...(token === null ? {} : { apiToken: token }),
                ...Object.fromEntries(sealedFacts.map((fact) => [`fact.${fact}`, connection.meta[fact] ?? ""])),
            }
            members.set(key, Object.keys(values[key] ?? {}))
        }
        const truths = await this.truthsOf(workspaceId)
        const document = {
            schema: SET_SEED_SCHEMA,
            use: "workspace",
            name: existing.name ?? refused("seed.json.name"),
            target: existing.target ?? "local",
            workspaceName,
            ownerWorkspace: existing.ownerWorkspace ?? refused("seed.json.ownerWorkspace"),
            ...this.kept(existing, ["timeZone", "locale", "enterprise", "plugins"]),
            agents: await this.agentsOf(workspaceId),
            accounts: accounts.map(({ key, connection, sealedFacts }) => {
                const facts = Object.fromEntries(Object.entries(connection.meta).filter(([name]) => !sealedFacts.includes(name)))
                return {
                    key,
                    provider: connection.provider,
                    name: connection.name,
                    ...(connection.sandbox ? {} : { sandbox: false, secrets: members.get(key) ?? ["credential"] }),
                    ...(connection.status === "pending" ? { pending: true } : {}),
                    ...(Object.keys(facts).length === 0 ? {} : { facts }),
                }
            }),
            ...this.kept(existing, ["nodeSettings", "documents"]),
            truths: truths.kept,
        }
        const wrote = await target.writeText(SEED_DOCUMENT_PATH, `${JSON.stringify(document, null, 2)}\n`)
        const sealed = await target.seal(sealedPathOf(placeOf(environment)), values)
        this.options.print(
            `${String(document.name)}: exported ${workspaceName}: ${String(accounts.length)} accounts (${String(Object.keys(values).length)} live, their secret members sealed for ${environment}), ` +
                `${String(document.agents.length)} agents, ${String(truths.kept.length)} truths (${String(truths.skipped)} not a seed's source, left out); ` +
                `seed.json ${wrote ? "written" : "unchanged"}, ${sealedPathOf(placeOf(environment))} ${sealed ? "written" : "unchanged"} (the other place's file untouched); review, commit and re-pin by hand`,
        )
    }

    /** Seals, for each live account the checkout declares, the members of its declared names read from the matching connection. */
    private async exportCredentials(workspaceId: string, existing: Raw, target: SeedStandardTarget, file: string): Promise<void> {
        const declared = (Array.isArray(existing.accounts) ? existing.accounts.filter(isRecord) : []).filter((one) => one.sandbox === false)
        const live = (await this.connections.list(workspaceId)).filter((one) => !one.sandbox)
        const values: Record<string, Record<string, string>> = {}
        const unmatched: Array<string> = []
        for (const account of declared) {
            const key = typeof account.key === "string" ? account.key : refused("seed.json.accounts.key")
            const sameKind = live.filter((one) => one.provider === account.provider)
            const connection = sameKind.find((one) => one.name === account.name) ?? (sameKind.length === 1 ? sameKind[0] : undefined)
            if (connection === undefined) {
                unmatched.push(key)
                continue
            }
            const members = Array.isArray(account.secrets) ? account.secrets.filter((one): one is string => typeof one === "string") : []
            const stored = await this.connections.readSecret(connection.id)
            const token = members.includes("apiToken") ? await this.apiTokens.read(connection.id) : null
            values[key] = Object.fromEntries(
                members.flatMap((member): ReadonlyArray<[string, string]> => {
                    if (member === "credential") return stored === null ? [] : [[member, stored.plain]]
                    if (member === "webhookSecret") return stored === null ? [] : [[member, stored.webhookSecret]]
                    if (member === "apiToken") return token === null ? [] : [[member, token]]
                    const fact = connection.meta[member.slice("fact.".length)]
                    return fact === undefined ? [] : [[member, fact]]
                }),
            )
        }
        const sealed = await target.seal(file, values)
        this.options.print(
            `credentials of ${String(Object.keys(values).length)} live accounts ${sealed ? "sealed" : "unchanged"} in ${file} (seed.json untouched)` +
                (unmatched.length === 0 ? "" : `; no live connection of the workspace for: ${unmatched.join(", ")} (left as they are)`),
        )
    }

    /** The curated fields of the checkout's document (none when it holds no document yet: then name and owner are refused). */
    private existingOf(text: string | null): Raw {
        if (text === null) return {}
        const read = parseJsonText(text)
        return read.ok && isRecord(read.value) ? read.value : refused(SEED_DOCUMENT_PATH)
    }

    private kept(existing: Raw, fields: ReadonlyArray<string>): Raw {
        return Object.fromEntries(fields.flatMap((field) => (existing[field] === undefined ? [] : [[field, existing[field]]])))
    }

    /**
     * Each connection with its key (the checkout's key of the account of the same provider and name, else a new one) and the public facts the
     * checkout keeps SEALED for it (its `fact.<name>` members: they go to the sealed file, never into seed.json).
     */
    private accountsOf(
        connections: ReadonlyArray<ConnectionRecord>,
        existing: Raw,
    ): ReadonlyArray<{ readonly key: string; readonly connection: ConnectionRecord; readonly sealedFacts: ReadonlyArray<string> }> {
        const declared = Array.isArray(existing.accounts) ? existing.accounts.filter(isRecord) : []
        const taken = new Set<string>(declared.flatMap((one) => (typeof one.key === "string" ? [one.key] : [])))
        return connections.map((connection) => {
            const same = declared.find((one) => one.provider === connection.provider && one.name === connection.name && (one.sandbox === false) === !connection.sandbox)
            const sealedFacts = Array.isArray(same?.secrets) ? same.secrets.flatMap((member) => (typeof member === "string" && member.startsWith("fact.") ? [member.slice("fact.".length)] : [])) : []
            if (typeof same?.key === "string") return { key: same.key, connection, sealedFacts }
            const key = freshKeyOf(connection.provider, taken)
            taken.add(key)
            return { key, connection, sealedFacts: [] }
        })
    }

    /** The installed agents: each module with its primary template and that template's version as installed. */
    private async agentsOf(workspaceId: string): Promise<ReadonlyArray<Raw>> {
        const modules = [...new Set((await this.installations.list(workspaceId)).map((one) => one.moduleKey))]
        return modules.flatMap((module) => {
            const primary = INSTALLED.templatesOf(module).find((template) => template.primary)
            return primary === undefined ? [] : [{ module, template: primary.id, version: latestTemplateVersion(primary).version }]
        })
    }

    /** The truths in force or scheduled, each with its policy judgement; truths of a source a seed never states are counted, not written. */
    private async truthsOf(workspaceId: string): Promise<{ readonly kept: ReadonlyArray<Raw>; readonly skipped: number }> {
        const facts = await this.facts.list(workspaceId, { statuses: ["active", "scheduled"], limit: TRUTHS_MAX })
        const judged = new Map((await this.judgements.all(workspaceId)).map((one) => [`${one.subjectKey}|${one.attribute}|${one.installationId ?? ""}`, one]))
        const ordered = facts.toSorted((left, right) => `${left.subjectKey}|${left.attribute}`.localeCompare(`${right.subjectKey}|${right.attribute}`))
        const kept = ordered.flatMap((fact) => {
            if (!SEED_SOURCES.has(fact.sourceKind)) return []
            const judgement = judged.get(`${fact.subjectKey}|${fact.attribute}|${fact.installationId ?? ""}`)
            return [truthOf(fact, judgement?.kind === "policy" ? { title: judgement.title, group: judgement.groupLabel } : null)]
        })
        return { kept, skipped: ordered.length - kept.length }
    }

    /** The one live workspace of that name; none or several are refused. */
    private async workspaceOf(name: string): Promise<string> {
        const named = (await this.workspaces.list(WORKSPACE_SCAN_LIMIT)).filter((workspace) => workspace.name === name)
        const live: Array<string> = []
        for (const workspace of named) if (await this.workspaces.isLive(workspace.id)) live.push(workspace.id)
        const [only] = live
        return only !== undefined && live.length === 1 ? only : refused("workspace")
    }
}
