import { isRecord, parseJsonText } from "@modules/platform/primitives"

/** What Zalo answered for a token call, as the call reports it. */
interface ZaloAnswer {
    /** The short-lived access token. */
    readonly accessToken: string
    /** The single-use renewal token. */
    readonly renewalToken: string
    /** How long the access token lives, in seconds. */
    readonly expiresInSeconds: number
}

/**
 * The pair Zalo handed over, with the end of its access token as an absolute time. This is what the effect ledger keeps of a token call
 * (sealed, never in plain text), so storing it after a crash needs no second call.
 */
export interface ZaloTokenPair {
    /** The access token. */
    readonly accessToken: string
    /** The single-use renewal token. */
    readonly renewalToken: string
    /** When the access token ends, epoch milliseconds. */
    readonly expiresAt: number
}

/** The pair of an answer received at `receivedAt` (epoch milliseconds). */
export const tokenPairOf = (answer: ZaloAnswer, receivedAt: number): ZaloTokenPair => ({
    accessToken: answer.accessToken,
    renewalToken: answer.renewalToken,
    expiresAt: receivedAt + answer.expiresInSeconds * 1000,
})

/** The pair a text holds, or null when the text is not one. */
export const parseTokenPair = (text: string): ZaloTokenPair | null => {
    const read = parseJsonText(text)
    if (!read.ok || !isRecord(read.value)) return null
    const { accessToken, renewalToken, expiresAt } = read.value
    if (typeof accessToken !== "string" || typeof renewalToken !== "string" || typeof expiresAt !== "number") return null
    return { accessToken, renewalToken, expiresAt }
}
