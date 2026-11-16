import {
    TRIGGER_DATA_MEMBER,
    TRIGGER_SCOPE,
    providerTriggerKeyOf,
    type ContractType,
    type DataMember,
    type ProviderTriggerInfo,
} from "@nivo-lite/agent-sdk/graph"
import { isRecord } from "@modules/platform/primitives"
import { z, type ZodType } from "zod"
import type { OptionalAgentId } from "./provider-triggers.contracts"
import type { TriggerDeclaration, TriggerSwitch } from "./trigger-declaration.contracts"
import { triggerDeclarations, type TriggerDeclarationsRegistry } from "./trigger-declarations.registry"

/*
 * THE READERS OF THE ONE SHAPE (concept triggers, R95 / R96): everything the owner's pages, the registration checks and the registry
 * reads need to know of a trigger is read from its `TriggerDeclaration` (the registry `triggerDeclarations`): the switch (`switch`), the
 * ways it is received (`via`), its words and the members of its `data`, which are DERIVED from the `data` schema (object keys; a
 * `z.enum` is a closed choice and the only member a filter may compare), never written a second time by hand.
 */

/** A declaration that carries an account switch: the owner turns it on or off per account. */
export type SwitchedDeclaration = TriggerDeclaration & { readonly switch: TriggerSwitch }

/** One member of a declaration's `data`, as its schema declares it. */
export interface TriggerMember {
    /** The member's name, as `trigger.data.<name>` reads it. */
    readonly name: string
    /** Its JSON type. */
    readonly type: ContractType
    /** True when the schema makes it present in every event. */
    readonly required: boolean
    /** The closed values it takes (a `z.enum`); empty for any other member. */
    readonly choices: ReadonlyArray<string>
}

/** What the generic members of the trigger scope an account event supplies beside its `data` are named: its id, its account, the language. */
const ACCOUNT_EVENT_MEMBERS: ReadonlyArray<string> = ["eventId", "accountId", TRIGGER_DATA_MEMBER, "locale"]

/** The JSON types a contract knows; a member of any other type is not offered to a graph. */
const CONTRACT_TYPE_NAMES: ReadonlyArray<string> = ["string", "number", "integer", "boolean", "object", "array"]

const contractTypeOf = (name: unknown): ContractType | null =>
    typeof name === "string" && CONTRACT_TYPE_NAMES.includes(name) ? (name as ContractType) : null

/** The JSON type a member's schema declares: its `type`, the one typed non-null alternative of a nullable, or that of its closed values. */
const memberTypeOf = (schema: Readonly<Record<string, unknown>>): ContractType | null => {
    const { type } = schema
    if (Array.isArray(type)) {
        const typed = type.map((name) => contractTypeOf(name)).filter((name): name is ContractType => name !== null)
        return typed.length === 1 ? (typed[0] ?? null) : null
    }
    const direct = contractTypeOf(type)
    if (direct !== null) return direct
    const alternatives = Array.isArray(schema.anyOf) ? schema.anyOf : []
    const typed = alternatives
        .filter((alternative) => isRecord(alternative) && alternative.type !== "null")
        .map((alternative) => (isRecord(alternative) ? memberTypeOf(alternative) : null))
    return typed.length === 1 ? typed[0] ?? null : null
}

/** The closed values a member's schema lists (`enum`), as text. */
const choicesOf = (schema: Readonly<Record<string, unknown>>): ReadonlyArray<string> =>
    Array.isArray(schema.enum) ? schema.enum.filter((value): value is string => typeof value === "string") : []

/** The members already read, by the schema object (a declaration's schema is one object for the life of the process). */
const MEMBERS = new WeakMap<ZodType, ReadonlyArray<TriggerMember>>()

/**
 * The members of a declaration's `data`, DERIVED from its schema: one per key of the object, in the schema's order, with its JSON type,
 * whether it is always present, and its closed values when it is a `z.enum`. A schema that is no object has no members; a member whose
 * type the schema does not state is left out (the gate names it).
 */
export const triggerMembersOf = (data: ZodType): ReadonlyArray<TriggerMember> => {
    const kept = MEMBERS.get(data)
    if (kept !== undefined) return kept
    const drawn: unknown = z.toJSONSchema(data, { io: "output", unrepresentable: "any" })
    const required = isRecord(drawn) && Array.isArray(drawn.required) ? drawn.required : []
    const members =
        isRecord(drawn) && isRecord(drawn.properties)
            ? Object.entries(drawn.properties).flatMap(([name, property]): ReadonlyArray<TriggerMember> => {
                  const schema = isRecord(property) ? property : {}
                  const type = memberTypeOf(schema)
                  return type === null ? [] : [{ name, type, required: required.includes(name), choices: choicesOf(schema) }]
              })
            : []
    MEMBERS.set(data, members)
    return members
}

/** A placeholder value of a data member of its JSON type (a closed choice takes its first value): what a sample event of the trigger holds. */
const sampleValueOf = (member: TriggerMember): unknown => {
    if (member.choices.length > 0) return member.choices[0]
    if (member.type === "integer" || member.type === "number") return 1
    if (member.type === "boolean") return true
    if (member.type === "object") return {}
    if (member.type === "array") return []
    return "sample"
}

/** A sample of an event's `data`: one placeholder per member of the declaration's data schema (what a registration check is asked with). */
export const sampleDataOf = (declaration: Pick<TriggerDeclaration, "data">): Readonly<Record<string, unknown>> =>
    Object.fromEntries(triggerMembersOf(declaration.data).map((member) => [member.name, sampleValueOf(member)]))

/** Every declaration of one provider (the account's own, or a half it holds: the caller asks once per provider). */
export const declaredOf = (
    provider: string,
    registry: Pick<TriggerDeclarationsRegistry, "all"> = triggerDeclarations,
): ReadonlyArray<TriggerDeclaration> => registry.all().filter((declaration) => declaration.provider === provider)

const hasSwitch = (declaration: TriggerDeclaration): declaration is SwitchedDeclaration => declaration.switch !== undefined

/** The declarations of a provider that carry an account switch, in registration order. */
export const switchableOf = (
    provider: string,
    registry: Pick<TriggerDeclarationsRegistry, "all"> = triggerDeclarations,
): ReadonlyArray<SwitchedDeclaration> => declaredOf(provider, registry).filter(hasSwitch)

/** The declaration of a provider's trigger when it carries an account switch, else null (no such trigger, or one that is on while its account is). */
export const switchDeclarationOf = (
    provider: string,
    trigger: string,
    registry: Pick<TriggerDeclarationsRegistry, "of"> = triggerDeclarations,
): SwitchedDeclaration | null => {
    const declared = registry.of(provider, trigger)
    return declared !== null && hasSwitch(declared) ? declared : null
}

/**
 * Whether an account's switch of a trigger is ON: the switch a person set (on or off) when the account holds one, else the declaration's
 * default (`switch.onByDefault`: only a trigger that reports work NIVO itself requested, concept triggers rule 6a); off for no declaration.
 */
export const switchedOn = (
    held: { readonly enabled: boolean } | null | undefined,
    declaration: SwitchedDeclaration | null | undefined,
): boolean => (held === null || held === undefined ? declaration?.switch.onByDefault === true : held.enabled)

/**
 * Whether a trigger NAME is on by default for every provider that declares it with a switch (`isOn` is asked by name only): true only when
 * it is declared so and every such declaration of the name says `onByDefault`.
 */
export const onByDefaultOf = (
    trigger: string,
    registry: Pick<TriggerDeclarationsRegistry, "all"> = triggerDeclarations,
): boolean => {
    const named = registry.all().filter((declaration) => hasSwitch(declaration) && declaration.name === trigger)
    return named.length > 0 && named.every((declaration) => declaration.switch?.onByDefault === true)
}

/** Whether a switch turned on again may catch up on the events it missed: only a trigger a poll receives (the poll's window still holds them). */
export const canCatchUpOf = (declaration: Pick<TriggerDeclaration, "via">): boolean => declaration.via.includes("poll")

/**
 * THE ONE DECIDER of an account's trigger. The agent the provider's own core path hands the event to decides while it is bound; with
 * none, the agent the owner bound on the switch; with neither, nobody decides and every receiver is told. It answers at most one agent
 * whatever it is given, so two deciders of one account trigger cannot exist.
 */
export const triggerDeciderOf = (
    declaration: SwitchedDeclaration,
    coreDeciderId: OptionalAgentId,
    boundDeciderId: OptionalAgentId,
): OptionalAgentId => (declaration.switch.decided ? (coreDeciderId ?? boundDeciderId) : null)

/**
 * What a workflow that registers on a trigger is checked against: the params a wake supplies and the paths a filter may compare. An
 * account event reaches MATCH as the generic scope of the one pipeline (`deliver`): `eventId`, `accountId`, the run's language and
 * `data` holding the members of the declaration's `data` schema, so a filter names `data.<member>` of a closed choice (a `z.enum`) (R44:
 * the credit narrowing reads `data.direction`).
 */
export const triggerInfoOf = (declaration: Pick<TriggerDeclaration, "data">): ProviderTriggerInfo => {
    const members = triggerMembersOf(declaration.data)
    return {
        supplies: TRIGGER_SCOPE.filter((param) => ACCOUNT_EVENT_MEMBERS.includes(param.name)).map((param) =>
            param.name === TRIGGER_DATA_MEMBER ? { ...param, members: members.map((member): DataMember => ({ name: member.name, type: member.type })) } : param,
        ),
        filterable: members.filter((member) => member.choices.length > 0).map((member) => `${TRIGGER_DATA_MEMBER}.${member.name}`),
    }
}

/** The declared triggers as the workflow contract checks look them up, by `<provider>:<trigger>`; undefined for a key nobody declares. */
export const providerTriggerLookup = (
    providerTrigger: string,
    registry: Pick<TriggerDeclarationsRegistry, "all"> = triggerDeclarations,
): ProviderTriggerInfo | undefined => {
    const declaration = registry.all().find((entry) => providerTriggerKeyOf(entry.provider, entry.name) === providerTrigger)
    return declaration === undefined ? undefined : triggerInfoOf(declaration)
}
