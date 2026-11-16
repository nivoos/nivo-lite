import { Injectable, Optional } from "@nestjs/common"
import { AgentDirectoryService } from "@modules/domain/agents"
import { AgentRunsService } from "@modules/domain/agent-runs"
import { callerRunIdOf } from "@modules/domain/agent-work"
import { ConnectionBindingsReadService } from "@modules/domain/connections"
import { CustomerRoutesService } from "@modules/domain/customer-routes"
import type { NodeStepRef } from "@modules/domain/graph-nodes"
import { INSTALLED } from "@modules/domain/installed-plugins"
import { ToolCallLogService } from "@modules/domain/tool-call-log"
import { AccountAttachmentsService, type ProviderAttachmentView } from "@modules/domain/tool-grants"
import { OPENAPI_PROVIDER } from "@modules/domain/openapi-tools"
import { ownersOfTool, toolSpecOf } from "@modules/domain/tool-specs"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { eachInOrder } from "@modules/platform/primitives"
import { EffectRightAuditService, type EffectRightLine } from "./effect-right-audit.service"
import { accountLabelOf } from "./account-label.policy"
import { ABILITY_LABELS, KIND_LABELS, PROVIDER_LABELS, labelOf } from "./messages/provider-abilities.labels"
import {
    PROVIDER_CATALOGUE,
    bindNodeProviders,
    holdsTool,
    isProviderTool,
    judgeAttachment,
    providerSpecOf,
    providersOfDeclaration,
    servesTool,
    unpickedOf,
    worldOfAccount,
    type AccountTarget,
    type AccountWorld,
    type AttachmentVerdict,
    type OptionalRightVerdict,
    type PickNeeded,
    type RunAccountFacts,
} from "./provider-abilities.policy"
import { providersOfTemplateAgent } from "./template-agent-providers.policy"
import { keyUnder, nodeKeysOf, type OptionalNodeProviderKey } from "./node-provider-keys.policy"
import type {
    AccountView,
    AttachmentChangeResult,
    AttachmentRefusal,
    AttachmentWish,
    ProposedAttachment,
    ProviderBoard,
    TemplateCandidate,
    TemplateProposal,
} from "./agent-accounts.contracts"
import type { RightSeen } from "./right-origin.contracts"
import { InjectNodeRequestsGate } from "./node-requests.decorators"
import { seenAtStep, type StepSeen } from "./node-rule.policy"
import { workflowStepOf, type NodeRequestsGate, type OptionalNodeRequest } from "./node-mode.policy"
import { ToolsLogEvent } from "./tools.log-events"

/** The most connections of one provider a workspace is read for. */
const CONNECTIONS_MAX = 20

/** The most earlier calls of a run read for the accounts the run already used. */
const RUN_CALLS_MAX = 200

/** The most agents of a workspace looked through for a template. */
const AGENTS_MAX = 200

/** The most runs a world is looked for along a chain of workflow calls (the run, its caller, the caller's caller, ...). */
const CALL_CHAIN_MAX = 8

/** The most stored node settings naming an unattached account this process reports (each once). */
const SKIPS_REPORTED_MAX = 1000

/** One account a call may act on: its provider and its connection. */
export interface BoundAccount {
    /** The provider key. */
    readonly provider: string
    /** The connection. */
    readonly connectionId: string
}

/** The run a call is made in, as far as choosing its account needs it. */
export interface RunRef {
    /** The run (its trigger's context and its earlier calls are read by this id). */
    readonly runId: string
}

/** An account a call may act on, with whether it is the agent's default account of its provider (read from its attachment). */
interface ServingAccount extends BoundAccount {
    /** True when the attachment is the agent's default of its provider. */
    readonly isDefault: boolean
}

/** The account a call is handed: its provider and its connection only. */
const plainOf = ({ provider, connectionId }: BoundAccount): BoundAccount => ({ provider, connectionId })

/** The bound accounts with the run's own account (when one of them) first, the rest in their order. */
const ownFirst = (bound: ReadonlyArray<BoundAccount>, own: string | null): ReadonlyArray<BoundAccount> =>
    own === null
        ? bound
        : [...bound.filter((account) => account.connectionId === own), ...bound.filter((account) => account.connectionId !== own)]

/** The accounts a step's node settings chose, by provider, in the node's order (the entries a choice bound, `node-settings.policy`). */
const chosenOfRequest =
    (accounts: ReadonlyArray<{ readonly provider: string; readonly connectionId: string | null }>) =>
    (provider: string): ReadonlyArray<string> =>
        accounts.flatMap((account) => (account.provider === provider && account.connectionId !== null ? [account.connectionId] : []))

/** The accounts a node binds, and the first listed provider of which the agent holds several accounts and no rule picks one. */
interface NodeBinding {
    /** The bound accounts, in the node's order of providers. */
    readonly bound: ReadonlyArray<BoundAccount>
    /** The first listed provider still to pick, or null. */
    readonly unpicked: PickNeeded | null
    /** Why the run's world binds nothing a listed provider serves the call with, or null (rule 19). */
    readonly world: WorldRefusal | null
}

/**
 * Why ONE WORLD PER RUN (lane concept provider-sandbox rule 19) leaves a call without an account: the run's world is fixed and every
 * attached account serving it is of the other world (`other_world`, with the first such provider), or nothing fixes the run's world and
 * the accounts serving it are of both (`undecided`). What the typed refusals `TOOLS_ACCOUNT_OTHER_WORLD` / `TOOLS_RUN_WORLD_UNDECIDED` name.
 */
export type WorldRefusal =
    | { readonly kind: "other_world"; readonly provider: string; readonly world: AccountWorld }
    | { readonly kind: "undecided"; readonly provider: string }

/** The agent's attachments as the world rule reads them: each attached account's world, and the world its default accounts agree on. */
interface AgentWorlds {
    /** The sandbox flag of each attached account, by connection. */
    readonly flags: ReadonlyMap<string, boolean>
    /** The world every default account of the agent is of, else the world of every attached account, else null (both, no agreement). */
    readonly fallback: AccountWorld | null
}

/** The world a run acts in: fixed (`sandbox` / `live`), or nothing fixes it (`null`). */
type RunWorld = AccountWorld | null

/**
 * True for a tool no registry places on a provider: no core spec, no owner (a source key) and no catalogue provider (a plugin's own tool
 * or effect, a fixture's). Such a tool is served by the providers its NODE lists (nivo-frame `templates`: the node lists its providers in
 * order), never by any account outside a node: the data says nothing else about it.
 */
export const isNodePlacedTool = (tool: string): boolean =>
    toolSpecOf(tool) === null && ownersOfTool(tool).length === 0 && !isProviderTool(tool)

/** The status of a connection that works. */
const CONNECTED = "connected"

/** One send of a channel-bound effect to judge: who sends, the effect, the conversation's own account, and the turn's workflow step. */
export interface SendJudged {
    /** The workspace. */
    readonly workspaceId: string
    /** The agent of the turn. */
    readonly agentId: string
    /** The channel-bound effect (the customer send). */
    readonly effect: string
    /** The conversation's provider and its own connected account. */
    readonly target: AccountTarget
    /** The workflow step the node host named on the turn; absent for a turn outside a node run. */
    readonly step?: StepSeen | undefined
    /** The run of the turn, for the audit line of the verdict; absent when the caller knows none. */
    readonly runId?: string | undefined
    /** The conversation the send goes to, for the audit line of the verdict; absent when the caller knows none. */
    readonly conversationId?: string | undefined
}

/** The agent of a workspace that an attachment change is for. */
export interface AgentTarget {
    /** The workspace. */
    readonly workspaceId: string
    /** The agent. */
    readonly agentId: string
}

/** The agent of a workspace and the module whose template's providers are attached. */
export interface AgentModuleTarget extends AgentTarget {
    /** The module. */
    readonly moduleKey: string
}

/** The owner's wishes for an attachment set, or null when the module's own proposal is meant. */
export type AttachmentWishes = ReadonlyArray<AttachmentWish> | null

/** The member who made a change, or null when the system did. */
export type UpdatedBy = string | null

/** The attachments created when an agent was given its defaults. */
export interface DefaultsAttached {
    /** Always true: the attachments were stored. */
    readonly ok: true
    /** The attachments created. */
    readonly attached: ReadonlyArray<ProposedAttachment>
}

/** The answer of giving an agent its defaults: the attachments created, or the refusal of the first wish that cannot be stored. */
export type DefaultsResult = DefaultsAttached | Refused

/** Why the wishes cannot be stored, or null when every one can. */
export type WishProblem = AttachmentRefusal | null

/** The ids of the agents a template attached, or the refusal. */
export type TemplateAttachResult = ReadonlyArray<string> | Refused

/**
 * Where a send was asked from: the node's step, or the engine's own (its line on a stop, or a turn the host named no step for). The engine's
 * line names no node: it is never the node's call.
 */
const sendSeenOf = (engineLine: boolean, step: StepSeen | undefined): RightSeen => {
    if (engineLine || step === undefined) return { origin: engineLine ? "engine_line" : "engine_job" }
    return seenAtStep("node", step)
}

/** A change that was refused. */
export type Refused = Extract<AttachmentChangeResult, { readonly ok: false }>

const refused = (reason: AttachmentRefusal): Refused => ({ ok: false, reason })

/**
 * The providers a fresh agent of a module is attached to (nivo-frame `rights`): the ones its TEMPLATE agent lists (`providersOfTemplateAgent`)
 * when the module ships one, else the ones its old declaration names (`providersOfDeclaration`). THE ONE reader of a module's default
 * providers: attaching gives these, and the pre-install review shows these. No tick and no mode: a call's mode is its node's.
 */
export const moduleProvidersOf = (moduleKey: string): ReadonlyArray<string> => {
    const agent = INSTALLED.templateAgentOf(moduleKey)
    return agent === null ? providersOfDeclaration(INSTALLED.abilityDefaultsOf(moduleKey)) : providersOfTemplateAgent(agent)
}

@Injectable()
/**
 * The ACCOUNTS of agents (nivo-frame `rights`): the one reader and writer of the attachments of agents to the accounts a workspace
 * connected, and the one judge of whether a call of a provider tool reaches an account. A hard right is two things only: the agent's
 * ATTACHMENTS (detach = the kill switch) and each node's declared mode. A provider SERVES tools (the catalogue, information); an agent is
 * attached to a CONNECTED ACCOUNT (one connection); connecting an account gives no agent anything. A module's template only proposes
 * attachments that do not exist (a fresh agent, the seed, "attach by template") and never touches one the workspace holds. Webhook intake is
 * the workspace connection's and is not judged here.
 */
export class AgentAccountsService {
    constructor(
        private readonly rows: AccountAttachmentsService,
        private readonly agents: AgentDirectoryService,
        @Optional() private readonly connections?: ConnectionBindingsReadService,
        @Optional() @InjectNodeRequestsGate() private readonly nodeRequests: NodeRequestsGate | null = null,
        @Optional() private readonly effectAudit?: EffectRightAuditService,
        @Optional() private readonly callLog?: ToolCallLogService,
        @Optional() private readonly runs?: AgentRunsService,
        @Optional() @InjectLogger() private readonly logger?: Logger,
        @Optional() private readonly routes?: CustomerRoutesService,
    ) {}

    /** The stored node settings naming an unattached account this process has reported (each once). */
    private readonly skipsReported = new Set<string>()

    /**
     * Files the verdict of an EFFECT in the audit (`EffectRightAuditService`): called where such a verdict is produced, by the channel
     * send's seam here and by the node tool door for every other effect a provider serves. Without the audit in the app nothing is written.
     */
    async effectJudged(line: EffectRightLine): Promise<void> {
        await this.effectAudit?.record(line)
    }

    /**
     * The key nodes name each of the agent's OpenAPI accounts by (the source its pinned document serves), read only when there is one;
     * undefined when there is none or no reader of connections is bound (each account then goes by its own provider).
     */
    private async nodeKeys(
        workspaceId: string,
        rows: ReadonlyArray<ProviderAttachmentView>,
    ): Promise<ReadonlyMap<string, OptionalNodeProviderKey> | undefined> {
        if (!rows.some((row) => row.provider === OPENAPI_PROVIDER)) return undefined
        return nodeKeysOf(workspaceId, rows, this.connections)
    }

    /** The reader of a step's pinned node request; null when no reader is bound or it cannot be read (the mode then refuses). */
    private readRequest(workspaceId: string, agentId: string): (step: NodeStepRef) => Promise<OptionalNodeRequest> {
        return (step) =>
            this.nodeRequests === null ? Promise.resolve(null) : this.nodeRequests.requestOf(workspaceId, agentId, step)
    }

    /**
     * THE KILL SWITCH of one call of a provider tool: the agent's attached account of a provider serving the tool (`allow`, with the
     * account), or `not_attached`; null when no provider serves the tool (or a provider-bound tool names no provider). A call naming its
     * account (the one the ToolRunner handed) counts only an attachment to that very account. No mode is read here.
     */
    async attachmentOf(
        workspaceId: string,
        agentId: string,
        tool: string,
        target: AccountTarget = {},
    ): Promise<AttachmentVerdict | null> {
        if (!isProviderTool(tool)) return null
        return judgeAttachment(await this.rows.listOfAgent(workspaceId, agentId), tool, target)
    }

    /**
     * The right of a turn's agent to a channel-bound effect (the customer send) on the conversation's own account: the one seam of the
     * channel's executor. It is the attachment to that very account (the kill switch), filed in the audit with the step that asked. The
     * node's mode is NOT read here: the tool door asked it at the call, before the executor ran (rights rule 11), so a send that reaches
     * the executor is an `auto` one or an approved one.
     */
    async judgeSend(send: SendJudged): Promise<OptionalRightVerdict> {
        return this.sendJudged(send, sendSeenOf(false, send.step))
    }

    /**
     * The right of the ENGINE's own line to the customer on a stop (its holding line): the engine's own call, sent as the agent that speaks
     * in the conversation, which must be attached to the conversation's account; once attached it runs (no node mode asks it).
     */
    async judgeEngineLine(send: SendJudged): Promise<OptionalRightVerdict> {
        return this.sendJudged(send, sendSeenOf(true, send.step))
    }

    /** One send judged (attached to the account) and filed in the audit, as seen from where it was asked. */
    private async sendJudged(send: SendJudged, seen: RightSeen): Promise<OptionalRightVerdict> {
        const { workspaceId, agentId, effect, target } = send
        const verdict = await this.attachmentOf(workspaceId, agentId, effect, target)
        if (verdict !== null) {
            await this.effectJudged({
                workspaceId,
                agentId,
                effect,
                verdict,
                seen,
                runId: send.runId,
                conversationId: send.conversationId,
            })
        }
        return verdict
    }

    /**
     * The accounts one call of the tool may act on, in order (the ToolRunner hands the first and falls back along the rest): at a
     * workflow step, for each provider the step's node lists, IN THE NODE'S ORDER, the agent's attached account of it serving the tool
     * (`bindNodeProviders`: one account per provider; of several, none: never a guess, the node names one); outside a step, every
     * attached account serving the tool, in the store's order. Of several attached accounts of one provider, the order `pickAccountOf`
     * names one: the account the RUN's trigger came in on, an account the run already used, then the agent's default account of the
     * provider (`run` names the run; without it only the default can be read).
     */
    async boundAccountsOf(
        workspaceId: string,
        agentId: string,
        tool: string,
        seen?: RightSeen,
        run?: RunRef,
    ): Promise<ReadonlyArray<BoundAccount>> {
        const step = workflowStepOf(seen)
        // A tool no registry places is served only by the providers a node lists: none outside a step.
        const placed = isNodePlacedTool(tool)
        if (placed && step === null) return []
        const named = await this.servingOf(workspaceId, agentId, tool, placed)
        if (step === null) return (await this.inRunWorld(workspaceId, agentId, named, run)).map((account) => plainOf(account))
        return (await this.bindingOf(workspaceId, agentId, step, named, run)).bound
    }

    /**
     * Why ONE WORLD PER RUN binds no account for a call at a workflow step (rule 19): every attached account a listed provider serves it
     * with is of the other world, or nothing fixes the run's world and they are of both. Null when something binds, outside a step,
     * without a run, and when the node's request cannot be read. What the typed `TOOLS_ACCOUNT_OTHER_WORLD` / `TOOLS_RUN_WORLD_UNDECIDED`
     * refusals name: never a fall through to the other world.
     */
    async worldRefusalOf(
        workspaceId: string,
        agentId: string,
        tool: string,
        seen?: RightSeen,
        run?: RunRef,
    ): Promise<WorldRefusal | null> {
        const step = workflowStepOf(seen)
        if (step === null || run === undefined) return null
        const named = await this.servingOf(workspaceId, agentId, tool, isNodePlacedTool(tool))
        return (await this.bindingOf(workspaceId, agentId, step, named, run)).world
    }

    /**
     * The choice the owner still has to make for a call at a workflow step: the first provider its node lists, serving the tool, of which
     * the agent holds several attached accounts and no rule of the order picks one (`pickAccountOf`: the run's trigger, the run's earlier
     * calls, the agent's default account). Null when every listed provider binds or none has several accounts, outside a step, and when
     * the node's request cannot be read. It is what the typed `TOOLS_ACCOUNT_NEEDS_PICK` refusal names.
     */
    async pickNeeded(
        workspaceId: string,
        agentId: string,
        tool: string,
        seen?: RightSeen,
        run?: RunRef,
    ): Promise<PickNeeded | null> {
        const step = workflowStepOf(seen)
        if (step === null) return null
        const named = await this.servingOf(workspaceId, agentId, tool, isNodePlacedTool(tool))
        return (await this.bindingOf(workspaceId, agentId, step, named, run)).unpicked
    }

    /**
     * True when the call's workflow step lists at least one provider that serves the tool (nivo-frame `templates`: a tool takes an
     * account when its NODE lists providers that own it: the registry's owners or catalogue providers for a core tool, any listed provider
     * for a tool the node places, `isNodePlacedTool`). The call then acts only through an attached account of one of them, and none
     * attached is the kill switch (refused, never run on no account). False outside a step and for a node that lists none of them.
     */
    async listsProviders(workspaceId: string, agentId: string, tool: string, seen?: RightSeen): Promise<boolean> {
        const step = workflowStepOf(seen)
        if (step === null) return false
        const request = await this.readRequest(workspaceId, agentId)(step)
        const placed = isNodePlacedTool(tool)
        return (request?.accounts ?? []).some((account) => placed || servesTool(account.provider, account.provider, tool))
    }

    /**
     * The agent's attached accounts serving the tool, each under the provider key nodes name it by; for a tool the node places
     * (`isNodePlacedTool`), every attached account (the node's list of providers narrows it).
     */
    private async servingOf(
        workspaceId: string,
        agentId: string,
        tool: string,
        placed: boolean,
    ): Promise<ReadonlyArray<ServingAccount>> {
        const rows = await this.rows.listOfAgent(workspaceId, agentId)
        const keys = await this.nodeKeys(workspaceId, rows)
        return rows.flatMap((row) => {
            const provider = keyUnder(row, keys)
            return provider !== null && (placed || servesTool(provider, row.provider, tool))
                ? [{ provider, connectionId: row.connectionId, isDefault: row.isDefault === true }]
                : []
        })
    }

    /**
     * The accounts a step's NODE SETTINGS chose, in try order, that the agent is still attached to (a choice is judged when it is set; an
     * account detached since names nothing), each under the provider key the node names it by. None outside a step, for a step whose
     * request cannot be read, and for a step with no choice (the default pick). What a send that picks its own account (the customer
     * send's channel identity) prefers after the account the run was woken on.
     */
    async chosenAccountsOf(
        workspaceId: string,
        agentId: string,
        seen?: RightSeen,
        run?: RunRef,
    ): Promise<ReadonlyArray<BoundAccount>> {
        const step = workflowStepOf(seen)
        if (step === null) return []
        const request = await this.readRequest(workspaceId, agentId)(step)
        const chosen = (request?.accounts ?? []).flatMap((account) =>
            account.connectionId === null ? [] : [{ provider: account.provider, connectionId: account.connectionId }],
        )
        if (chosen.length === 0) return []
        const attached = new Set((await this.rows.listOfAgent(workspaceId, agentId)).map((row) => row.connectionId))
        this.reportUnattached(workspaceId, step, chosen, attached)
        return this.inRunWorld(workspaceId, agentId, chosen.filter((account) => attached.has(account.connectionId)), run)
    }

    /**
     * The attached accounts a step's node binds, in the node's order of providers (none when its request cannot be read), and the first
     * listed provider still to pick. Of several attached accounts of one provider the order `pickAccountOf` names one (never a guess):
     * the run's trigger, the run's earlier calls, the step's chosen accounts (its node settings), the agent's default account of the
     * provider. ONE WORLD PER RUN (lane concept provider-sandbox rule 19): whenever a run is named and an attached account serves the call,
     * the run's world (`runWorldOf`) narrows EVERY rung to that world's accounts BEFORE the order picks, so no rung (the event, the run's
     * earlier calls, a node setting, the default) can name an account of the other world; a listed provider with none of that world binds
     * nothing and the call is refused typed (`world`), never sent in the other world. A stored node setting naming an account the agent is
     * not attached to names nothing (it is skipped, and reported once).
     */
    private async bindingOf(
        workspaceId: string,
        agentId: string,
        step: NodeStepRef,
        named: ReadonlyArray<ServingAccount>,
        run: RunRef | undefined,
    ): Promise<NodeBinding> {
        const request = await this.readRequest(workspaceId, agentId)(step)
        if (request === null) return { bound: [], unpicked: null, world: null }
        const providers = request.accounts.map((account) => account.provider)
        const listed = named.filter((account) => providers.includes(account.provider))
        const agent = await this.worldsOfAgent(workspaceId, agentId)
        this.reportUnattached(workspaceId, step, request.accounts, agent.flags)
        const flagged = named.map((account) => ({ ...account, sandbox: agent.flags.get(account.connectionId) === true }))
        if (run === undefined || listed.length === 0) return this.picked(providers, flagged, request.accounts, undefined)
        const facts = await this.runFactsOf(workspaceId, run)
        const world = await this.runWorldOf(workspaceId, run, facts, agent)
        if (world !== null) return this.picked(providers, flagged, request.accounts, { ...facts, world })
        // Nothing fixes the run's world: the one world the serving accounts are of is the only one there is; two are never guessed between.
        const [only, ...other] = [...new Set(flagged.filter((account) => providers.includes(account.provider)).map((account) => worldOfAccount(account)))]
        if (only !== undefined && other.length === 0) return this.picked(providers, flagged, request.accounts, { ...facts, world: only })
        const [first] = listed
        return { bound: [], unpicked: null, world: first === undefined ? null : { kind: "undecided", provider: first.provider } }
    }

    /** The binding of a node under the run's facts (its world, when fixed, narrows every rung): the bound, the pick to make, the world refusal. */
    private picked(
        providers: ReadonlyArray<string>,
        flagged: ReadonlyArray<ServingAccount & { readonly sandbox: boolean }>,
        chosen: ReadonlyArray<{ readonly provider: string; readonly connectionId: string | null }>,
        facts: RunAccountFacts | undefined,
    ): NodeBinding {
        const defaultOf = (provider: string): string | null =>
            flagged.find((account) => account.provider === provider && account.isDefault)?.connectionId ?? null
        const chosenOf = chosenOfRequest(chosen)
        // The run's OWN account (the one its event came in on, else its person's route's) goes first when the node binds it: a send to a
        // person goes out on the channel the person writes on, before the node's provider order (FIX-C2).
        const bound = ownFirst(
            bindNodeProviders(providers, flagged, defaultOf, facts, chosenOf).map((account) => plainOf(account)),
            facts?.triggerConnectionId ?? null,
        )
        const world = facts?.world
        // The run's world binds nothing a listed provider serves the call with, though the other world would: the typed refusal names it.
        const other =
            world === undefined || bound.length > 0
                ? undefined
                : flagged.find((account) => providers.includes(account.provider) && worldOfAccount(account) !== world)
        return {
            bound,
            unpicked: unpickedOf(providers, flagged, defaultOf, facts, chosenOf)[0] ?? null,
            world: other === undefined || world === undefined ? null : { kind: "other_world", provider: other.provider, world },
        }
    }

    /**
     * The accounts of a list a call made in a run may use (rule 19): only those of the run's world; every one without a run (a caller that
     * names none); and none when nothing fixes the run's world while the list holds both worlds (never a guess between them).
     */
    private async inRunWorld<A extends BoundAccount>(
        workspaceId: string,
        agentId: string,
        accounts: ReadonlyArray<A>,
        run: RunRef | undefined,
    ): Promise<ReadonlyArray<A>> {
        if (run === undefined || accounts.length === 0) return accounts
        const agent = await this.worldsOfAgent(workspaceId, agentId)
        const worlds = await Promise.all(
            accounts.map(async (account) =>
                worldOfAccount({ sandbox: agent.flags.get(account.connectionId) ?? (await this.sandboxOf(account.connectionId)) }),
            ),
        )
        const fixed = await this.runWorldOf(workspaceId, run, await this.runFactsOf(workspaceId, run), agent)
        const [only, ...other] = [...new Set(worlds)]
        const world = fixed ?? (other.length === 0 ? only : undefined)
        return world === undefined ? [] : accounts.filter((_account, at) => worlds[at] === world)
    }

    /**
     * The agent's attachments as the world rule reads them: the sandbox flag of each attached account (read fresh from the connections on
     * every call, never cached), and the world its default accounts agree on, else the world of every attached account (one world held),
     * else null. Empty flags when no reader of connections is bound.
     */
    private async worldsOfAgent(workspaceId: string, agentId: string): Promise<AgentWorlds> {
        const rows = await this.rows.listOfAgent(workspaceId, agentId)
        if (this.connections === undefined) return { flags: new Map(), fallback: null }
        const ids = [...new Set(rows.map((row) => row.connectionId))]
        const facts = (await this.connections.factsOf(ids, ids.length)) ?? []
        const flags = new Map(facts.map((fact) => [fact.id, fact.sandbox === true]))
        const agreed = (held: ReadonlyArray<{ readonly connectionId: string }>): AccountWorld | null => {
            const [only, ...other] = [...new Set(held.map((row) => worldOfAccount({ sandbox: flags.get(row.connectionId) })))]
            return only !== undefined && other.length === 0 ? only : null
        }
        return { flags, fallback: agreed(rows.filter((row) => row.isDefault === true)) ?? agreed(rows) }
    }

    /** The sandbox flag of one connection (an account the agent is not attached to: a trigger's), or undefined when it cannot be read. */
    private async sandboxOf(connectionId: string): Promise<boolean | undefined> {
        return (await this.connections?.factsOf([connectionId], 1))?.find((fact) => fact.id === connectionId)?.sandbox
    }

    /**
     * What the run tells about its accounts, from what the engine already records: the account its triggering event came in on (the
     * `connectionId` of the run's stored trigger context) and the accounts its earlier `ok` calls acted on (the tool call log of the
     * run, the most recent first). A reader that is not bound tells nothing.
     */
    private async runFactsOf(workspaceId: string, run: RunRef): Promise<RunAccountFacts> {
        const [started, used] = await Promise.all([
            this.runs?.runOf(workspaceId, run.runId) ?? Promise.resolve(null),
            this.callLog?.connectionsUsedByRun(workspaceId, run.runId, RUN_CALLS_MAX) ?? Promise.resolve([]),
        ])
        const trigger = started?.context.connectionId
        const own = typeof trigger === "string" && trigger !== "" ? trigger : await this.routeAccountOf(workspaceId, started?.context.conversationId)
        return { triggerConnectionId: own, usedConnectionIds: used }
    }

    /**
     * The account of the person's ROUTE a run serves (its context's `conversationId`: the route the subject of a called or scheduled run
     * carries from its caller): the channel the person writes on. Null for a run that serves no route, or in an app with no routes.
     */
    private async routeAccountOf(workspaceId: string, routeId: unknown): Promise<string | null> {
        if (typeof routeId !== "string" || routeId === "" || this.routes === undefined) return null
        return (await this.routes.get(workspaceId, routeId))?.accountId ?? null
    }

    /**
     * THE RUN'S WORLD (lane concept provider-sandbox rule 19, ONE WORLD PER RUN), the first of these that names one: (1) the account of the
     * event that started the run (its trigger's account); (2) the world of the run that CALLED it: a workflow call or a hand-off inherits
     * its caller's world, along the chain of calls (at most `CALL_CHAIN_MAX` runs); (3) the account the run's own calls first bound; (4) the
     * world the agent's default accounts agree on, else the world of every account the agent holds (a clock round, a start by hand). Null:
     * nothing fixes it (the agent holds both worlds and its defaults do not agree on one).
     */
    private async runWorldOf(workspaceId: string, run: RunRef, facts: RunAccountFacts, agent: AgentWorlds): Promise<RunWorld> {
        return (await this.chainWorldOf(workspaceId, run.runId, facts, agent, new Set([run.runId]))) ?? agent.fallback
    }

    /** The world one run of a chain of calls names: its trigger's account, else its caller's world, else its own first bound account; else null. */
    private async chainWorldOf(
        workspaceId: string,
        runId: string,
        facts: RunAccountFacts,
        agent: AgentWorlds,
        seen: ReadonlySet<string>,
    ): Promise<RunWorld> {
        const worldOf = async (connectionId: string | null | undefined): Promise<RunWorld> => {
            if (connectionId === null || connectionId === undefined) return null
            const sandbox = agent.flags.get(connectionId) ?? (await this.sandboxOf(connectionId))
            return sandbox === undefined ? null : worldOfAccount({ sandbox })
        }
        const byTrigger = await worldOf(facts.triggerConnectionId)
        if (byTrigger !== null) return byTrigger
        const started = await (this.runs?.runOf(workspaceId, runId) ?? Promise.resolve(null))
        const caller = started === null ? null : callerRunIdOf(started.context)
        if (caller !== null && !seen.has(caller) && seen.size < CALL_CHAIN_MAX) {
            const callerFacts = await this.runFactsOf(workspaceId, { runId: caller })
            const byCaller = await this.chainWorldOf(workspaceId, caller, callerFacts, agent, new Set([...seen, caller]))
            if (byCaller !== null) return byCaller
        }
        const used = facts.usedConnectionIds ?? []
        return worldOf(used.at(-1))
    }

    /**
     * Reports, once per process for each (workspace, workflow version, node, account), a stored node setting that names an account the
     * agent is not attached to: such an entry names nothing at the pick (it is skipped), and the owner is told through the log.
     */
    private reportUnattached(
        workspaceId: string,
        step: NodeStepRef,
        chosen: ReadonlyArray<{ readonly provider: string; readonly connectionId: string | null }>,
        attached: ReadonlyMap<string, boolean> | ReadonlySet<string>,
    ): void {
        for (const entry of chosen) {
            if (entry.connectionId === null || attached.has(entry.connectionId)) continue
            const key = `${workspaceId}:${step.versionId}:${step.nodeKey}:${entry.connectionId}`
            if (this.skipsReported.has(key) || this.skipsReported.size >= SKIPS_REPORTED_MAX) continue
            this.skipsReported.add(key)
            this.logger?.warn(ToolsLogEvent.NodeSettingAccountSkipped, {
                workspaceId,
                workflowVersionId: step.versionId,
                nodeKey: step.nodeKey,
                provider: entry.provider,
                connectionId: entry.connectionId,
            })
        }
    }

    /**
     * The accounts a read over several accounts may cover: the agent's attached accounts serving the tool, narrowed at a workflow step to
     * the providers its node lists (in its order), and in a run to the run's world (rule 19).
     */
    async accountsOfAgent(
        workspaceId: string,
        agentId: string,
        tool: string,
        seen?: RightSeen,
        run?: RunRef,
    ): Promise<ReadonlyArray<string>> {
        const step = workflowStepOf(seen)
        const placed = isNodePlacedTool(tool)
        if (placed && step === null) return []
        const named = await this.inRunWorld(workspaceId, agentId, await this.servingOf(workspaceId, agentId, tool, placed), run)
        if (step === null) return named.map((row) => row.connectionId)
        const request = await this.readRequest(workspaceId, agentId)(step)
        const listed = [...new Set(request?.accounts.map((account) => account.provider) ?? [])]
        return listed.flatMap((provider) => named.filter((row) => row.provider === provider).map((row) => row.connectionId))
    }

    /** The agents of a workspace attached to an account of a provider serving any of the tools, by provider then agent. */
    async agentsHolding(workspaceId: string, tools: ReadonlyArray<string>): Promise<ReadonlyArray<string>> {
        if (!tools.some((tool) => isProviderTool(tool))) return []
        const rows = await this.rows.listOfWorkspace(workspaceId)
        return [...new Set(rows.filter((row) => tools.some((tool) => holdsTool(row, tool))).map((row) => row.agentId))]
    }

    /** Every provider with the tools it serves and the workspace's accounts of it, and every attachment of the workspace. */
    async board(workspaceId: string): Promise<ProviderBoard> {
        const [accounts, attachments] = await Promise.all([
            this.accountsOf(workspaceId),
            this.rows.listOfWorkspace(workspaceId),
        ])
        return {
            providers: PROVIDER_CATALOGUE.map((spec) => {
                const own = accounts.filter((account) => account.provider === spec.provider)
                return {
                    provider: spec.provider,
                    label: labelOf(PROVIDER_LABELS, spec.provider),
                    kind: spec.kind,
                    kindLabel: labelOf(KIND_LABELS, spec.kind),
                    connected: own.some((account) => account.connected),
                    abilities: spec.abilities.map((ability) => ({
                        id: ability.id,
                        label: labelOf(ABILITY_LABELS[spec.provider], ability.id),
                        scope: ability.scope,
                        tools: ability.tools,
                    })),
                    accounts: own,
                }
            }),
            attachments,
        }
    }

    /** What a fresh agent of a module would be attached to in this workspace: every working account of a provider its template lists. */
    async proposalOf(workspaceId: string, moduleKey: string): Promise<ReadonlyArray<ProposedAttachment>> {
        const named = await this.templateProposal(workspaceId, moduleKey)
        return named.flatMap((entry) =>
            entry.connectionId === null ? [] : [{ connectionId: entry.connectionId, provider: entry.provider }],
        )
    }

    /**
     * Every line of a module's proposal, in catalogue order: one per working account of each provider its template lists
     * (`moduleProvidersOf`), and one line with no account for a listed provider the workspace has not connected (so a dialog can say "not
     * connected yet"). Nothing is written.
     */
    async templateProposal(workspaceId: string, moduleKey: string): Promise<ReadonlyArray<TemplateProposal>> {
        const listed = new Set(moduleProvidersOf(moduleKey))
        const accounts = await this.servedAccountsOf(workspaceId, moduleKey, await this.accountsOf(workspaceId))
        return PROVIDER_CATALOGUE.filter((spec) => listed.has(spec.provider)).flatMap((spec): ReadonlyArray<TemplateProposal> => {
            const working = accounts.filter((account) => account.provider === spec.provider && account.connected)
            if (working.length === 0) {
                return [{ provider: spec.provider, connectionId: null, accountLabel: null, connected: false }]
            }
            return working.map((account) => ({
                provider: spec.provider,
                connectionId: account.connectionId,
                accountLabel: account.label,
                connected: true,
            }))
        })
    }

    /**
     * Gives an agent its attachments where it holds none: the owner's wishes when given (the edited proposal of a creation), else the
     * module's proposal. An attachment the agent already holds is left exactly as it is. Answers the attachments created, or the refusal of
     * the first wish that cannot be stored (nothing is written then).
     */
    async attachDefaults(target: AgentModuleTarget, wishes: AttachmentWishes, updatedBy: UpdatedBy): Promise<DefaultsResult> {
        const { workspaceId, agentId } = target
        const wanted =
            wishes === null ? await this.proposalOf(workspaceId, target.moduleKey) : await this.wished(workspaceId, wishes)
        if ("ok" in wanted) return wanted
        const made = await this.rows.insertMissing(
            wanted.map((entry) => ({ workspaceId, agentId, ...entry })),
            updatedBy,
        )
        return { ok: true, attached: made.map(({ connectionId, provider }) => ({ connectionId, provider })) }
    }

    /** Why the wishes cannot be stored in this workspace (the first that cannot), or null when every one can; nothing is written. */
    async wishProblem(workspaceId: string, wishes: ReadonlyArray<AttachmentWish>): Promise<WishProblem> {
        const wanted = await this.wished(workspaceId, wishes)
        return "ok" in wanted ? wanted.reason : null
    }

    /** Attaches an agent to a working account; an agent already attached is refused. */
    async attach(target: AgentTarget, wish: AttachmentWish, updatedBy: string): Promise<AttachmentChangeResult> {
        const wanted = await this.wished(target.workspaceId, [wish])
        if ("ok" in wanted) return wanted
        const [entry] = wanted
        if (entry === undefined) return refused("unknown_account")
        const outcome = await this.rows.attach({ ...target, ...entry }, updatedBy)
        if (outcome !== "attached") return refused(outcome === "held" ? "already_attached" : "unknown_agent")
        return { ok: true }
    }

    /** Detaches an agent from an account: the KILL SWITCH (no account, the tool is unavailable to the agent). */
    async detach(workspaceId: string, agentId: string, connectionId: string): Promise<AttachmentChangeResult> {
        if (!(await this.rows.detach(workspaceId, agentId, connectionId))) return refused("not_attached")
        return { ok: true }
    }

    /**
     * Makes the agent's attachment to an account the agent's DEFAULT account of its provider: what a step's call uses when the agent holds
     * several accounts of the provider and neither the run's trigger nor the run's earlier calls name one. The default it replaces
     * loses the flag (at most one per agent and provider). Refused `not_attached` when the agent holds no attachment to the account;
     * detaching the default clears it with its row.
     */
    async setDefault(target: AgentTarget, connectionId: string, updatedBy: string): Promise<AttachmentChangeResult> {
        const outcome = await this.rows.setDefault(target.workspaceId, target.agentId, connectionId, updatedBy)
        return outcome === "set" ? { ok: true } : refused("not_attached")
    }

    /**
     * Detaches an agent from every account it is attached to: what the removal of an agent does, since a removed agent holds no
     * right. A paused agent keeps its attachments (it comes back with them). Answers how many went.
     */
    async detachAgent(workspaceId: string, agentId: string): Promise<number> {
        return this.rows.detachAgent(workspaceId, agentId)
    }

    /**
     * The agents a template would attach to an account the workspace connected after they were created: every ACTIVE agent whose
     * module's template lists the account's provider (and is served by it) and that is not attached to that account yet. A removed or
     * paused agent is never one. The connect page asks once with this list.
     */
    async templateCandidates(workspaceId: string, connectionId: string): Promise<ReadonlyArray<TemplateCandidate>> {
        const account = (await this.accountsOf(workspaceId)).find((entry) => entry.connectionId === connectionId)
        const spec = account === undefined ? null : providerSpecOf(account.provider)
        if (account === undefined || spec === null) return []
        const [refs, attachments] = await Promise.all([
            this.agents.activeOf(workspaceId, AGENTS_MAX),
            this.rows.listOfWorkspace(workspaceId),
        ])
        const attached = new Set(
            attachments.filter((row) => row.connectionId === connectionId).map((row) => row.agentId),
        )
        const served = new Map<string, boolean>()
        await eachInOrder([...new Set(refs.map((ref) => ref.module))], async (module) => {
            const lists = moduleProvidersOf(module).includes(spec.provider)
            served.set(module, lists && (await this.servedAccountsOf(workspaceId, module, [account])).length > 0)
        })
        return refs
            .filter((ref) => !attached.has(ref.id) && served.get(ref.module) === true)
            .map((ref) => ({ agentId: ref.id, agentName: ref.name, module: ref.module }))
    }

    /**
     * Attaches the listed agents to a working account by their template: only agents the template names for its provider and that
     * are not attached to it yet (`templateCandidates`); any other id is passed over. Answers the agents attached.
     */
    async attachByTemplate(
        workspaceId: string,
        connectionId: string,
        agentIds: ReadonlyArray<string>,
        updatedBy: string,
    ): Promise<TemplateAttachResult> {
        const account = (await this.accountsOf(workspaceId)).find((entry) => entry.connectionId === connectionId)
        const problem = this.accountProblem(account)
        if (account === undefined || problem !== null) return refused(problem ?? "unknown_account")
        const candidates = (await this.templateCandidates(workspaceId, connectionId)).filter((entry) =>
            agentIds.includes(entry.agentId),
        )
        const made = await this.rows.insertMissing(
            candidates.map((entry) => ({ workspaceId, connectionId, provider: account.provider, agentId: entry.agentId })),
            updatedBy,
        )
        return made.map((record) => record.agentId)
    }

    /**
     * The accounts of the workspace: every connection of a provider of the catalogue, oldest first within a provider; none in an app
     * that reads no connections.
     */
    private async accountsOf(workspaceId: string): Promise<ReadonlyArray<AccountView>> {
        const { connections } = this
        if (connections === undefined) return []
        const held = await Promise.all(
            PROVIDER_CATALOGUE.map(async (spec) => {
                const found = await connections.ofProvider(workspaceId, spec.provider, CONNECTIONS_MAX)
                return Promise.all(
                    found.map(async (connection) => {
                        const record = await connections.recordOf(workspaceId, connection.id)
                        return {
                            connectionId: connection.id,
                            provider: spec.provider,
                            label: accountLabelOf(spec.provider, connection.name, record?.meta ?? {}),
                            connected: connection.status === CONNECTED,
                        }
                    }),
                )
            }),
        )
        return held.flat()
    }

    /**
     * The accounts a module's agent may be proposed: every account, except that for a module that ships a TEMPLATE agent an OpenAPI
     * account is proposed only when nodes name it by a source the agent lists (`nodeProviderKeyOf`: the source its pinned document
     * serves, `crm`); one pinned to none, or to another source, serves none of its nodes.
     */
    private async servedAccountsOf<A extends AccountView>(
        workspaceId: string,
        moduleKey: string,
        accounts: ReadonlyArray<A>,
    ): Promise<ReadonlyArray<A>> {
        const agent = INSTALLED.templateAgentOf(moduleKey)
        if (agent === null || !accounts.some((account) => account.provider === OPENAPI_PROVIDER)) return accounts
        const keys = await nodeKeysOf(workspaceId, accounts, this.connections)
        return accounts.filter((account) => {
            if (account.provider !== OPENAPI_PROVIDER) return true
            const key = keyUnder(account, keys)
            return key !== null && key !== OPENAPI_PROVIDER && agent.accounts.some((listed) => listed === key)
        })
    }

    /** Why no agent can be attached to the account, or null when one can. */
    private accountProblem(account: AccountView | undefined): AttachmentRefusal | null {
        const spec = account === undefined ? null : providerSpecOf(account.provider)
        if (account === undefined || spec === null) return "unknown_account"
        if (spec.abilities.length === 0) return "no_ability"
        return account.connected ? null : "not_connected"
    }

    /** The wishes as attachments to store, or the refusal of the first that cannot be. */
    private async wished(
        workspaceId: string,
        wishes: ReadonlyArray<AttachmentWish>,
    ): Promise<ReadonlyArray<ProposedAttachment> | Refused> {
        const accounts = await this.accountsOf(workspaceId)
        const judged = wishes.map((wish): ProposedAttachment | AttachmentRefusal => {
            const account = accounts.find((entry) => entry.connectionId === wish.connectionId)
            const problem = this.accountProblem(account)
            if (account === undefined || problem !== null) return problem ?? "unknown_account"
            return { connectionId: wish.connectionId, provider: account.provider }
        })
        const problem = judged.find((entry): entry is AttachmentRefusal => typeof entry === "string")
        if (problem !== undefined) return refused(problem)
        return judged.filter((entry): entry is ProposedAttachment => typeof entry !== "string")
    }
}
