import type { FlowGraphEdge, FlowGraphLegendItem, FlowGraphNode, FlowGraphRunStatus } from "@starci/grammar/common"
import type { NodeRightMode } from "./node-rights"

/** The card map of a workflow as `FlowGraph layout="steps"` draws it: the cards, the edges, the kind legend and the status words. */
export interface StepsMapView {
    readonly nodes: ReadonlyArray<FlowGraphNode>
    readonly edges: ReadonlyArray<FlowGraphEdge>
    readonly legend: ReadonlyArray<FlowGraphLegendItem>
    readonly statusLabels: Readonly<Record<FlowGraphRunStatus, string>>
}

/** One row of a fact the drawer explains: its label, its value and the muted line under it (empty for none). Read only, never a key. */
export interface StepFactRowView {
    readonly id: string
    readonly label: string
    readonly value: string
    readonly helper: string
}

/** One section of the explanation (a titled group of rows); a section with nothing to show is never built. */
export interface StepFactSectionView {
    /** Which fact it explains: `what`, `when`, `inputs`, `outputs`, `tools`, `exits`, `call`. */
    readonly id: string
    readonly title: string
    readonly rows: ReadonlyArray<StepFactRowView>
}

/**
 * One data param of a step as the drawer reads it: its words and type, and where its value comes from (a ref in words, "<step> →
 * <member>"), or the fixed value; an unbound one is `empty`.
 */
export interface StepBindingView {
    /** The param, or `inputs.<name>` / `outputs.<name>` for a hand-off's input or an outcome's output. */
    readonly name: string
    readonly label: string
    readonly typeLabel: string
    readonly kind: "ref" | "fixed" | "empty"
    /** The ref in words or the fixed value; empty when unbound. */
    readonly text: string
    /** Where a ref comes from in words, "<step> → <member>"; empty when it is no ref. */
    readonly source: string
}

/** The target of an end hand-off as the drawer reads it. */
export interface StepCallView {
    /** The agent and the workflow it calls, in words. */
    readonly targetLabel: string
    readonly versionLabel: string
}

/** One account a step could use, as `agentWorkflow.nodeSettings` answers it: the agent's attached account of a provider the step lists. */
export interface WorkflowNodeAccount {
    readonly connectionId: string
    /** The provider key; the words of it are resolved where the view is built, never drawn raw. */
    readonly provider: string
    readonly label: string
    /** The agent's default account for its provider. */
    readonly isDefault: boolean
    readonly sandbox: boolean
    /** False while the account does not work (detached, expired). */
    readonly connected: boolean
}

/**
 * What a step lets a shop set and what is in force, as the back end answers it (the one read of the settings of a node): `settable`
 * names the settings the step takes (`mode`, `accounts`), `mode` is the mode in force, `accountIds` the chosen accounts in the order
 * they are tried (empty: the agent's default), `accounts` the accounts the step could use.
 */
export interface WorkflowNodeSettings {
    readonly nodeKey: string
    readonly settable: ReadonlyArray<string>
    readonly mode: string | null
    readonly accountIds: ReadonlyArray<string>
    readonly accounts: ReadonlyArray<WorkflowNodeAccount>
}

/** One choice of the step's "how it runs" block: its word and the muted line that says what it does. */
export interface StepRunModeOptionView {
    readonly id: NodeRightMode
    readonly label: string
    readonly description: string
}

/**
 * The "how it runs" block of a node step's drawer (rights.md: ONE mode per node, `auto | ask`, set by the shop's owner on its own
 * workflow): the node's mode in force and the two choices, drawn only for a step whose `settable` has `mode`. Only the owner changes
 * it, each change at once writes the workflow's next version (`setAgentNodeSettings`); anybody else reads it as words.
 */
export interface StepRunModeView {
    readonly title: string
    /** The node's mode now. */
    readonly value: NodeRightMode
    readonly options: ReadonlyArray<StepRunModeOptionView>
    /** True for the owner of a workflow that can be written; false reads the mode as words. */
    readonly isEditable: boolean
    /** Said under the read-only mode when the reader is not the owner; empty otherwise. */
    readonly ownerNote: string
    /** The line that says runs in progress keep the old setting. */
    readonly keepNote: string
    /** True while the change is on its way. */
    readonly isPending: boolean
}

/** One account of the step's account choice as a row. */
export interface StepAccountChoiceView {
    /** The connection id. */
    readonly id: string
    readonly title: string
    /** The provider (in words) and, for a chosen account, its place in the order tried among the accounts of its provider. */
    readonly subtitle: string
    /** True where the agent's default account applies: a plain Badge at the end of the row. */
    readonly isDefault: boolean
    /** True for a sandbox account: a plain Badge at the end of the row. */
    readonly isSandbox: boolean
    /** Why the account cannot be chosen (not working); empty for one that can. */
    readonly unavailable: string
}

/** The account control of the open step: a choice among the accounts the step could use, drawn only for a step whose `settable` has `accounts`. */
export interface StepAccountsView {
    readonly sectionTitle: string
    readonly sectionHint: string
    /** The one 12 muted line that applies (no account attached, the default applies); empty for none. */
    readonly note: string
    readonly options: ReadonlyArray<StepAccountChoiceView>
    /** The connection ids the step uses, in the order they are tried. */
    readonly value: ReadonlyArray<string>
    readonly isReadOnly: boolean
}

/** The accounts section of the drawer: the view, whether a change is on its way, and the words of the two plain Badges. */
export interface StepAccountsPanelView {
    readonly view: StepAccountsView
    /** True while a change of the account choice is on its way. */
    readonly isPending: boolean
    readonly defaultLabel: string
    readonly sandboxLabel: string
}

/**
 * The drawer of one step: its title, the READ ONLY explanation of every fact (a workflow's graph is its template's), and the two things
 * a shop sets on a step when the step takes them: how it runs (`auto | ask`) and which accounts it uses.
 */
export interface StepDrawerView {
    readonly isOpen: boolean
    readonly title: string
    /** The step's description, shown first. */
    readonly description: string
    /** The facts, by section id; the drawer draws them in its own order. */
    readonly sections: ReadonlyArray<StepFactSectionView>
    readonly closeLabel: string
    /** True for the drawer of a run: the settings the run used, nothing to set. */
    readonly isReadOnly: boolean
    readonly readOnlyNote: string
    /** How a node step runs; null for the trigger, a control step and a run's drawer. */
    readonly runMode: StepRunModeView | null
    /** The accounts the step may use; absent where the step takes no account choice. */
    readonly accounts?: StepAccountsPanelView
}

/** What a person does with the step drawer: open a step, close it, choose how it runs, choose its accounts. */
export type StepAction =
    | { readonly kind: "open"; readonly nodeKey: string }
    | { readonly kind: "close" }
    /** The owner chose how the open node runs: writes the workflow's next version at once. */
    | { readonly kind: "node-mode"; readonly mode: NodeRightMode }
    /** The accounts the open step uses, as connection ids in the order they are tried. */
    | { readonly kind: "accounts"; readonly ids: ReadonlyArray<string> }
