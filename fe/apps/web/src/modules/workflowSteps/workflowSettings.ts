import type {
    NodeRightMode,
    StepAccountChoiceView,
    StepAccountsView,
    StepRunModeView,
    WorkflowNodeSettings,
} from "@/modules/types"

/*
 * What a shop sets on a step, pure: the back end answers per step what is settable (`mode`, `accounts`), what is in force and the
 * accounts the step could use (`agentWorkflow.nodeSettings`). A setting the step does not take is never drawn. A shop never edits a
 * graph; the mode and the account choice are the whole of what it sets on a node.
 */

/** The words of the two blocks, resolved by the hook that owns the catalogue. */
export interface StepSettingsWords {
    readonly runModeTitle: string
    readonly runModeAuto: string
    readonly runModeAutoNote: string
    readonly runModeAsk: string
    readonly runModeAskNote: string
    readonly runModeOwnerOnly: string
    readonly runModeKeep: string
    readonly accountsTitle: string
    readonly accountsHint: string
    /** The 12 muted line when the step lists a provider the agent has no account of. */
    readonly accountsNoneAttached: string
    /** The 12 muted line when nothing is chosen: the agent's default account applies. */
    readonly accountsDefaultApplies: string
    /** Why a not working account cannot be chosen. */
    readonly accountsNotWorking: string
    /** "Tried {position}": the place of a chosen account among the accounts of its provider. */
    readonly orderLine: (position: number) => string
    /** The provider in words, never the raw key. */
    readonly providerName: (provider: string) => string
}

/** What the caller knows of the person and the page. */
export interface StepSettingsContext {
    /** Only the shop's owner changes a setting. */
    readonly isOwner: boolean
    /** True for the drawer of a run, and for a page with no workflow to write: nothing to set. */
    readonly isFrozen: boolean
    readonly isPending: boolean
}

/** The settings of one step, or undefined when the back end names none (a step of a run's drawer, a flow without a workflow). */
export const settingsOfStep = (
    rows: ReadonlyArray<WorkflowNodeSettings> | undefined,
    nodeKey: string,
): WorkflowNodeSettings | undefined => rows?.find((row) => row.nodeKey === nodeKey)

const isMode = (value: string | null): value is NodeRightMode => value === "auto" || value === "ask"

/** The "how it runs" block, or null when the step does not take a mode. */
export const stepRunModeViewOf = (
    settings: WorkflowNodeSettings | undefined,
    words: StepSettingsWords,
    context: StepSettingsContext,
): StepRunModeView | null => {
    if (settings === undefined || !settings.settable.includes("mode") || !isMode(settings.mode)) return null
    return {
        title: words.runModeTitle,
        value: settings.mode,
        options: [
            { id: "auto", label: words.runModeAuto, description: words.runModeAutoNote },
            { id: "ask", label: words.runModeAsk, description: words.runModeAskNote },
        ],
        isEditable: context.isOwner && !context.isFrozen,
        ownerNote: context.isOwner ? "" : words.runModeOwnerOnly,
        keepNote: words.runModeKeep,
        isPending: context.isPending,
    }
}

/**
 * The account control of a step, or null when the step does not take an account choice. The accounts the step uses come first in
 * the order they are tried; the try order is per provider, so a chosen account says its place among the chosen accounts of its own
 * provider. A not working account is shown with its reason and cannot be chosen (one already chosen can still be taken off).
 */
export const stepAccountsViewOf = (
    settings: WorkflowNodeSettings | undefined,
    words: StepSettingsWords,
    context: StepSettingsContext,
): StepAccountsView | null => {
    if (settings === undefined) return null
    if (!settings.settable.includes("accounts")) return null
    const { accounts, accountIds } = settings
    const providerOf = (id: string): string | undefined => accounts.find((one) => one.connectionId === id)?.provider
    const placeOf = (id: string): number => {
        const index = accountIds.indexOf(id)
        const provider = providerOf(id)
        return index < 0 ? 0 : accountIds.slice(0, index + 1).filter((chosen) => providerOf(chosen) === provider).length
    }
    const ordered = [
        ...accountIds.flatMap((id) => accounts.filter((one) => one.connectionId === id)),
        ...accounts.filter((one) => !accountIds.includes(one.connectionId)),
    ]
    const options = ordered.map((account): StepAccountChoiceView => {
        const place = placeOf(account.connectionId)
        const isChosen = place > 0
        return {
            id: account.connectionId,
            title: account.label,
            subtitle: [
                words.providerName(account.provider),
                isChosen ? words.orderLine(place) : "",
                account.connected ? "" : words.accountsNotWorking,
            ]
                .filter((part) => part !== "")
                .join(" · "),
            isDefault: account.isDefault,
            isSandbox: account.sandbox,
            unavailable: account.connected || isChosen ? "" : words.accountsNotWorking,
        }
    })
    const note = (() => {
        if (accounts.length === 0) return words.accountsNoneAttached
        return accountIds.length === 0 ? words.accountsDefaultApplies : ""
    })()
    return {
        sectionTitle: words.accountsTitle,
        sectionHint: words.accountsHint,
        note,
        options,
        value: accountIds.filter((id) => accounts.some((one) => one.connectionId === id)),
        isReadOnly: !context.isOwner || context.isFrozen,
    }
}
