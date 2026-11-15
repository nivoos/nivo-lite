import { Field, ID, InputType, Int } from "@nestjs/graphql"
import { Type } from "class-transformer"
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength, ValidateNested } from "class-validator"
import { NullAsAbsent } from "@modules/platform/graphql"

@InputType()
/** What openSandboxAccount takes. */
export class OpenSandboxAccountInput {
    /** The provider key. */
    @Field(() => String)
    @IsString()
    @MaxLength(64)
    provider!: string

    /** The name of the account. */
    @Field(() => String)
    @IsString()
    @MinLength(1)
    @MaxLength(120)
    name!: string

    /** The agents to attach the account to in the same action: attached, bound where they may be, the provider's triggers on. */
    @Field(() => [ID], { nullable: true, defaultValue: [] })
    @NullAsAbsent()
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(50)
    @IsUUID(undefined, { each: true })
    attachTo?: Array<string>
}

@InputType()
/** What attachSandboxAccount and detachSandboxAccount take. */
export class SandboxAccountAgentInput {
    /** The sandbox account. */
    @Field(() => ID)
    @IsUUID()
    @MaxLength(64)
    connectionId!: string

    /** The agent to attach or detach. */
    @Field(() => ID)
    @IsUUID()
    @MaxLength(64)
    agentId!: string
}

@InputType()
/** One input value of an inbound case, as text. */
export class SandboxInputValueInput {
    /** The field name. */
    @Field(() => String)
    @IsString()
    @MaxLength(60)
    name!: string

    /** The value as typed. */
    @Field(() => String)
    @IsString()
    @MaxLength(2000)
    value!: string
}

@InputType()
/** What sendSandboxCase takes. */
export class SendSandboxCaseInput {
    /** The sandbox account. */
    @Field(() => ID)
    @IsUUID()
    @MaxLength(64)
    connectionId!: string

    /** The inbound case id. */
    @Field(() => String)
    @IsString()
    @MaxLength(60)
    caseId!: string

    /** The inputs given; one not given is prefilled. */
    @Field(() => [SandboxInputValueInput], { nullable: true, defaultValue: [] })
    @NullAsAbsent()
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(20)
    @ValidateNested({ each: true })
    @Type(() => SandboxInputValueInput)
    inputs?: Array<SandboxInputValueInput>

    /** How the event is delivered: `once`, `twice`, `withheld` (only the provider's poll brings it back) or `late`; absent: the case's own. */
    @Field(() => String, { nullable: true })
    @IsOptional()
    @IsIn(["once", "twice", "withheld", "late"])
    mode?: string

    /** The interval of `late`, in seconds (default one hour). */
    @Field(() => Int, { nullable: true })
    @IsOptional()
    @IsInt()
    @Min(1)
    lateBySeconds?: number

    /** Alias of `mode: withheld` kept for the page until it sends `mode` (a request to fe); the mode wins when both are given. */
    @Field(() => Boolean, { nullable: true, defaultValue: false })
    @NullAsAbsent()
    @IsOptional()
    @IsBoolean()
    dropWebhook?: boolean
}

@InputType()
/** What setSandboxNextCase takes. */
export class SetSandboxNextCaseInput {
    /** The sandbox account. */
    @Field(() => ID)
    @IsUUID()
    @MaxLength(64)
    connectionId!: string

    /** The outbound case id. */
    @Field(() => String)
    @IsString()
    @MaxLength(60)
    caseId!: string

    /** The narrower key the pick holds for (a model call's purpose, as the call log names it); absent: every call of the case's operation. */
    @Field(() => String, { nullable: true })
    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(200)
    scope?: string
}

@InputType()
/** What setSandboxNextOutcome takes. */
export class SetSandboxNextOutcomeInput {
    /** The sandbox account. */
    @Field(() => ID)
    @IsUUID()
    @MaxLength(64)
    connectionId!: string

    /** The outbound operation (the `operation` of its cases). */
    @Field(() => String)
    @IsString()
    @MaxLength(200)
    operation!: string

    /** The generic outcome: `ok`, `refused`, `final`, `transient` or `timeout`. */
    @Field(() => String)
    @IsIn(["ok", "refused", "final", "transient", "timeout"])
    outcome!: string
}

@InputType()
/** What expireSandboxWait takes. */
export class ExpireSandboxWaitInput {
    /** The run parked at a wait. */
    @Field(() => ID)
    @IsUUID()
    @MaxLength(64)
    runId!: string
}
