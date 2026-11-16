import type { OptionalAgentId } from "./provider-triggers.contracts"
import type { TriggerWays, TriggerWithoutPoll, TriggerWords } from "./trigger-declaration.contracts"

/** The person who reads or changes the triggers of an account, in the workspace the request is made in. */
export interface TriggerActor {
    /** The signed-in person. */
    readonly principalId: string
    /** The workspace of the request. */
    readonly workspaceId: string
}

/** An agent the owner may bind as the decider of a trigger. */
export interface TriggerAgentChoice {
    /** The agent. */
    readonly agentId: string
    /** Its name. */
    readonly name: string
}

/**
 * One trigger of one account as its provider page draws it: the switch, who decides on its events and, where the owner may bind a
 * decider, the agents a binding may name.
 */
export interface ProviderTriggerState {
    /** The account. */
    readonly connectionId: string
    /** The trigger name inside the provider (`transaction.received`). */
    readonly name: string
    /** EVERY way the trigger is received (`webhook`, `poll`, `clock`, `internal`): the owner reads "received by: webhook, poll". */
    readonly via: TriggerWays
    /** For a trigger no poll receives: why a missed event loses nothing (the reason in the owner's two languages, and where it is stated); null when a poll receives it. */
    readonly withoutPoll: TriggerWithoutPoll | null
    /** Its short title `<source> · <event>`, in the owner's two languages, as the declaration words it. */
    readonly title: TriggerWords
    /** What it is, in the owner's two languages, as the declaration words it. */
    readonly summary: TriggerWords
    /** Whether the switch is on. */
    readonly enabled: boolean
    /** Since when it is on, ISO 8601; null when off. */
    readonly enabledAt: string | null
    /** When it last handed an event on, ISO 8601, or null. */
    readonly lastFiredAt: string | null
    /** How many events it handed on. */
    readonly firedCount: number
    /** True when one agent decides on its events and every other registered one is only told. */
    readonly decided: boolean
    /** The agent that decides now (the core agent while it is bound, else the one the owner bound), or null. */
    readonly deciderAgentId: OptionalAgentId
    /** That agent's name, or null when there is none or the directory does not know it. */
    readonly deciderAgentName: string | null
    /** True while the provider's own core path hands the account's events to an agent: no other agent can be bound then. */
    readonly coreDecides: boolean
    /** True when a switch turned on again may catch up on the events it missed (a poll also receives the trigger). */
    readonly canCatchUp: boolean
    /** The agents a binding may name: attached to the account, and only where the trigger is decided and no core agent decides. */
    readonly deciderChoices: ReadonlyArray<TriggerAgentChoice>
}

/** Turning the switch of an account's trigger on or off. */
export interface TriggerSwitchChange {
    /** The account. */
    readonly connectionId: string
    /** The trigger name. */
    readonly trigger: string
    /** On or off. */
    readonly enabled: boolean
    /** Turning on: catch up on what was missed instead of starting from now; taken only where the trigger can catch up. */
    readonly catchUp: boolean
}

/** Binding the decider of an account's trigger, or unbinding it. */
export interface TriggerDeciderChange {
    /** The account. */
    readonly connectionId: string
    /** The trigger name. */
    readonly trigger: string
    /** The agent to bind; null or absent unbinds. */
    readonly agentId?: OptionalAgentId | undefined
}
