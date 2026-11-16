import { Test } from "@nestjs/testing"
import { isKnownTimeZone, storedTimeZoneOf, timeZoneOrDefault } from "./workspace-time-zone.policy"
import { localDate } from "./zoned-time.policy"

const SUBJECT = Symbol("workspace-time-zone.policy")

const build = async () => {
    const moduleRef = await Test.createTestingModule({
        providers: [{ provide: SUBJECT, useValue: { isKnownTimeZone, storedTimeZoneOf, timeZoneOrDefault } }],
    }).compile()
    return moduleRef.get<{
        isKnownTimeZone: typeof isKnownTimeZone
        storedTimeZoneOf: typeof storedTimeZoneOf
        timeZoneOrDefault: typeof timeZoneOrDefault
    }>(SUBJECT)
}

/** 2026-11-14T17:30:00Z: 00:30 on 15 November in Vietnam (UTC+7), still the 14th in UTC. */
const INSTANT = Date.UTC(2026, 10, 14, 17, 30)

describe("the time zone rule: a name the runtime can resolve, canonical or link", () => {
    it("accepts the IANA canonical name even when the runtime's own list names the zone by its link", async () => {
        const policy = await build()
        expect(policy.isKnownTimeZone("Asia/Ho_Chi_Minh")).toBe(true)
        expect(policy.isKnownTimeZone("UTC")).toBe(true)
    })

    it("accepts a link name (an IANA alias of a canonical zone)", async () => {
        const policy = await build()
        expect(policy.isKnownTimeZone("Asia/Saigon")).toBe(true)
        expect(policy.isKnownTimeZone("Asia/Calcutta")).toBe(true)
    })

    it("refuses an unknown name and an empty one", async () => {
        const policy = await build()
        expect(policy.isKnownTimeZone("Mars/Olympus")).toBe(false)
        expect(policy.isKnownTimeZone("")).toBe(false)
        expect(policy.isKnownTimeZone("   ")).toBe(false)
    })

    it("stores the name as given (trimmed), and the date maths read the same day from the canonical name and its link", async () => {
        const policy = await build()
        expect(policy.storedTimeZoneOf(" Asia/Ho_Chi_Minh ")).toBe("Asia/Ho_Chi_Minh")
        expect(localDate(INSTANT, "Asia/Ho_Chi_Minh")).toBe("2026-11-15")
        expect(localDate(INSTANT, "Asia/Saigon")).toBe("2026-11-15")
        expect(localDate(INSTANT, "UTC")).toBe("2026-11-14")
    })
})

describe("the time zone of a workspace", () => {
    it("is the stored IANA name when the runtime resolves it, a canonical name or a link", async () => {
        const policy = await build()
        expect(policy.timeZoneOrDefault("Asia/Bangkok", "Asia/Ho_Chi_Minh")).toBe("Asia/Bangkok")
        expect(policy.timeZoneOrDefault("Asia/Calcutta", "Asia/Ho_Chi_Minh")).toBe("Asia/Calcutta")
        expect(policy.timeZoneOrDefault("UTC", "Asia/Ho_Chi_Minh")).toBe("UTC")
    })

    it("is the default when nothing is stored, the value is not text, the name is unknown or empty", async () => {
        const policy = await build()
        expect(policy.timeZoneOrDefault(undefined, "Asia/Ho_Chi_Minh")).toBe("Asia/Ho_Chi_Minh")
        expect(policy.timeZoneOrDefault(7, "Asia/Ho_Chi_Minh")).toBe("Asia/Ho_Chi_Minh")
        expect(policy.timeZoneOrDefault("Mars/Olympus", "Asia/Ho_Chi_Minh")).toBe("Asia/Ho_Chi_Minh")
        expect(policy.timeZoneOrDefault("", "Asia/Ho_Chi_Minh")).toBe("Asia/Ho_Chi_Minh")
    })
})
