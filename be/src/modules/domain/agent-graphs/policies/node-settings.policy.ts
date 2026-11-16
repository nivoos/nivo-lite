import type { GraphNodeAccount, GraphNodeAccountMode, GraphSpec, GraphSpecNode, GraphSpecV2 } from "@nivo-lite/agent-sdk/graph"
import { AgentGraphsError, AgentGraphsErrorCode } from "../errors/agent-graphs.error"
import { workflowRefused } from "./workflow-view.policy"

/*
 * NODE SETTINGS (nivo-frame `templates` + `rights`, owner ruling R89): a stored workflow graph is EXACTLY an installed template version,
 * except for what the shop SETS on a node step of its copy. That set is closed and typed: the ONE list below. Each member says on which
 * template step it is settable, how a copy's value is cleared back to the template's (what the copy check ignores), what it lays over
 * the template graph before the package's own checks judge it, and how a value is read and written. Every road reads the same list: the
 * copy check (`flow.policy` `isCopyOf` / `withSettingsOf`), the settings door, and the workflow read. Settings live ON the stored node
 * (versioned: a change writes the workflow's next version, runs in flight keep theirs).
 */

/** The members of a node step a shop sets. */
export type NodeSettingKey = "mode" | "accounts"

/** A node step's mode (`GraphSpecNode.mode`). */
export type NodeSettingMode = GraphNodeAccountMode

/** One account a shop chose for a step, under the provider key the node names it by. */
export interface ChosenAccount {
    /** The provider as the node's entries name it (an OpenAPI account by its source key, `crm`). */
    readonly provider: string
    /** The connected account. */
    readonly connectionId: string
}

/** The settings in force on one node step. */
export interface NodeSettings {
    /** The node's ONE mode, or null on a step that states none (a control step of the engine). */
    readonly mode: NodeSettingMode | null
    /** The accounts the shop chose, in try order (per provider, providers in the node's order); empty: the default pick. */
    readonly accounts: ReadonlyArray<string>
}

/** What a settings change asks: each member absent is left as it is; `accounts: []` goes back to the default pick. */
export interface NodeSettingsChange {
    readonly mode?: NodeSettingMode | undefined
    readonly accounts?: ReadonlyArray<ChosenAccount> | undefined
}

/** A template node step of the V2 graph the package's checks judge. */
type V2Step = GraphSpecV2["nodes"][number]

/** One member of the list: where it is settable, how it is cleared, laid over, read and written. */
interface NodeSetting {
    readonly key: NodeSettingKey
    /** True when a step of this shape takes the member (read on the template's step; a copy keeps that shape). */
    readonly settableOn: (node: GraphSpecNode) => boolean
    /** The node with the member as a template states it (what the copy check ignores). */
    readonly cleared: (node: GraphSpecNode) => GraphSpecNode
    /** The template step with the copy's value laid over it, for the package's checks; the step itself when they judge nothing of it. */
    readonly layOver: (step: V2Step, copy: GraphSpecNode) => V2Step
}

/** True for a word that is one node mode. */
const isMode = (mode: unknown): mode is NodeSettingMode => mode === "auto" || mode === "ask"

/** An account entry as a template states it: no connection bound. */
const entryCleared = (entry: GraphNodeAccount): GraphNodeAccount => ({ ...entry, connectionId: null })

/** Two entries the template states the same way (`entryCleared`). */
const sameEntry = (left: GraphNodeAccount, right: GraphNodeAccount): boolean =>
    left.kind === right.kind &&
    left.provider === right.provider &&
    JSON.stringify(left.operations ?? null) === JSON.stringify(right.operations ?? null)

/**
 * A node's account entries as the template states them: every connection cleared and the entries a choice split one template entry
 * into (one per chosen account, `withAccountChoice`) folded back into it. A template never lists one entry twice (`NODE_ACCOUNT_DUPLICATE`).
 */
const entriesCleared = (entries: ReadonlyArray<GraphNodeAccount>): ReadonlyArray<GraphNodeAccount> =>
    entries
        .map(entryCleared)
        .filter((entry, at, all) => {
            const before = all[at - 1]
            return before === undefined || !sameEntry(before, entry)
        })

/** True for a step the shop sets anything on: a node step that states its mode (control steps of the engine state none). */
const isNodeStep = (node: GraphSpecNode): boolean => node.mode !== undefined

/** The account entries a choice can bind: an entry that names its provider (an entry for any provider of a kind binds none). */
const choosableEntries = (node: GraphSpecNode): ReadonlyArray<GraphNodeAccount> =>
    (node.accounts ?? []).filter((entry) => entry.provider !== null)

/** THE ONE LIST of node settings. */
const NODE_SETTINGS: ReadonlyArray<NodeSetting> = [
    {
        key: "mode",
        settableOn: isNodeStep,
        cleared: (node) => (isMode(node.mode) ? { ...node, mode: undefined } : node),
        layOver: (step, copy) => (step.kind === "node" && isMode(copy.mode) ? { ...step, mode: copy.mode } : step),
    },
    {
        key: "accounts",
        settableOn: (node) => isNodeStep(node) && choosableEntries(node).length > 0,
        cleared: (node) => (node.accounts === undefined ? node : { ...node, accounts: entriesCleared(node.accounts) }),
        // The package's checks read the providers a step lists, never a connection: the choice is the engine's to judge (the door).
        layOver: (step) => step,
    },
]

/** The settings a step takes, in the list's order (none on the trigger, a control step, a wait). */
export const settableOf = (node: GraphSpecNode): ReadonlyArray<NodeSettingKey> =>
    NODE_SETTINGS.filter((setting) => setting.settableOn(node)).map((setting) => setting.key)

/** The graph with every setting of the steps that take it (`settableOf` of the `template`'s step) cleared back to the template's. */
export const withSettingsCleared = (template: GraphSpec, graph: GraphSpec): GraphSpec => {
    const settable = new Map(template.nodes.map((node) => [node.key, NODE_SETTINGS.filter((setting) => setting.settableOn(node))]))
    return {
        ...graph,
        nodes: graph.nodes.map((node) =>
            (settable.get(node.key) ?? []).reduce((cleared, setting) => setting.cleared(cleared), node),
        ),
    }
}

/** The template graph with the settings of its stored copy laid over it, for the package's checks (a step with no copy is left). */
export const withSettingsLaid = (spec: GraphSpecV2, copy: GraphSpec): GraphSpecV2 => {
    const copied = new Map(copy.nodes.map((node) => [node.key, node]))
    const [first, ...rest] = spec.nodes.map((step) => {
        const node = copied.get(step.key)
        return node === undefined ? step : NODE_SETTINGS.reduce((laid, setting) => setting.layOver(laid, node), step)
    })
    return first === undefined ? spec : { ...spec, nodes: [first, ...rest] }
}

/** The settings in force on a stored node step: its mode and the accounts chosen on its entries, in order. */
export const settingsOf = (node: GraphSpecNode): NodeSettings => ({
    mode: isMode(node.mode) ? node.mode : null,
    accounts: (node.accounts ?? []).flatMap((entry) => (entry.connectionId === null ? [] : [entry.connectionId])),
})

/**
 * A node's entries with the shop's choice bound: each entry naming a provider becomes one entry per chosen account of that provider, in
 * the choice's order (the template's kind and provider kept, the connection set); an entry with no chosen account stays as the template
 * states it (the default pick). The providers stay in the node's order. Pure.
 */
const withAccountChoice = (
    entries: ReadonlyArray<GraphNodeAccount>,
    chosen: ReadonlyArray<ChosenAccount>,
): ReadonlyArray<GraphNodeAccount> =>
    entriesCleared(entries).flatMap((entry): ReadonlyArray<GraphNodeAccount> => {
        const own = entry.provider === null ? [] : chosen.filter((account) => account.provider === entry.provider)
        return own.length === 0 ? [entry] : own.map((account) => ({ ...entry, connectionId: account.connectionId }))
    })

/**
 * The running graph with ONE node step's settings changed (the door's write), or null when nothing changes (nothing to write). Refused,
 * typed: a key no step has (`node`); a member the step does not take (`AGENT_GRAPHS_NODE_SETTING_UNSETTABLE`, thrown by the caller's
 * `unsettable`). Every other judgement (which accounts may be chosen) is the door's, before this. Pure.
 */
export const graphWithNodeSettings = (
    graph: GraphSpec,
    nodeKey: string,
    change: NodeSettingsChange,
    unsettable: (key: NodeSettingKey) => Error,
): GraphSpec | null => {
    const node = graph.nodes.find((one) => one.key === nodeKey)
    if (node === undefined) throw workflowRefused("node")
    const takes = settableOf(node)
    const asked: ReadonlyArray<NodeSettingKey> = [
        ...(change.mode === undefined ? [] : ["mode" as const]),
        ...(change.accounts === undefined ? [] : ["accounts" as const]),
    ]
    const refused = asked.find((key) => !takes.includes(key))
    if (refused !== undefined) throw unsettable(refused)
    const changed: GraphSpecNode = {
        ...node,
        ...(change.mode === undefined ? {} : { mode: change.mode }),
        ...(change.accounts === undefined ? {} : { accounts: withAccountChoice(node.accounts ?? [], change.accounts) }),
    }
    if (JSON.stringify(changed) === JSON.stringify(node)) return null
    return { ...graph, nodes: graph.nodes.map((one) => (one.key === nodeKey ? changed : one)) }
}

/** One of the agent's attached accounts as a choice reads it: the provider nodes name it by, and the facts the rule judges. */
export interface AccountCandidate {
    /** The connected account. */
    readonly connectionId: string
    /** The provider as nodes name it (an OpenAPI account by its source key). */
    readonly provider: string
    /** True when the connection works (`connected`). */
    readonly connected: boolean
    /** True for a sandbox account. */
    readonly sandbox: boolean
}

/** The providers a step's entries name, in the node's order, each once. */
const listedProvidersOf = (node: GraphSpecNode): ReadonlyArray<string> => [
    ...new Set(choosableEntries(node).flatMap((entry) => (entry.provider === null ? [] : [entry.provider]))),
]

/** The agent's accounts a step could use: those of a provider its entries name, in the node's order of providers. */
export const candidatesOf = <C extends AccountCandidate>(node: GraphSpecNode, attached: ReadonlyArray<C>): ReadonlyArray<C> =>
    listedProvidersOf(node).flatMap((provider) => attached.filter((account) => account.provider === provider))

const refusal = (code: AgentGraphsErrorCode, connectionId: string, provider?: string): AgentGraphsError =>
    new AgentGraphsError({ code, params: { connectionId, ...(provider === undefined ? {} : { provider }) } })

/**
 * THE RULE of an account choice on a step (judged, never trusted): each chosen account must be ATTACHED to the agent
 * (`NODE_ACCOUNT_NOT_ATTACHED`), working (`NODE_ACCOUNT_NOT_CONNECTED`), of a provider the step lists (`NODE_ACCOUNT_NOT_LISTED`),
 * a sandbox account only while the sandbox is on (`NODE_ACCOUNT_SANDBOX_OFF`), and named once (`NODE_ACCOUNT_REPEATED`); the first
 * refusal in the choice's order is thrown. An empty choice is always taken: the step goes back to the default pick. Answers the chosen
 * accounts in the choice's order under the provider the node names. Pure.
 */
export const judgedAccountChoice = (
    node: GraphSpecNode,
    wanted: ReadonlyArray<string>,
    attached: ReadonlyArray<AccountCandidate>,
    sandboxOn: boolean,
): ReadonlyArray<ChosenAccount> => {
    const listed = new Set(listedProvidersOf(node))
    return wanted.map((connectionId, at): ChosenAccount => {
        if (wanted.indexOf(connectionId) !== at) throw refusal(AgentGraphsErrorCode.NodeAccountRepeated, connectionId)
        const account = attached.find((one) => one.connectionId === connectionId)
        if (account === undefined) throw refusal(AgentGraphsErrorCode.NodeAccountNotAttached, connectionId)
        if (!listed.has(account.provider))
            throw refusal(AgentGraphsErrorCode.NodeAccountNotListed, connectionId, account.provider)
        if (!account.connected) throw refusal(AgentGraphsErrorCode.NodeAccountNotConnected, connectionId)
        if (account.sandbox && !sandboxOn) throw refusal(AgentGraphsErrorCode.NodeAccountSandboxOff, connectionId)
        return { provider: account.provider, connectionId }
    })
}

/** The typed refusal of a setting the step does not take. */
export const unsettableRefusal = (setting: NodeSettingKey): AgentGraphsError =>
    new AgentGraphsError({ code: AgentGraphsErrorCode.NodeSettingUnsettable, params: { setting } })

/** One account a step could use, as the workflow read shows it. */
export interface NodeAccountOption extends AccountCandidate {
    /** The account's label (a bank account by its bank and masked number, else the name the owner gave it). */
    readonly label: string
    /** True when it is the agent's default account of its provider. */
    readonly isDefault: boolean
}

/** One step's settings as the workflow read shows them. */
export interface NodeSettingsView {
    /** The step. */
    readonly nodeKey: string
    /** What the shop may set on it, in the list's order; empty: nothing (the trigger, a wait, a control step). */
    readonly settable: ReadonlyArray<NodeSettingKey>
    /** The mode in force, or null on a step that states none. */
    readonly mode: NodeSettingMode | null
    /** The accounts chosen, in try order; empty: the default pick. */
    readonly accountIds: ReadonlyArray<string>
    /** The agent's attached accounts this step could use (of a provider it lists), in the node's order of providers; empty where it takes no account. */
    readonly accounts: ReadonlyArray<NodeAccountOption>
}

/** Every step of a graph with its settings, what is settable on it and the accounts it could use (`attached`: the agent's). Pure. */
export const nodeSettingsViewsOf = (graph: GraphSpec, attached: ReadonlyArray<NodeAccountOption>): ReadonlyArray<NodeSettingsView> =>
    graph.nodes.map((node) => {
        const settable = settableOf(node)
        const settings = settingsOf(node)
        return {
            nodeKey: node.key,
            settable,
            mode: settings.mode,
            accountIds: settings.accounts,
            accounts: settable.includes("accounts") ? candidatesOf(node, attached) : [],
        }
    })
