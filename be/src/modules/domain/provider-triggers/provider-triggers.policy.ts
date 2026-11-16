import { PROVIDER_TRIGGER_MEMBER, providerTriggerKeyOf } from "@nivo-lite/agent-sdk/graph"
import type { ProviderWake, TriggerRole, WakeContext } from "./provider-triggers.contracts"

/** What a tag of a trigger's wake says started it. */
export const PROVIDER_TRIGGER_TAG_SOURCE = "provider_trigger"

export { providerTriggerKeyOf }

/** The member of a wake's plain data that names the account the trigger fired on. */
const CONNECTION_MEMBER = "connectionId"

/** The member of a wake's plain data that names the agent's part: `decider` or `notice`. */
const ROLE_MEMBER = "role"

/** The plain data a trigger's wake hands the run: which trigger, on which account, the agent's part, and the params. */
export const wakeContextOf = (wake: ProviderWake, role: TriggerRole): WakeContext => ({
    ...wake.params,
    [PROVIDER_TRIGGER_MEMBER]: wake.providerTrigger,
    [CONNECTION_MEMBER]: wake.connectionId,
    [ROLE_MEMBER]: role,
})
