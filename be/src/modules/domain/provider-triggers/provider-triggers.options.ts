import type { Type } from "@nestjs/common"
import type { ProviderTriggerAgentNames } from "./provider-triggers.contracts"

/** The classes behind the ports of the other lanes. */
export interface ProviderTriggersPorts {
    /** Implements the agent names port; an existing provider of the app that injects nothing of this capability. */
    readonly agentNames: Type<ProviderTriggerAgentNames>
}

/** The options of the provider-triggers capability: the ports the app root binds; absent in an app that composes no agents. */
export interface ProviderTriggersOptions {
    /** The classes behind the ports; absent: every agent name reads null. */
    readonly ports?: ProviderTriggersPorts | undefined
    /**
     * True in an app that composes no agent work (the cli: the seed reads and turns the switches): the switches, the states and the
     * delivery service only, without the re-offer door (`DeliveredWakesService`), whose wake rows belong to the agent work the app lacks.
     */
    readonly switchesOnly?: boolean | undefined
}
