import { attempt } from "@modules/platform/primitives"

/**
 * Whether the runtime can RESOLVE the name as an IANA time zone: the one zone rule of the be. A name is valid when
 * `Intl.DateTimeFormat` accepts it, canonical or link alike (`Asia/Ho_Chi_Minh` and its link `Asia/Saigon`, `UTC`). The list of
 * `Intl.supportedValuesOf("timeZone")` is not the rule: it holds ONE name per zone, the runtime's own canonical choice (this Node's ICU
 * lists `Asia/Saigon`, not the IANA canonical `Asia/Ho_Chi_Minh`; it leaves out `UTC`), so a list check refuses names every date
 * function of the same runtime reads.
 */
export const isKnownTimeZone = (name: string): boolean =>
    name.trim() !== "" && attempt(() => new Intl.DateTimeFormat("en-US", { timeZone: name.trim() })).ok

/**
 * The name to store for a zone a person gave: the name as given (trimmed), never the runtime's canonical form. The canonical form moves
 * with the runtime (ICU / CLDR answer `Asia/Saigon`, IANA `Asia/Ho_Chi_Minh`, newer engines keep the given identifier), every date
 * function resolves either name to the same zone, and the person reads back what they chose.
 */
export const storedTimeZoneOf = (name: string): string => name.trim()

/** The time zone a stored setting names; the default when none is stored or the runtime cannot resolve the name. */
export const timeZoneOrDefault = (stored: unknown, fallback: string): string =>
    typeof stored === "string" && isKnownTimeZone(stored) ? stored : fallback
