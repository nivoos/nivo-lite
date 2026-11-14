import { Field, ID, ObjectType } from "@nestjs/graphql"

@ObjectType()
/** One of the agent's attached accounts a step could use. */
export class AgentWorkflowNodeAccountType {
    /** The connected account. */
    @Field(() => ID)
    connectionId!: string

    /** The provider as the step names it (an OpenAPI account by its source key). */
    @Field(() => String)
    provider!: string

    /** The account's label (a bank account by its bank and masked number, else the name the owner gave it). */
    @Field(() => String)
    label!: string

    /** True when it is the agent's default account of its provider. */
    @Field(() => Boolean)
    isDefault!: boolean

    /** True for a sandbox account. */
    @Field(() => Boolean)
    sandbox!: boolean

    /** True when the connection works; a choice of an account that does not is refused. */
    @Field(() => Boolean)
    connected!: boolean
}

@ObjectType()
/** One step's node settings: what the shop may set on it, what is in force, and the accounts it could use. */
export class AgentWorkflowNodeSettingsType {
    /** The step. */
    @Field(() => String)
    nodeKey!: string

    /** What may be set on it (`mode`, `accounts`), in that order; empty: nothing (the trigger, a wait, a control step). */
    @Field(() => [String])
    settable!: ReadonlyArray<string>

    /** The mode in force (`auto` | `ask`), or null on a step that states none. */
    @Field(() => String, { nullable: true })
    mode!: string | null

    /** The accounts chosen, in try order; empty: the default pick. */
    @Field(() => [ID])
    accountIds!: ReadonlyArray<string>

    /** The agent's attached accounts this step could use, in the step's order of providers; empty where it takes no account. */
    @Field(() => [AgentWorkflowNodeAccountType])
    accounts!: ReadonlyArray<AgentWorkflowNodeAccountType>
}
