/*
 * THE HALVES OF AN ACCOUNT (lane concept providers, rule MI-1): one account is one identity at an outside system, and some identities have
 * two sides that two protocols serve. A mailbox is ONE account (one address) with an outbound side (SMTP submission, the account's own
 * provider `smtp`) and an inbound side (an IMAP read): the inbound side is the HALF of provider `imap` the `smtp` account holds. Everything
 * that reads the half's data asks whether an account ACTS AS the half's provider (`actsAs`), so the half's data keeps its one type and its
 * one reader (no second type, no second poller). An `imap` account alone is that half standing alone: it receives and never sends.
 */

/** One half an account of a provider may hold: the other provider's side of the same identity, present when its public fact is. */
export interface AccountHalf {
    /** The provider of the account that holds it (`smtp`). */
    readonly host: string
    /** The provider whose side the half is (`imap`). */
    readonly half: string
    /** The public fact the half's settings are kept under: the half is present when the account holds it. */
    readonly fact: string
}

/** Every half an account can hold: the inbound (IMAP) side of a mailbox account. */
export const ACCOUNT_HALVES: ReadonlyArray<AccountHalf> = [{ host: "smtp", half: "imap", fact: "config" }]

/** What the halves are read from: the account's provider and its public facts. */
export interface HalvedAccount {
    readonly provider: string
    readonly meta: Readonly<Record<string, string>>
}

/** The providers whose halves the account holds now (empty for an account of no half). */
export const halvesOf = (account: HalvedAccount): ReadonlyArray<string> =>
    ACCOUNT_HALVES.filter((one) => one.host === account.provider && (account.meta[one.fact] ?? "") !== "").map((one) => one.half)

/** True when the account is of the provider, or holds that provider's half. */
export const actsAs = (account: HalvedAccount, provider: string): boolean =>
    account.provider === provider || halvesOf(account).includes(provider)

/** The providers whose accounts may hold a half of `provider` (`imap` -> [`smtp`]). */
export const hostsOf = (provider: string): ReadonlyArray<string> =>
    ACCOUNT_HALVES.filter((one) => one.half === provider).map((one) => one.host)

/** The half a host account may hold, or null when its provider holds none. */
export const halfOfHost = (provider: string): AccountHalf | null => ACCOUNT_HALVES.find((one) => one.host === provider) ?? null
