import { ProviderTriggersErrorCode } from "./errors/provider-triggers.error"
import type { ProviderTriggerState, TriggerAgentChoice } from "./provider-trigger-states.contracts"
import type { OptionalAgentId, TriggerChangeRefusal, TriggerSwitchView } from "./provider-triggers.contracts"
import { canCatchUpOf, triggerDeciderOf, type SwitchedDeclaration } from "./trigger-declarations.policy"

/** The code each refusal of a change travels as. */
export const REFUSAL_CODES: Record<TriggerChangeRefusal, ProviderTriggersErrorCode> = {
    undeclared: ProviderTriggersErrorCode.Undeclared,
    unknown_account: ProviderTriggersErrorCode.UnknownAccount,
    not_decided: ProviderTriggersErrorCode.NotDecided,
    core_decides: ProviderTriggersErrorCode.CoreDecides,
    not_attached: ProviderTriggersErrorCode.NotAttached,
}

/** What the states of one account's triggers are joined from. */
export interface TriggerStateFacts {
    /** The account. */
    readonly connectionId: string
    /** The triggers of its provider (and of a half it holds) that carry a switch, in registration order. */
    readonly declared: ReadonlyArray<SwitchedDeclaration>
    /** The switches of the account, one per declared trigger. */
    readonly switches: ReadonlyArray<TriggerSwitchView>
    /** The agent the provider's core path hands each trigger's events to, by trigger name; absent or null where none. */
    readonly coreDeciders: Readonly<Record<string, OptionalAgentId>>
    /** The agents attached to the account, in a stable order. */
    readonly attached: ReadonlyArray<string>
    /** The names of the agents the directory knows, by id. */
    readonly names: ReadonlyMap<string, string>
}

/** The attached agents the directory knows, with their names, in the attachment order. */
const choicesOf = (attached: ReadonlyArray<string>, names: ReadonlyMap<string, string>): ReadonlyArray<TriggerAgentChoice> =>
    attached.flatMap((agentId) => {
        const name = names.get(agentId)
        return name === undefined ? [] : [{ agentId, name }]
    })

/** One trigger's state: its switch (off where the owner never touched it), its decider and the lawful choices of a binding. */
const stateOf = (facts: TriggerStateFacts, declaration: SwitchedDeclaration): ProviderTriggerState => {
    const held = facts.switches.find((entry) => entry.name === declaration.name)
    const core = facts.coreDeciders[declaration.name] ?? null
    const decider = triggerDeciderOf(declaration, core, held?.deciderAgentId ?? null)
    const coreDecides = declaration.switch.decided && core !== null
    return {
        connectionId: facts.connectionId,
        name: declaration.name,
        via: declaration.via,
        withoutPoll: declaration.withoutPoll ?? null,
        title: { vi: declaration.words.title.vi, en: declaration.words.title.en },
        summary: { vi: declaration.words.summary.vi, en: declaration.words.summary.en },
        enabled: held?.enabled === true,
        enabledAt: held?.enabledAt ?? null,
        lastFiredAt: held?.lastFiredAt ?? null,
        firedCount: held?.firedCount ?? 0,
        decided: declaration.switch.decided,
        deciderAgentId: decider,
        deciderAgentName: decider === null ? null : (facts.names.get(decider) ?? null),
        coreDecides,
        canCatchUp: canCatchUpOf(declaration),
        deciderChoices: declaration.switch.decided && !coreDecides ? choicesOf(facts.attached, facts.names) : [],
    }
}

/** The states of an account's triggers, one per trigger its provider declares with a switch, in registration order. */
export const triggerStatesOf = (facts: TriggerStateFacts): ReadonlyArray<ProviderTriggerState> =>
    facts.declared.map((declaration) => stateOf(facts, declaration))

/** The agents a state may name: the core and the bound deciders and the attached agents, each once. */
export const namedAgentsOf = (facts: Omit<TriggerStateFacts, "names" | "declared" | "connectionId">): ReadonlyArray<string> => {
    const named: ReadonlyArray<OptionalAgentId> = [
        ...Object.values(facts.coreDeciders),
        ...facts.switches.map((entry) => entry.deciderAgentId),
        ...facts.attached,
    ]
    return [...new Set(named.filter((agentId): agentId is string => agentId !== null))]
}
