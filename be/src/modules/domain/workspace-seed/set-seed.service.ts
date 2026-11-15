import { Injectable, Optional } from "@nestjs/common"
import type { TemplateAgent } from "@nivo-lite/agent-sdk/template"
import { templateVersionOf } from "@nivo-lite/agent-sdk/template"
import { BrainPolicyStoreService } from "@modules/domain/brain"
import {
    BrainFactsService,
    factSlugOf,
    sameValue,
    valueLineOf,
    type FactInput,
    type FactRecord,
} from "@modules/domain/brain-facts"
import { seededFactsOf, seededSecretOf } from "@modules/domain/channel-connections"
import type { EnterpriseSeedPlace } from "@modules/domain/channel-provisioning"
import { ConnectionApiTokenService, randomSecret } from "@modules/domain/connection-secrets"
import { ConnectionsService, isProvider, type ConnectionRecord } from "@modules/domain/connections"
import { INSTALLED, customerChannelProviders, inboundChannelsOf } from "@modules/domain/installed-plugins"
import { ProfileSourcesService } from "@modules/domain/knowledge-sources"
import { OwnersService } from "@modules/domain/owners"
import { ProviderTriggerStatesService } from "@modules/domain/provider-triggers"
import { AgentAccountsService } from "@modules/domain/tools"
import { WorkspaceEnterpriseService, WorkspaceLobbyService, WorkspacesService } from "@modules/domain/workspaces"
import { InjectClock, type Clock } from "@modules/platform/clock"
import { eachInOrder } from "@modules/platform/primitives"
import { WorkspaceSeedError, WorkspaceSeedErrorCode } from "./errors/workspace-seed.error"
import { GraphSeedService, type GraphSeedEntry, type SeededModule } from "./graph-seed.service"
import { primaryGraphOf } from "./primary-graph.policy"
import { attachEveryOf, attachPlanOf } from "./roster-seed.policy"
import { RosterSeedService } from "./roster-seed.service"
import { readinessOf, readyLineOf, sealedNamesOf, type ReadinessInstalled } from "./seed-readiness.policy"
import type { AccountStop, DocumentTexts, ForceKind, SealedValues, SetAccount, SetFact, SetPlan, SetProfile } from "./set-seed.contracts"
import { connectionIdOf, expandSetProfile, nodeSettingsOf, readSetProfile, standingOf } from "./set-seed.policy"
import type { SeedNodeDoor } from "./seed-standard.port"
import { InjectWorkspaceSeedOptions } from "./workspace-seed.decorators"
import type { WorkspaceSeedOptions } from "./workspace-seed.options"

/** The most workspaces looked through for a named one. */
const WORKSPACE_SCAN_LIMIT = 1000
/** Who the truths and decisions of a seed are written as. */
const SEEDER = "seed"
/** The last line the stack seed step reads as "nothing changed". */
const UNCHANGED = "unchanged"
/** The statuses a truth may already hold and count as written. */
const WRITTEN: ReadonlySet<string> = new Set(["proposed", "scheduled", "active", "expired"])

/** What a run of a test set is asked to do. */
export interface SetRunOptions {
    /** Print the plan and write nothing. */
    readonly dry: boolean
    /** Also bind each customer channel of the workspace to its agent's front door (leave it off while the history of the people is written through the doors: nothing answers a line then). */
    readonly bind: boolean
}

/** What one apply of a document takes: the document, where it is applied, and (a workspace seed) its sealed values and document texts. */
export interface SeedApply {
    /** The document. */
    readonly profile: SetProfile
    /** The local stack or production. */
    readonly place: EnterpriseSeedPlace
    /** Print the plan and write nothing. */
    readonly dry: boolean
    /** Bind the customer channels to the agents' front doors. */
    readonly bind: boolean
    /** The secret values of the live accounts, held in memory (a test set: none). */
    readonly sealed: SealedValues | null
    /** The texts of the documents by path (a test set: none). */
    readonly texts: DocumentTexts
    /** A FORCED re-seed of a standard seeded before (R102, R103), or null for a first seed and a test set. */
    readonly reseed: Reseed | null
    /**
     * The sign-in address of the workspace's owner as the STACK declares it (a standard's declaration, read from the environment's sealed
     * member), or null: the owner of the document's `ownerWorkspace`. An address with no account gets one through the owners door (no usable
     * password: the person signs in with Google, which links by the verified address).
     */
    readonly ownerEmail?: string | null
}

/** A forced re-seed: when the standard was last applied, and the kinds whose person-made changes the force overwrites. */
export interface Reseed {
    /** When the receipt says the standard was last applied (ISO). */
    readonly since: string
    /** The kinds named by the force. */
    readonly kinds: ReadonlySet<ForceKind>
}

/** What an apply did (or, dry, would do), by the precedence rule of R102. */
export interface SeedTally {
    /** Things the seed made. */
    created: number
    /** Things it updated IN PLACE (same id). */
    updated: number
    /** Things a person changed after the seed, left as they are. */
    byPerson: number
    /** Things the workspace holds that the standard no longer names (never deleted: removal is a person's act). */
    gone: number
}

/** What one apply answers: whether it wrote, the workspace (null on a dry run of a workspace not made yet) and the tally. */
export interface SeedOutcome {
    readonly changed: boolean
    readonly workspaceId: string | null
    readonly tally: SeedTally
}

/** The tally in one line: `created 3, updated 1, left 2 changed by a person, 1 no longer in the standard`. */
export const tallyLineOf = (tally: SeedTally, mood: string): string =>
    `${mood}create ${String(tally.created)}, ${mood}update ${String(tally.updated)}, ${mood}leave ${String(tally.byPerson)} changed by a person, ` +
    `${String(tally.gone)} no longer in the standard (kept)`

/** Whether a connection's public facts already hold every fact the document gives it. */
const sameFacts = (held: Readonly<Record<string, string>>, wanted: Readonly<Record<string, string>>): boolean =>
    Object.entries(wanted).every(([name, value]) => held[name] === value)

const refused = (field: string): never => {
    throw new WorkspaceSeedError({ code: WorkspaceSeedErrorCode.InputInvalid, params: { field } })
}

/** A test set runs on the local stack only: its accounts are sandbox accounts, which production never opens. */
const assertLocal = (environment: string): void => {
    if (environment !== "dev" && environment !== "local") refused("env")
}

/** Where the secret values of one live account stand: usable, or why not (by member NAME, never a value). */
type SecretsOf =
    | {
          readonly ok: true
          readonly credential: string
          readonly webhookSecret: string | undefined
          readonly apiToken: string | undefined
          /** The sealed public facts (`fact.<name>` members), by fact name. */
          readonly facts: Readonly<Record<string, string>>
      }
    | { readonly ok: false; readonly stop: AccountStop; readonly member: string }

/** The values of a live account's secret members, or the typed reason it cannot be written; an empty value is a member declared but not set. */
export const secretsOf = (account: SetAccount, sealed: SealedValues | null): SecretsOf => {
    if (sealed === null || !sealed.opened) return { ok: false, stop: "sealed_unreadable", member: "*" }
    const values = sealed.accounts[account.key] ?? {}
    for (const member of account.secrets) {
        const value = values[member]
        if (value === undefined) return { ok: false, stop: "secret_missing", member }
        if (value === "") return { ok: false, stop: "secret_empty", member }
    }
    const facts = Object.fromEntries(account.secrets.flatMap((member) => (member.startsWith("fact.") ? [[member.slice("fact.".length), values[member] ?? ""]] : [])))
    return { ok: true, credential: values.credential ?? "", webhookSecret: values.webhookSecret, apiToken: values.apiToken, facts }
}

/**
 * The installation as the readiness rule reads it: an agent's entrances are the customer channels a person writes on through an ACCOUNT (the
 * website form is no account); the package version is not known to the app (not judged here; the ext check judges it).
 */
const installedReadiness = (): ReadinessInstalled => ({
    plugins: INSTALLED.plugins.map((plugin) => ({ ...plugin, version: null })),
    templatesOf: (moduleKey) => INSTALLED.templatesOf(moduleKey),
    inboundChannelsOf: (moduleKey) => {
        const agent = INSTALLED.templateAgentOf(moduleKey)
        const customer = customerChannelProviders()
        return agent === null ? new Set() : new Set([...inboundChannelsOf(agent)].filter((channel) => customer.has(channel)))
    },
})

@Injectable()
/**
 * THE SEED APPLIER of the one seed document (`nivo/set-seed@1`, both uses): a document is a whole workspace as DATA, applied through the doors
 * the app already has, in the order they need: the workspace (+ its enterprise identifier), the plugin and template check, the accounts
 * (SANDBOX ones opened with ids derived from the workspace; LIVE ones created through the app's own connection door, which seals the credential
 * with its own key), the agents (the primary graph of each module's template, attached BY KIND as the roster seed attaches), the documents
 * through the knowledge door (its job chain files their truths), the truths and the policy judgement of each through the truth graph's own
 * door, the front doors. Every step is a find-or-write, so a second run changes nothing. A live account whose secret member is missing,
 * empty or unreadable is STOPPED with a typed reason and the rest goes on. Node settings and the time zone are door steps (`doors`).
 */
export class SetSeedService {
    constructor(
        @InjectWorkspaceSeedOptions() private readonly options: WorkspaceSeedOptions,
        @InjectClock() private readonly clock: Clock,
        private readonly workspaces: WorkspacesService,
        private readonly lobby: WorkspaceLobbyService,
        private readonly connections: ConnectionsService,
        private readonly abilities: AgentAccountsService,
        private readonly graphs: GraphSeedService,
        private readonly roster: RosterSeedService,
        private readonly facts: BrainFactsService,
        private readonly judgements: BrainPolicyStoreService,
        private readonly enterprise: WorkspaceEnterpriseService,
        private readonly sources: ProfileSourcesService,
        private readonly apiTokens: ConnectionApiTokenService,
        @Optional() private readonly triggers?: ProviderTriggerStatesService,
        @Optional() private readonly owners?: OwnersService,
    ) {}

    /** The deployment's sandbox switch as the seed reads it (see `WorkspaceSeedOptions.sandboxOn`). */
    private get sandboxOn(): boolean {
        return this.options.sandboxOn === true
    }

    /**
     * The owner of the document's workspace: the address the stack declares (its account found or made through the owners door; a dry run
     * only finds it), else the owner of the one live workspace the document names as `ownerWorkspace`. Null on a dry run whose owner has no
     * account yet.
     */
    async ownerIdFor(named: ReadonlyArray<{ readonly id: string; readonly name: string }>, profile: SetProfile, ownerEmail: string | null, write: boolean): Promise<string | null> {
        if (ownerEmail === null) return this.ownerOf(named, profile.ownerWorkspace)
        if (this.owners === undefined) return refused("ownerEmail")
        if (!write) return (await this.owners.findAccount(ownerEmail)) ?? null
        return this.owners.ensureAccount(ownerEmail)
    }

    /** Seeds the TEST set the envelope on stdin carries; prints what it did, ending with `unchanged` when nothing changed. */
    async run(input: string, environment: string, run: SetRunOptions): Promise<void> {
        assertLocal(environment)
        const { changed } = await this.apply({ profile: readSetProfile(input), place: "local", dry: run.dry, bind: run.bind, sealed: null, texts: {}, reseed: null })
        if (!run.dry) this.options.print(changed ? "applied" : UNCHANGED)
    }

    /**
     * Applies one document (a test set or a workspace seed); prints what it did, never a value. On a dry run nothing is written and the tally
     * counts what WOULD happen (accounts and truths are read; agents and documents are judged by their own doors on the real run).
     * PRECEDENCE (R102), per kind: every seeded thing keeps a STABLE id derived from the workspace and the seed's own key and is updated IN
     * PLACE, never deleted and re-made; a thing the standard no longer names is reported, never deleted; operational rows (contacts, routes,
     * messages, runs, orders) are never touched; a credential sealed after the last seed and a truth a person stated (not the seed) are a
     * person's and win unless the force names their kind; node settings are door steps sent on the first seed only (or when the force names
     * `node-settings`).
     */
    async apply(input: SeedApply): Promise<SeedOutcome> {
        const { profile } = input
        const plan = expandSetProfile(profile)
        const tally: SeedTally = { created: 0, updated: 0, byPerson: 0, gone: 0 }
        this.checkInstalled(profile)
        profile.documents.forEach((document, index) => (input.texts[document.path] === undefined ? refused(`documents.${String(index)}.path`) : undefined))
        this.printPlan(profile, plan)
        this.options.print(readyLineOf(profile.name, readinessOf(profile, installedReadiness(), sealedNamesOf(input.sealed), input.place, this.sandboxOn)))
        const named = await this.workspaces.list(WORKSPACE_SCAN_LIMIT)
        const found = await this.ownerIdFor(named, profile, input.ownerEmail ?? null, !input.dry)
        if (found === null) {
            this.printSecrets(profile, input.sealed)
            this.options.print(`${profile.name}: owner account would be created; workspace "${profile.workspaceName}" would be created; dry run: nothing written`)
            return { changed: false, workspaceId: null, tally: { created: 0, updated: 0, byPerson: 0, gone: 0 } }
        }
        const ownerId = found
        const held = await this.ownedLive(named, profile.workspaceName, ownerId)
        if (profile.kind === "overlay" && held.length === 0) refused("workspaceName")
        if (input.dry) {
            this.printSecrets(profile, input.sealed)
            const [existing] = held
            if (existing !== undefined) {
                await this.openAccounts(profile, existing, ownerId, input, tally, false)
                await this.writeTruths(profile, plan.facts, existing, input.reseed, tally, false)
            }
            this.options.print(
                `${profile.name}: workspace "${profile.workspaceName}" ${existing === undefined ? "would be created" : "exists"}; ${tallyLineOf(tally, "would ")}; dry run: nothing written`,
            )
            return { changed: false, workspaceId: existing ?? null, tally }
        }
        const { id: workspaceId } = await this.workspaces.ensureNamed(ownerId, profile.workspaceName)
        this.options.print(`${profile.name}: workspace ${workspaceId} ${held.length > 0 ? "kept" : "created"}`)
        let changed = held.length === 0
        if (profile.enterprise !== null) {
            const { from, to } = await this.enterprise.set(workspaceId, profile.enterprise)
            this.options.print(`${profile.name}: enterprise identifier ${from === to ? "kept" : "set"}`)
            changed = from !== to || changed
        }
        changed = (await this.openAccounts(profile, workspaceId, ownerId, input, tally, true)) || changed
        const installed = await this.installAgents(profile, workspaceId, input.place)
        changed = installed.changed || changed
        changed = (await this.keepDocuments(profile, workspaceId, ownerId, input.texts)) || changed
        changed = (await this.writeTruths(profile, plan.facts, workspaceId, input.reseed, tally, true)) || changed
        if (input.bind) changed = (await this.bindDoors(profile, workspaceId, ownerId, installed.seeded, input.place)) || changed
        changed = (await this.switchSandboxTriggersOn(profile, workspaceId, ownerId)) || changed
        this.options.print(`${profile.name}: ${tallyLineOf(tally, "")}`)
        return { changed, workspaceId, tally }
    }

    /** Prints the door steps of the TEST set on stdin (see `printDoors`). */
    async doors(input: string, environment: string): Promise<void> {
        assertLocal(environment)
        await this.printDoors(readSetProfile(input))
    }

    /**
     * Prints, one JSON object a line, the steps the door script performs through the api as the owner: a line said on an account (the
     * provider's own inbound case), a case an account's poll reads, a merge of one person's contacts (a test set), the workspace's time zone
     * (the settings door) and each step's node settings (`setAgentNodeSettings`: mode and accounts in try order). The workspace must exist.
     */
    async printDoors(profile: SetProfile, nodeSettings = true): Promise<void> {
        const plan = expandSetProfile(profile)
        const named = await this.workspaces.list(WORKSPACE_SCAN_LIMIT)
        const ownerId = await this.ownerOf(named, profile.ownerWorkspace)
        const [workspaceId] = await this.ownedLive(named, profile.workspaceName, ownerId)
        if (workspaceId === undefined) return refused("workspaceName")
        const idOf = (account: string): string => connectionIdOf(workspaceId, account)
        const line = (step: unknown): void => this.options.print(JSON.stringify(step))
        line({ kind: "workspace", set: profile.name, workspaceId })
        if (profile.timeZone !== null) line({ kind: "settings", timeZone: profile.timeZone })
        for (const step of plan.doors) {
            if (step.kind === "line") line({ kind: "line", connectionId: idOf(step.account), caseId: step.caseId, inputs: step.inputs })
            else if (step.kind === "pull") line({ kind: "pull", connectionId: idOf(step.account), caseId: step.caseId })
            else line({ kind: "merge", people: step.people.map((one) => ({ connectionId: idOf(one.account), id: one.id })) })
        }
        const held = await this.connections.list(workspaceId)
        for (const setting of nodeSettings ? profile.nodeSettings : []) {
            line({
                kind: "node",
                module: setting.module,
                workflow: setting.workflow,
                node: setting.node,
                ...(setting.mode === null ? {} : { mode: setting.mode }),
                ...(setting.accounts === null ? {} : { accounts: setting.accounts.map((key) => this.accountIdOf(profile, key, workspaceId, held)) }),
            })
        }
    }

    /**
     * The door steps of a document in a place, resolved for its workspace: the time zone and each node setting of THAT place
     * (`places.<place>.nodeSettings`, else the document's), its accounts as connection ids in try order.
     */
    async doorStepsOf(profile: SetProfile, place: EnterpriseSeedPlace, workspaceId: string): Promise<{ readonly timeZone: string | null; readonly nodes: ReadonlyArray<SeedNodeDoor> }> {
        const held = await this.connections.list(workspaceId)
        return {
            timeZone: profile.timeZone,
            nodes: nodeSettingsOf(profile, place).map((setting) => ({
                module: setting.module,
                workflow: setting.workflow,
                node: setting.node,
                mode: setting.mode,
                accountIds: setting.accounts === null ? null : setting.accounts.map((key) => this.accountIdOf(profile, key, workspaceId, held)),
            })),
        }
    }

    /** The owner of a workspace, or null. */
    async ownerOfWorkspace(workspaceId: string): Promise<string | null> {
        return (await this.workspaces.ownerIdOf(workspaceId)) ?? null
    }

    /** One line per node setting of a place, for a dry run: the step and its accounts by key with their world (never a value). */
    printNodePlan(profile: SetProfile, place: EnterpriseSeedPlace): void {
        for (const setting of nodeSettingsOf(profile, place)) {
            const accounts = (setting.accounts ?? []).map((key) => `${key} (${profile.accounts.find((one) => one.key === key)?.sandbox === false ? "live" : "sandbox"})`)
            this.options.print(
                `${profile.name}: node ${setting.workflow}/${setting.node} in ${place}: ${setting.mode === null ? "" : `mode ${setting.mode}, `}accounts ${setting.accounts === null ? "left as the template picks" : `[${accounts.join(", ")}]`}`,
            )
        }
    }

    /** Takes the TEST set's workspace off the local stack (see `resetProfile`). */
    async reset(input: string, environment: string, execute: boolean): Promise<void> {
        assertLocal(environment)
        await this.resetProfile(readSetProfile(input), execute)
    }

    /**
     * Takes a document's workspace off the stack through the owner's delete door (a soft delete; everything in it with it): prints the plan
     * and, only with `execute`, removes. An OVERLAY document never removes its workspace (it was not made by the document).
     */
    async resetProfile(profile: SetProfile, execute: boolean): Promise<void> {
        if (profile.kind === "overlay") {
            this.options.print(`${profile.name}: an overlay set: its workspace "${profile.workspaceName}" was not made by the set and is never removed by it`)
            return
        }
        const named = await this.workspaces.list(WORKSPACE_SCAN_LIMIT)
        const ownerId = await this.ownerOf(named, profile.ownerWorkspace)
        const doomed = await this.ownedLive(named, profile.workspaceName, ownerId)
        if (doomed.length === 0) {
            this.options.print(`${profile.name}: nothing to remove: no live workspace "${profile.workspaceName}"`)
            return
        }
        for (const id of doomed) {
            this.options.print(`${profile.name}: remove the workspace "${profile.workspaceName}" ${id} with everything in it, through the owner's delete door (rows kept until an operator prune)`)
        }
        if (!execute) {
            this.options.print("dry run: nothing removed; run again with --execute to remove")
            return
        }
        await eachInOrder(doomed, async (id) => {
            await this.lobby.remove(ownerId, id, profile.workspaceName)
            this.options.print(`${profile.name}: removed workspace ${id}`)
        })
    }

    /** Refuses, before anything is written, a plugin the app does not install (or keeps from the enterprise) and an agent template or version it does not hold. */
    private checkInstalled(profile: SetProfile): void {
        profile.plugins.forEach((plugin, index) => {
            const found = INSTALLED.plugins.find((one) => one.key === plugin.key)
            if (found === undefined) refused(`plugins.${String(index)}.key`)
            if (found?.visibility === "private" && (profile.enterprise === null || !found.enterprises.includes(profile.enterprise))) refused("enterprise")
        })
        profile.agents.forEach((agent, index) => {
            if (agent.template === null) return
            const template = INSTALLED.templatesOf(agent.module).find((one) => one.id === agent.template && one.primary)
            if (template === undefined) refused(`agents.${String(index)}.template`)
            if (template !== undefined && templateVersionOf(template, agent.version ?? 0) === null) refused(`agents.${String(index)}.version`)
        })
    }

    private printPlan(profile: SetProfile, plan: SetPlan): void {
        const standings = plan.facts.map((fact) => standingOf(fact, this.today()))
        const count = (standing: string): number => standings.filter((one) => one === standing).length
        const live = profile.accounts.filter((account) => !account.sandbox).length
        this.options.print(
            `${profile.name} (${profile.use}, target ${profile.target}): ${String(profile.accounts.length - live)} sandbox accounts, ${String(live)} live accounts, ` +
                `agents [${profile.agents.map((agent) => agent.module).join(", ")}], ${String(profile.documents.length)} documents, ${String(plan.facts.length)} truths ` +
                `(${String(count("in_force"))} in force, ${String(count("scheduled"))} scheduled, ${String(count("expired"))} expired, ${String(count("waiting"))} waiting), ` +
                `${String(plan.facts.filter((fact) => fact.policy !== null).length)} policies, ${String(plan.doors.length + profile.nodeSettings.length)} door steps`,
        )
    }

    /** Names, for a dry run, every secret member each live account would use and whether the sealed file holds it: NEVER a value. */
    private printSecrets(profile: SetProfile, sealed: SealedValues | null): void {
        for (const account of profile.accounts.filter((one) => !one.sandbox)) {
            const held = sealed?.opened === true ? (sealed.accounts[account.key] ?? {}) : null
            const states = account.secrets.map((member) => {
                const value = held?.[member]
                return `${member}=${held === null ? "unreadable" : value === undefined ? "missing" : value === "" ? "empty" : "set"}`
            })
            const unset = held === null || account.secrets.some((member) => (held[member] ?? "") === "")
            const twin = unset ? profile.accounts.find((one) => one.sandbox && one.provider === account.provider) : undefined
            this.options.print(
                `${profile.name}: live account ${account.key} (${account.provider}) would use secrets/${account.key}: ${states.join(", ")}` +
                    (twin === undefined ? "" : `; not created: sandbox twin ${twin.key} in use (local)`),
            )
        }
        if (sealed?.opened === false) this.options.print(`${profile.name}: sealed file not opened: ${sealed.reason}`)
    }

    /**
     * The connection a key of the document stands for: the id the standard declares (a provider's own settings point at it), else the
     * stable derived id (a standard: from its name and the key, so it survives a wipe and is the same in every environment; a test set:
     * from the workspace and the key), else the live account of the same provider and name the seed adopted.
     */
    private accountIdOf(profile: SetProfile, key: string, workspaceId: string, held: ReadonlyArray<ConnectionRecord>): string {
        const account = profile.accounts.find((one) => one.key === key)
        if (account?.connectionId != null) return account.connectionId
        const derived = connectionIdOf(profile.use === "workspace" ? `standard:${profile.name}` : workspaceId, key)
        if (account === undefined || held.some((one) => one.id === derived)) return derived
        return held.find((one) => !one.sandbox && one.provider === account.provider && one.name === account.name)?.id ?? derived
    }

    /**
     * Opens each account the document names under its STABLE id (derived from the workspace and the account's key, or the live account of the
     * same provider and name the seed adopted): a SANDBOX one with no credential; a LIVE one through the app's connection door, which seals the
     * credential with the app's own key. An account the workspace already holds is updated IN PLACE (name, public facts) and its credential
     * rewritten when it differs, unless a person sealed another credential after the last seed (kept unless the force names `credentials`). A
     * live account whose secret member is missing, empty or unreadable is stopped with its typed reason; the rest goes on. An account the
     * workspace holds that the standard does not name is reported, never removed. With `write` off, it only counts.
     */
    private async openAccounts(profile: SetProfile, workspaceId: string, ownerId: string, input: SeedApply, tally: SeedTally, write: boolean): Promise<boolean> {
        const held = await this.connections.list(workspaceId)
        let changed = false
        const stopped: Array<string> = []
        const ids = new Set<string>()
        await eachInOrder(profile.accounts, async (account) => {
            if (!isProvider(account.provider)) return refused("accounts.provider")
            const id = this.accountIdOf(profile, account.key, workspaceId, held)
            ids.add(id)
            const found = held.find((one) => one.id === id)
            const secrets = account.sandbox ? null : secretsOf(account, input.sealed)
            const meta = seededFactsOf({ ...account.facts, ...(secrets?.ok === true ? secrets.facts : {}) })
            const status = account.pending ? ("pending" as const) : ("connected" as const)
            const base = { workspaceId, createdBy: ownerId, provider: account.provider, name: account.name, status, environment: "live" as const, meta }
            if (secrets !== null && !secrets.ok) {
                stopped.push(account.key)
                const twin = input.place === "local" ? profile.accounts.find((one) => one.sandbox && one.provider === account.provider) : undefined
                this.options.print(
                    `${profile.name}: live account ${account.key} (${account.provider}) not created: ${secrets.stop} (${secrets.member})` +
                        (twin === undefined ? "" : `; sandbox twin ${twin.key} in use`),
                )
                return
            }
            if (found === undefined) {
                tally.created += 1
                if (!write) return
                if (secrets === null) await this.connections.create({ ...base, id, sandbox: true })
                else {
                    await this.connections.create({ ...base, id, secret: seededSecretOf(account.provider, secrets.credential, secrets.webhookSecret, randomSecret) })
                    if (secrets.apiToken !== undefined) await this.apiTokens.write(id, secrets.apiToken)
                }
                this.options.print(`${profile.name}: ${secrets === null ? "sandbox account" : "live account"} ${account.key} (${account.provider}) ${id} ${secrets === null ? "opened" : "created, credential sealed by the app"}`)
                changed = true
                return
            }
            if (found.name !== account.name || !sameFacts(found.meta, meta)) {
                tally.updated += 1
                if (write) {
                    await this.connections.patch(workspaceId, id, { name: account.name, meta: { ...found.meta, ...meta } })
                    this.options.print(`${profile.name}: account ${account.key} ${id} updated in place`)
                    changed = true
                }
            }
            if (secrets === null) return
            const stored = await this.connections.readSecret(id)
            const token = secrets.apiToken === undefined ? undefined : await this.apiTokens.read(id)
            if (stored?.plain === secrets.credential && (secrets.apiToken === undefined || token === secrets.apiToken)) return
            const rotated = input.reseed !== null && stored?.sealedAt !== undefined && stored.sealedAt > input.reseed.since
            if (rotated && input.reseed?.kinds.has("credentials") !== true) {
                tally.byPerson += 1
                this.options.print(`${profile.name}: live account ${account.key} (${account.provider}) ${id}: credential changed by a person after the seed: kept`)
                return
            }
            tally.updated += 1
            if (!write) return
            if (stored?.plain !== secrets.credential) {
                const sealed = seededSecretOf(account.provider, secrets.credential, secrets.webhookSecret, randomSecret)
                await this.connections.writeSecret(id, sealed.plain, account.provider === "sepay" ? sealed.webhookSecret : secrets.webhookSecret)
            }
            if (secrets.apiToken !== undefined && token !== secrets.apiToken) await this.apiTokens.write(id, secrets.apiToken)
            this.options.print(`${profile.name}: live account ${account.key} (${account.provider}) ${id} credential rewritten`)
            changed = true
        })
        const gone = held.filter((one) => !ids.has(one.id))
        tally.gone += gone.length
        for (const one of gone) this.options.print(`${profile.name}: account ${one.id} (${one.provider}) is no longer in the standard: kept (removal is a person's act)`)
        if (stopped.length > 0) this.options.print(`${profile.name}: ${String(stopped.length)} live accounts not created (credentials not set): ${stopped.join(", ")}`)
        return changed
    }

    /** Installs the agents with their primary graphs, attached BY KIND to the workspace's accounts (live first; sandbox on the local stack only). */
    private async installAgents(
        profile: SetProfile,
        workspaceId: string,
        place: EnterpriseSeedPlace,
    ): Promise<{ readonly seeded: ReadonlyArray<SeededModule>; readonly changed: boolean }> {
        const sandbox = new Set((await this.connections.list(workspaceId)).filter((connection) => connection.sandbox).map((connection) => connection.id))
        const entries: Array<GraphSeedEntry> = []
        await eachInOrder(profile.agents, async ({ module }) => {
            const spec = primaryGraphOf(module)
            if (spec === null) {
                this.options.print(`${profile.name}: ${module} has no single primary workflow installed: not seeded`)
                return
            }
            // A test set attaches as the roster does (live first); a standard attaches every working account it names (node settings may name a sandbox one).
            const lines = await this.abilities.templateProposal(workspaceId, module)
            const plan =
                profile.use === "workspace" ? attachEveryOf(lines, (id) => sandbox.has(id), place, this.sandboxOn) : attachPlanOf(lines, (id) => sandbox.has(id), place)
            for (const kind of plan.missing) this.options.print(`${profile.name}: ${module} works with ${kind}: no usable account`)
            entries.push({ spec, wishes: plan.wishes })
        })
        if (entries.length === 0) return { seeded: [], changed: false }
        const seeded = await this.graphs.seedInto(workspaceId, entries)
        return { seeded, changed: seeded.some((module) => module.changed) }
    }

    /**
     * A SANDBOX account is a test account, and the door that opens one by hand (the Sandbox page: open, attach, `switchOn`) leaves every
     * trigger its provider declares with an owner switch ON (`catchUp` off: from now). The seed opens and attaches the same accounts and must
     * leave the same state, else a paid webhook or a mail is kept and never wakes a run (matrix round 3, D3-W2-2). So after the attachments,
     * each SANDBOX account the profile names gets its still-off, never-fired switches turned on, through the one switch door
     * (`ProviderTriggerStatesService.setEnabled`). A LIVE account is never touched here: its triggers stay off until the owner turns them on
     * (concept triggers rule 6). A switch already on, or one that fired, stays as it is. Answers whether any switch was turned on.
     */
    private async switchSandboxTriggersOn(profile: SetProfile, workspaceId: string, ownerId: string): Promise<boolean> {
        if (this.triggers === undefined) return false
        const actor = { principalId: ownerId, workspaceId }
        const held = await this.connections.list(workspaceId)
        let changed = false
        await eachInOrder(profile.accounts.filter((account) => account.sandbox), async (account) => {
            const id = this.accountIdOf(profile, account.key, workspaceId, held)
            if (!held.some((one) => one.id === id && one.sandbox)) return
            const off = (await this.triggers?.statesOf(actor, id) ?? []).filter((state) => !state.enabled && state.lastFiredAt === null)
            await eachInOrder(off, async (state) => {
                await this.triggers?.setEnabled(actor, { connectionId: id, trigger: state.name, enabled: true, catchUp: false })
                this.options.print(`${profile.name}: sandbox account ${account.key} (${account.provider}) trigger ${state.name} switched on`)
                changed = true
            })
        })
        return changed
    }

    /** Keeps each document through the knowledge door (found by the seed's origin and its title; a changed text is queued again). */
    private async keepDocuments(profile: SetProfile, workspaceId: string, ownerId: string, texts: DocumentTexts): Promise<boolean> {
        let changed = false
        await eachInOrder(profile.documents, async (document) => {
            const outcome = await this.sources.keep({
                workspaceId,
                ownerId,
                origin: `seed:${profile.name}`,
                title: document.title,
                topic: document.topic,
                module: document.module,
                visibility: document.visibility,
                content: texts[document.path] ?? "",
            })
            if (outcome !== "unchanged") {
                changed = true
                this.options.print(`${profile.name}: document ${document.path} ${outcome}`)
            }
        })
        return changed
    }

    /**
     * Writes the truths and the policy judgement of each, in the order the truth graph's own rules need: (1) every truth that is not WAITING
     * is filed as a proposal (an owner's, manager's, document's or staff statement) and approved at once WITHOUT an announcement: in force,
     * scheduled for its later start, or expired history for an end already past; (2) the judgement of each truth now held is stored
     * (`model: seed`, so the derive pass binds it and asks no model); (3) each WAITING value is filed beside the value in force of its key;
     * (4) ONE announcement covers the whole write, so no derive pass can start before the judgements exist. A truth already written is found
     * by its subject, attribute and value and left alone; a NEW value of a key whose value in force a PERSON stated (not the seed) is not filed
     * (the person's word wins) unless the force names `truths`. A truth the seed wrote whose key the standard no longer names is reported.
     * With `write` off, it only counts.
     */
    private async writeTruths(profile: SetProfile, truths: ReadonlyArray<SetFact>, workspaceId: string, reseed: Reseed | null, tally: SeedTally, write: boolean): Promise<boolean> {
        const today = this.today()
        const standings = truths.map((fact) => standingOf(fact, today))
        const subjects = new Map<string, Array<FactRecord>>()
        const evidence = [{ kind: "manual" as const, ref: `seed:${profile.name}`, label: `Seed ${profile.name}` }]
        const personWins = reseed?.kinds.has("truths") !== true
        const knownOf = async (subjectKey: string): Promise<Array<FactRecord>> => {
            let known = subjects.get(subjectKey)
            if (known === undefined) {
                known = [...(await this.facts.list(workspaceId, { subjectKey }))]
                subjects.set(subjectKey, known)
            }
            return known
        }
        const recordOf = async (fact: SetFact): Promise<{ readonly record: FactRecord; readonly isNew: boolean } | null> => {
            const known = await knownOf(factSlugOf(fact.subject))
            const attribute = factSlugOf(fact.attribute)
            const line = valueLineOf({ value: fact.value, unit: fact.unit })
            const found = known.find((one) => WRITTEN.has(one.status) && one.attribute === attribute && sameValue(valueLineOf(one), line))
            if (found !== undefined) return { record: found, isNew: false }
            if (personWins && known.some((one) => one.status === "active" && one.attribute === attribute && one.proposedBy !== SEEDER)) {
                tally.byPerson += 1
                return null
            }
            tally.created += 1
            if (!write) return null
            const input: FactInput = {
                subjectType: fact.subjectType,
                subjectLabel: fact.subject,
                attributeLabel: fact.attribute,
                value: fact.value,
                unit: fact.unit,
                scope: fact.scope,
                sourceKind: fact.source,
                validFrom: fact.validFrom,
                validTo: fact.validTo,
                evidence,
                proposedBy: SEEDER,
                autoApply: false,
            }
            const { fact: record } = await this.facts.propose(workspaceId, input)
            known.push(record)
            return { record, isNew: true }
        }
        const changedIds: Array<string> = []
        const held: Array<{ readonly fact: SetFact; readonly standing: string; readonly record: FactRecord }> = []
        for (const [index, fact] of truths.entries()) {
            const standing = standings[index] ?? "in_force"
            if (standing === "waiting") continue
            const found = await recordOf(fact)
            if (found === null) continue
            let { record } = found
            if (record.status === "proposed") {
                record = await this.facts.applyUnannounced(workspaceId, record.id, SEEDER)
                changedIds.push(record.id)
            } else if (found.isNew) {
                changedIds.push(record.id)
            }
            held.push({ fact, standing, record })
        }
        const judged = write && (await this.judge(profile, workspaceId, held))
        for (const [index, fact] of truths.entries()) {
            if ((standings[index] ?? "in_force") !== "waiting") continue
            const found = await recordOf(fact)
            if (found?.isNew === true) changedIds.push(found.record.id)
        }
        if (reseed !== null) {
            const named = new Set(truths.map((fact) => `${factSlugOf(fact.subject)}|${factSlugOf(fact.attribute)}`))
            const seeded = await this.facts.list(workspaceId, { statuses: ["active", "scheduled"] })
            tally.gone += seeded.filter((one) => one.proposedBy === SEEDER && !named.has(`${one.subjectKey}|${one.attribute}`)).length
        }
        if (!write) return false
        if (changedIds.length > 0) await this.facts.announceChanged(workspaceId, changedIds)
        if (truths.length > 0) this.options.print(`${profile.name}: ${String(truths.length)} truths read, ${String(changedIds.length)} written, ${judged ? "judgements stored" : "judgements kept"}`)
        return changedIds.length > 0 || judged
    }

    /** Stores the policy judgement of each truth that will be held (in force or scheduled) and has none; true when any was stored. */
    private async judge(
        profile: SetProfile,
        workspaceId: string,
        filed: ReadonlyArray<{ readonly fact: SetFact; readonly standing: string; readonly record: FactRecord }>,
    ): Promise<boolean> {
        const known = new Set((await this.judgements.all(workspaceId)).map((one) => `${one.subjectKey}|${one.attribute}|${one.installationId ?? ""}`))
        const judged: Array<Parameters<BrainPolicyStoreService["save"]>[1][number]> = []
        for (const { fact, standing, record } of filed) {
            if (standing !== "in_force" && standing !== "scheduled") continue
            const key = `${record.subjectKey}|${record.attribute}|${record.installationId ?? ""}`
            if (known.has(key)) continue
            known.add(key)
            judged.push({
                fact: record,
                known: null,
                judgement: {
                    policy: fact.policy !== null,
                    title: fact.policy?.title ?? "",
                    group: fact.policy?.group ?? "",
                    reason: `Seeded by ${profile.name}`,
                },
                model: SEEDER,
            })
        }
        if (judged.length > 0) await this.judgements.save(workspaceId, judged)
        return judged.length > 0
    }

    /** Binds each customer channel of the workspace to the front door of the document's agents (the roster seed's own step). */
    private async bindDoors(
        profile: SetProfile,
        workspaceId: string,
        ownerId: string,
        seeded: ReadonlyArray<SeededModule>,
        place: EnterpriseSeedPlace,
    ): Promise<boolean> {
        const agents = profile.agents.flatMap(({ module }): ReadonlyArray<TemplateAgent> => {
            const agent = INSTALLED.templateAgentOf(module)
            return agent === null ? [] : [agent]
        })
        const bound = await this.roster.bindFrontDoors(
            { workspaceId, ownerId, identifier: profile.name, place },
            agents,
            seeded,
            await this.connections.list(workspaceId),
        )
        return bound > 0
    }

    private today(): string {
        return this.clock.now().toISOString().slice(0, 10)
    }

    /** The owner of the one live workspace of that name; none or several are refused. */
    private async ownerOf(named: ReadonlyArray<{ readonly id: string; readonly name: string }>, name: string): Promise<string> {
        const ids = await this.liveNamed(named, name)
        const [only] = ids
        if (only === undefined || ids.length > 1) return refused("ownerWorkspace")
        return (await this.workspaces.ownerIdOf(only)) ?? refused("ownerWorkspace")
    }

    /** The live workspaces of that name the owner owns. */
    private async ownedLive(named: ReadonlyArray<{ readonly id: string; readonly name: string }>, name: string, ownerId: string): Promise<Array<string>> {
        const owned: Array<string> = []
        await eachInOrder(await this.liveNamed(named, name), async (id) => {
            if ((await this.workspaces.ownerIdOf(id)) === ownerId) owned.push(id)
        })
        return owned
    }

    /** The ids of the workspaces of that name nobody deleted. */
    private async liveNamed(named: ReadonlyArray<{ readonly id: string; readonly name: string }>, name: string): Promise<Array<string>> {
        const live: Array<string> = []
        await eachInOrder(
            named.filter((workspace) => workspace.name === name),
            async (workspace) => {
                if (await this.workspaces.isLive(workspace.id)) live.push(workspace.id)
            },
        )
        return live
    }
}
