import type { GraphNodeAccount, GraphSpec } from "@nivo-lite/agent-sdk/graph"
import type { FlowGraphChip } from "@starci/grammar/common"
import type { AgentRightAccountView } from "@/modules/types"

/*
 * What a workflow step shows on its card, pure (rights.md): the providers it acts through, `accounts` (`[{ kind, provider, connectionId }]`,
 * in the order the ToolRunner tries them), read against the accounts the agent is attached to, as chips. What a shop SETS on a node (its
 * mode and its accounts) is read from `agentWorkflow.nodeSettings`, see workflowSettings.ts.
 */

/** The kind of an account whose chip on a step card says the step messages the customer instead of a provider name. */
const MESSAGING_KIND = "messaging"

/** The words the pure builders need, resolved by the hook that owns the catalog. */
export interface StepAccountsWords {
    /** The chip on a step card whose node acts through no provider. */
    readonly chipNoProvider: string
    readonly chipProvider: (account: string) => string
    readonly chipMessaging: (account: string) => string
}

/** The accounts a node asks for in the graph; undefined when the node states none (a node from before node rights). */
export const accountsOf = (spec: GraphSpec | null, nodeKey: string): ReadonlyArray<GraphNodeAccount> | undefined =>
    spec?.nodes.find((node) => node.key === nodeKey)?.accounts

/** The attached accounts an entry speaks for: the bound one, or every attached account of the entry's kind (and provider). */
const attachedOf = (
    entry: GraphNodeAccount,
    attached: ReadonlyArray<AgentRightAccountView>,
): ReadonlyArray<AgentRightAccountView> =>
    entry.connectionId === null
        ? attached.filter(
              (account) =>
                  account.kind === entry.kind && (entry.provider === null || account.provider === entry.provider),
          )
        : attached.filter((account) => account.connectionId === entry.connectionId)

/** What a step card shows of its accounts: one chip per provider the node acts through (the account's name, or the messaging chip), or the no-provider chip for an empty set. */
export const accountChipsOf = (
    spec: GraphSpec | null,
    nodeKey: string,
    attached: ReadonlyArray<AgentRightAccountView>,
    words: StepAccountsWords,
): ReadonlyArray<FlowGraphChip> => {
    const entries = accountsOf(spec, nodeKey)
    if (entries === undefined) return []
    if (entries.length === 0) return [{ label: words.chipNoProvider, tone: "neutral" }]
    return entries.map((entry): FlowGraphChip => {
        const name = attachedOf(entry, attached)[0]?.name ?? entry.provider ?? entry.kind
        return {
            label: entry.kind === MESSAGING_KIND ? words.chipMessaging(name) : words.chipProvider(name),
            tone: "neutral",
        }
    })
}
