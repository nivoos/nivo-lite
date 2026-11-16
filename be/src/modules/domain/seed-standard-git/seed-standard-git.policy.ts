import { parse } from "yaml"
import type { SeedSealedRead } from "@modules/integrations/seed"
import type { SealedValues } from "@modules/domain/workspace-seed"
import { attempt, isRecord } from "@modules/platform/primitives"

/** The secret members of the accounts of a sealed document: by account key, by member. */
export type SealedAccounts = Readonly<Record<string, Readonly<Record<string, string>>>>

/** The string members of one account (a member of another type is left out: it is not a credential text). */
const stringMembersOf = (members: Record<string, unknown>): Readonly<Record<string, string>> =>
    Object.fromEntries(
        Object.entries(members).flatMap(([member, value]): ReadonlyArray<readonly [string, string]> =>
            typeof value === "string" ? [[member, value]] : [],
        ),
    )

/** The members of the document's `accounts` as strings, or null when the document holds no `accounts` mapping. */
export const accountsOf = (document: unknown): SealedAccounts | null => {
    if (!isRecord(document) || !isRecord(document.accounts) || Array.isArray(document.accounts)) return null
    return Object.fromEntries(
        Object.entries(document.accounts).flatMap(
            ([key, members]): ReadonlyArray<readonly [string, Readonly<Record<string, string>>]> =>
                isRecord(members) && !Array.isArray(members) ? [[key, stringMembersOf(members)]] : [],
        ),
    )
}

/** The sealed file as the seed reads it: `accounts.<key>.<member>` from its text, or the fixed reason it gave none. */
export const sealedValuesOf = (read: SeedSealedRead): SealedValues => {
    if (!read.opened) return { opened: false, reason: read.reason }
    const parsed = attempt(() => accountsOf(parse(read.text)))
    return parsed.ok && parsed.value !== null
        ? { opened: true, accounts: parsed.value }
        : { opened: false, reason: "not_a_mapping" }
}
