import type { DataSlot } from "./slot"

/** The words of the Sandbox page, resolved once by the connected half (the pure half holds no copy). */
export interface SandboxCopy {
    readonly title: string
    readonly description: string
    readonly openAction: string
    readonly cancelLabel: string
    /** The notice of a production environment: no sandbox exists there. */
    readonly offTitle: string
    readonly offBody: string
    /** The notice of a viewer who may not use the page. */
    readonly staffTitle: string
    readonly staffBody: string
    readonly failTitle: string
    readonly failBody: string
    readonly retryLabel: string
    readonly accounts: {
        readonly title: string
        readonly listLabel: string
        readonly badge: string
        readonly emptyTitle: string
        readonly emptyBody: string
    }
    /** The choice list of the width a next case is picked for (every call, or one purpose of the call log). */
    readonly scope: {
        readonly title: string
    }
    readonly cases: {
        readonly title: string
        readonly empty: string
        readonly sendLabel: string
        readonly pickLabel: string
        readonly defaultBadge: string
        readonly nextBadge: string
        readonly inputsLabel: string
        /** The title and the accessible name of the delivery switch; the words of each mode (the frame's `once`, `twice`, `withheld`, `late`). */
        readonly deliveryLabel: string
        readonly modes: Readonly<Record<string, string>>
        /** What the case says it is a name for: "Delivered {mode}". */
        readonly deliveryBadge: (mode: string) => string
        /** Why a case cannot be sent in the chosen mode (12, muted). */
        readonly modeBlocked: string
        /** The interval of `late`: its label, its unit picker's label, the words of each unit and the line that gives the bound. */
        readonly lateAmountLabel: string
        readonly lateUnitLabel: string
        readonly lateUnits: Readonly<Record<string, string>>
        readonly lateHint: string
        readonly errorTitle: string
    }
    /** The card that sets, per operation, the outcome of the account's next outbound calls. */
    readonly outcomes: {
        readonly title: string
        readonly hint: string
        readonly selectLabel: (operation: string) => string
        /** The words of each outcome (the frame's `ok`, `refused`, ...); an outcome without words is drawn as its key. */
        readonly names: Readonly<Record<string, string>>
        /** "Now: {outcome}. It stays until you change it." / "Now: case {id}, not an outcome." */
        readonly nowLine: (outcome: string) => string
        readonly nowCaseLine: (caseId: string) => string
        readonly backLabel: string
        readonly placeholder: string
    }
    readonly calls: {
        readonly title: string
        readonly empty: string
        readonly moreLabel: string
        readonly clearLabel: string
        readonly failedBadge: string
        readonly errorTitle: string
        readonly clearTitle: string
        readonly clearBody: string
        readonly clearConfirm: string
    }
    readonly webhookKey: {
        readonly title: string
        readonly hint: string
        readonly revealLabel: string
        readonly hideLabel: string
        readonly copyLabel: string
        readonly errorTitle: string
    }
    readonly waiting: {
        readonly title: string
        readonly empty: string
        readonly expireLabel: string
        readonly errorTitle: string
        /** "{time} left": the copy around the countdown, with its {time}. */
        readonly leftTemplate: string
        /** What the countdown says once the wait is due. */
        readonly dueLabel: string
    }
    readonly open: {
        readonly title: string
        readonly hint: string
        readonly providerLabel: string
        readonly nameLabel: string
        readonly submitLabel: string
        /** The label over the choice list of the agents the new account is given to. */
        readonly agentsLabel: string
    }
    readonly agents: {
        readonly title: string
        readonly empty: string
        readonly attachLabel: string
        readonly detachLabel: string
        readonly makeDefaultLabel: string
        readonly defaultBadge: string
        readonly errorTitle: string
        readonly detachTitle: string
        readonly detachBody: string
        readonly detachConfirm: string
    }
    readonly attach: {
        readonly title: string
        readonly hint: string
        readonly agentsLabel: string
        readonly empty: string
        readonly submitLabel: string
    }
}

/** One sandbox account as a row of the left rail. */
export interface SandboxAccountRowView {
    readonly id: string
    readonly name: string
    /** The mark of the provider; null when the app has none (the glyph is drawn instead). */
    readonly logo: string | null
    /** The agents the account is attached to, as one muted line ("Chatbot, Sales"); the words for none when it has none. */
    readonly agentsLine: string
}

/** The accounts of one provider: its name over its rows. */
export interface SandboxAccountGroupView {
    readonly provider: string
    readonly label: string
    readonly rows: ReadonlyArray<SandboxAccountRowView>
}

/** The sandbox accounts of the workspace, grouped by provider. */
export interface SandboxAccountsData {
    readonly groups: ReadonlyArray<SandboxAccountGroupView>
    readonly count: number
    /** The account the right column shows. */
    readonly selectedId: string
}

/** One agent the open account is attached to. */
export interface SandboxAgentRowView {
    readonly id: string
    readonly name: string
    /** The account is the agent's default among its accounts of this provider (shown only where it holds several). */
    readonly isDefault: boolean
    /** The agent holds several accounts of this provider and this one is not its default: the owner may make it so. */
    readonly canSetDefault: boolean
}

/** The agents block of the open account. */
export interface SandboxAgentsData {
    readonly rows: ReadonlyArray<SandboxAgentRowView>
}

/** One agent the owner may choose in a drawer. */
export interface SandboxAgentChoice {
    readonly id: string
    readonly label: string
}

/** One case of the open account's provider. */
export interface SandboxCaseRowView {
    readonly id: string
    readonly label: string
    readonly direction: "inbound" | "outbound"
    /** What the provider is asked for; null for an inbound case. */
    readonly operation: string | null
    readonly isDefault: boolean
    /** An outbound case the account answers next. */
    readonly isNext: boolean
    /** The mode an inbound case is a name for (`twice`, `late`); null when it is delivered once. */
    readonly delivery: string | null
    /** The delivery modes the case allows (inbound only; none for an outbound case). */
    readonly modes: ReadonlyArray<string>
}

/** One outbound operation whose next outcome the page sets. */
export interface SandboxOutcomeRowView {
    readonly operation: string
    /** The outcomes its cases are tagged with, in the frame's order: what the picker offers. */
    readonly options: ReadonlyArray<string>
    /** The outcome it answers now; null when the next case carries no generic outcome. */
    readonly current: string | null
    /** The case it answers now. */
    readonly caseId: string | null
}

/** The outcomes block of the open account: one row per operation that offers a choice. */
export interface SandboxOutcomesData {
    readonly rows: ReadonlyArray<SandboxOutcomeRowView>
}

/** One input an inbound case takes, with the value the form holds. */
export interface SandboxInputView {
    readonly name: string
    readonly label: string
    /** The example the case ships with, shown while the field is empty. */
    readonly placeholder: string
    readonly value: string
}

/** One width a next case may be picked for: every call, or one purpose seen in the call log. */
export interface SandboxScopeChoiceView {
    readonly id: string
    /** What it is in words, never the raw key alone. */
    readonly label: string
    /** The explanation of the choice (12, muted): for a generic purpose, its key; null when there is none. */
    readonly hint: string | null
}

/** The widths a next case may be picked for on the open account and the one chosen. */
export interface SandboxScopeView {
    readonly choices: ReadonlyArray<SandboxScopeChoiceView>
    readonly selectedId: string
}

/** The cases block of the open account. */
export interface SandboxCasesData {
    readonly rows: ReadonlyArray<SandboxCaseRowView>
    readonly fields: ReadonlyArray<SandboxInputView>
    /** The delivery modes the cases offer (the switch in the header zone); none when no case is inbound. */
    readonly modeChoices: ReadonlyArray<string>
    /** The mode the next send uses. */
    readonly mode: string
    /** The interval of `late`, as the person set it. */
    readonly lateAmount: number
    readonly lateUnit: string
    /** "Latest request: ..." (12, muted); null when the agent has asked for nothing yet. */
    readonly latestLine: string | null
    /** One line per outbound operation with the case it answers next. */
    readonly nextLines: ReadonlyArray<string>
    /** The widths a next case may be picked for (the model account only); null for every other account. */
    readonly scope: SandboxScopeView | null
}

/** One line of the call log. */
export interface SandboxCallRowView {
    readonly id: string
    readonly title: string
    /** The case or key, the time and, when the call threw, why (12, muted). */
    readonly line: string
    readonly isFailed: boolean
}

/** The call log of the open account, newest first, bounded to what is drawn. */
export interface SandboxCallsData {
    readonly rows: ReadonlyArray<SandboxCallRowView>
    readonly hasMore: boolean
}

/** One run parked at a wait. */
export interface SandboxWaitingRowView {
    readonly runId: string
    /** "<agent> · <person or route>". */
    readonly title: string
    /** What it waits for (12, muted); the time left follows it. */
    readonly what: string
    /** When the wait ends (an RFC 3339 moment): the card counts down to it. */
    readonly dueAt: string
}

/** The drawer that opens a sandbox account. */
export interface SandboxOpenView {
    readonly isOpen: boolean
    readonly isPending: boolean
    readonly providers: DataSlot<ReadonlyArray<{ readonly id: string; readonly label: string }>>
    readonly provider: string | null
    readonly name: string
    /** The agents the account is read for (a choice list); read while the drawer is open. */
    readonly agents: DataSlot<ReadonlyArray<SandboxAgentChoice>>
    /** The agents chosen to receive the new account. */
    readonly agentIds: ReadonlyArray<string>
}

/** The drawer that gives the open account to more agents. */
export interface SandboxAttachView {
    readonly isOpen: boolean
    readonly isPending: boolean
    /** The agents the account is not attached to yet. */
    readonly agents: DataSlot<ReadonlyArray<SandboxAgentChoice>>
    readonly agentIds: ReadonlyArray<string>
}

/** The agent whose detach the owner is asked to confirm. */
export interface SandboxDetachAsk {
    readonly agentId: string
    readonly name: string
}

/** What is running now, so only its own control shows pending. */
export interface SandboxPendingView {
    /** The inbound case being sent. */
    readonly sendingId: string | null
    /** The outbound case being chosen. */
    readonly choosingId: string | null
    /** The operation whose outcome is being set. */
    readonly outcomeOperation: string | null
    /** The run whose wait is being ended. */
    readonly expiringId: string | null
    readonly isClearing: boolean
    readonly isCopying: boolean
    /** The agent being taken off the account. */
    readonly detachingId: string | null
    /** The agent being made default. */
    readonly defaultingId: string | null
}

/** The key block of the open account: hidden until the owner asks to see it. */
export interface SandboxKeyView {
    readonly isRevealed: boolean
    /** The key, read for the copy button; it is drawn only while revealed. */
    readonly value: DataSlot<string>
}

/** Which body the page draws: the notice of a viewer or an environment, or the sandbox itself. */
export type SandboxGate = "checking" | "failed" | "staff" | "off" | "on"

/** What the Sandbox page draws and does. */
export interface SandboxPanesBaseProps {
    readonly props: {
        readonly copy: SandboxCopy
        /** The reader's language, for the countdown of a wait. */
        readonly locale: string
        readonly gate: SandboxGate
        readonly accounts: DataSlot<SandboxAccountsData>
        readonly agents: DataSlot<SandboxAgentsData>
        readonly attach: SandboxAttachView
        /** The question before an agent is taken off the account; null when none is asked. */
        readonly detachAsk: SandboxDetachAsk | null
        readonly cases: DataSlot<SandboxCasesData>
        readonly outcomes: DataSlot<SandboxOutcomesData>
        readonly calls: DataSlot<SandboxCallsData>
        readonly webhookKey: SandboxKeyView
        readonly waiting: DataSlot<ReadonlyArray<SandboxWaitingRowView>>
        readonly open: SandboxOpenView
        readonly pending: SandboxPendingView
        /** The question before the call log is cleared. */
        readonly isClearAsked: boolean
    }
    readonly on: {
        readonly retryGate: () => void
        readonly retryAccounts: () => void
        readonly retryCases: () => void
        readonly retryCalls: () => void
        readonly retryKey: () => void
        readonly retryWaiting: () => void
        readonly retryProviders: () => void
        readonly retryAgents: () => void
        readonly chooseAgents: (agentIds: ReadonlyArray<string>) => void
        readonly openAttach: () => void
        readonly closeAttach: () => void
        readonly chooseAttach: (agentIds: ReadonlyArray<string>) => void
        readonly submitAttach: () => void
        readonly askDetach: (agentId: string) => void
        readonly cancelDetach: () => void
        readonly acceptDetach: () => void
        readonly setDefault: (agentId: string) => void
        readonly select: (accountId: string) => void
        readonly openDrawer: () => void
        readonly closeDrawer: () => void
        readonly chooseProvider: (provider: string) => void
        readonly setName: (value: string) => void
        readonly submitOpen: () => void
        readonly setInput: (name: string, value: string) => void
        readonly setMode: (mode: string) => void
        readonly setLateAmount: (amount: number) => void
        readonly setLateUnit: (unit: string) => void
        readonly send: (caseId: string) => void
        readonly choose: (caseId: string) => void
        /** Sets the outcome of the next outbound calls of an operation (sticky); `ok` takes it back to the default. */
        readonly setOutcome: (operation: string, outcome: string) => void
        /** Picks the width the next case applies to: `*` for every call, else a purpose of the call log. */
        readonly chooseScope: (scopeId: string) => void
        readonly moreCalls: () => void
        readonly askClear: () => void
        readonly cancelClear: () => void
        readonly acceptClear: () => void
        readonly revealKey: () => void
        readonly hideKey: () => void
        readonly copyKey: () => void
        readonly expire: (runId: string) => void
    }
}
