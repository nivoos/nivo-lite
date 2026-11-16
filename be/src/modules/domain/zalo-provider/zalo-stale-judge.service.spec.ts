import { ZaloStaleJudgeService } from "./zalo-stale-judge.service"
import type { ZaloAccessTokens } from "./zalo-access-tokens.port"

const HOUR = 3_600_000
const NOW = Date.parse("2026-11-14T10:00:00.000Z")

/** The port the options name; the judge never calls it. */
class Tokens implements ZaloAccessTokens {
    tokenOf = jest.fn()
    failureOf = jest.fn()
}

describe("ZaloStaleJudgeService", () => {
    it("judges a message older than the shorter of the reply window and the stale age against the clock the caller reads", () => {
        const judge = new ZaloStaleJudgeService({ staleAfterMs: HOUR, ports: { tokens: Tokens } })

        expect(judge.isStale(NOW - 30 * 60_000, NOW)).toBe(false)
        expect(judge.isStale(NOW - 2 * HOUR, NOW)).toBe(true)
    })

    it("takes Zalo's 48 hours and a day when the options name nothing", () => {
        const judge = new ZaloStaleJudgeService({ ports: { tokens: Tokens } })

        expect(judge.isStale(NOW - 23 * HOUR, NOW)).toBe(false)
        expect(judge.isStale(NOW - 25 * HOUR, NOW)).toBe(true)
    })
})
