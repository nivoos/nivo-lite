import { actsAs, type HalvedAccount } from "@modules/domain/connections"

/*
 * WHERE A MAILBOX'S INBOUND HALF LIVES (MAIL-IN rule MI-1): an `imap` account is the inbound half standing alone (its settings in its
 * public facts, its IMAP credential its own sealed credential); a mailbox `smtp` account holds the inbound half beside its outbound one
 * (the same settings in its public facts, the IMAP credential in the account's READ credential slot, the one NIVO presents to read the
 * account's data). Every reader of the half asks here, never a provider name.
 */

/** The provider of a mailbox's inbound half. */
export const IMAP_INBOUND_PROVIDER = "imap"

/** True when the account holds an inbound half (an `imap` account, or a mailbox account whose inbound half is set). */
export const holdsInbound = (account: HalvedAccount): boolean => actsAs(account, IMAP_INBOUND_PROVIDER)

/** True when the inbound credential is the account's READ credential (a half held beside another), false when it is its own credential. */
export const inboundIsReadCredential = (account: HalvedAccount): boolean => account.provider !== IMAP_INBOUND_PROVIDER

/** The opened credential of an account's own secret, or null when it has none. */
export const inboundFromSecret = (secret: { readonly plain: string } | null): string | null => secret?.plain ?? null
