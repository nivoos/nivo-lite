import { createHash } from "node:crypto"
import type { EffectCallKept } from "@modules/platform/effects"
import { isRecord } from "@modules/platform/primitives"
import { WorkspaceInvitesError, WorkspaceInvitesErrorCode } from "./errors/workspace-invites.error"
import type { MintedToken } from "./workspace-invites.contracts"

/** The hex SHA-256 of the raw invitation token: the only form the table stores. */
export const hashInviteToken = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex")

/** The uuid a `gen_random_uuid()` call answered; the invitation cannot be minted when the database answers none. */
export const uuidOfRow = (row: { readonly gen_random_uuid: string } | undefined): string => {
    if (row === undefined) throw new WorkspaceInvitesError({ code: WorkspaceInvitesErrorCode.TokenUnavailable })
    return row.gen_random_uuid
}

/** The invitation token two random uuids make, dashes removed; only its hash is ever stored. */
export const mintedTokenOf = (first: string, second: string): MintedToken => ({
    token: `${first}${second}`.replaceAll("-", ""),
})

/** The call that makes an invitation token once and KEEPS it SEALED on the effect ledger (a link token is a secret), so every run of a job reads the same one. */
export const keptTokenCall = (act: () => Promise<MintedToken>): EffectCallKept<MintedToken> => ({
    act,
    keep: (minted) => ({ token: minted.token }),
    from: (kept) => {
        if (isRecord(kept) && typeof kept.token === "string") return { token: kept.token }
        throw new WorkspaceInvitesError({ code: WorkspaceInvitesErrorCode.TokenUnavailable })
    },
    secret: true,
})
