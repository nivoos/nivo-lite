import { paramLabelOf, refChipTextOf, refOptionsOf } from "@/modules/plugin-registry"
import type { GraphSpec } from "@nivo-lite/agent-sdk/graph"

/*
 * The words of the values a step's param may be bound to. The package's picker words a member from its own labels; a member it has no
 * label for comes back as the raw name (`routeId`), which a person never reads. Here such a member is worded from ONE small catalogue
 * (the engine's own members of the trigger scope, a fixed set), and a member with no word anywhere reads "unnamed". Node output members that lack a package label are posted as a need
 * for the package owner; this file holds no per-key dictionary of them.
 */

/** The two languages of the drawer. */
type RefLocale = "vi" | "en"

/** The words the labels need that the app owns: the word of a value nothing names, and the engine's members of the trigger scope and of a run (event, route, contact, account, time) by member name. */
export interface RefWords {
    readonly unnamed: string
    readonly members: Readonly<Record<string, string>>
}

/** The words of one name the package labels, or null when it has none (the package answers the name itself then). */
const packageWordOf = (name: string, locale: RefLocale): string | null => {
    const word = paramLabelOf(name, locale)
    return word === name ? null : word
}

/** The member path of a ref (`steps.k.output.routeId` gives `routeId`, `trigger.orderId` gives `orderId`); null for a ref of no known shape. */
const memberOfRef = (ref: string): string | null => {
    const [root = "", ...rest] = ref.split(".")
    if (root === "steps") return rest.slice(2).join(".") === "" ? null : rest.slice(2).join(".")
    if (root === "trigger" || root === "lead" || root === "out") return rest.join(".") === "" ? null : rest.join(".")
    return null
}

/** The words of a member path: the package's when every part has one, else part by part with the catalogue; null when a part has no word. */
const memberWordOf = (path: string, locale: RefLocale, words: RefWords): string | null => {
    const parts = path.split(".")
    if (parts.every((part) => packageWordOf(part, locale) !== null)) return paramLabelOf(path, locale)
    const found = parts.map((part) => packageWordOf(part, locale) ?? (Object.hasOwn(words.members, part) ? words.members[part] : null) ?? null)
    return found.every((word): word is string => word !== null) ? found.join(" › ") : null
}

/** The chip of a ref in words (`= <member> . <where>`); a member with no word anywhere reads as `unnamed`. */
export const wordedChipOf = (spec: GraphSpec, nodeKey: string, ref: string, locale: RefLocale, words: RefWords): string => {
    const member = memberOfRef(ref)
    const word = member === null ? null : memberWordOf(member, locale, words)
    const offered = refOptionsOf(spec, nodeKey, locale).find((one) => one.ref === ref)
    if (offered !== undefined) return `= ${word ?? words.unnamed} · ${offered.group}`
    if (word === null) return `= ${words.unnamed}`
    return member?.split(".").every((part) => packageWordOf(part, locale) !== null) === true
        ? refChipTextOf(spec, nodeKey, ref, locale)
        : `= ${word}`
}

/** The ref a binding reads from as "<where> → <member>" for the read-only line; empty when it is no ref. */
export const wordedSourceOf = (spec: GraphSpec, nodeKey: string, ref: string, locale: RefLocale, words: RefWords): string => {
    const member = memberOfRef(ref)
    const word = member === null ? null : memberWordOf(member, locale, words)
    const offered = refOptionsOf(spec, nodeKey, locale).find((one) => one.ref === ref)
    if (offered !== undefined) return `${offered.group} → ${word ?? words.unnamed}`
    return word ?? words.unnamed
}
