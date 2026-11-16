import { randomBytes } from "node:crypto"
import { SealingErrorCode } from "./errors/sealing.error"
import { sealerOf } from "./secret-sealer.policy"

const FAKE_KEY = randomBytes(32).toString("base64")

describe("sealerOf", () => {
    it("seals and opens a text with the key and never leaves the text in the sealed form", () => {
        const sealer = sealerOf(FAKE_KEY)

        const sealed = sealer.seal("fake-secret-value")

        expect(sealed).not.toContain("fake-secret-value")
        expect(sealer.open(sealed)).toBe("fake-secret-value")
    })

    it("refuses a key that is not 32 bytes of base64", () => {
        expect(() => sealerOf(randomBytes(16).toString("base64"))).toThrow(expect.objectContaining({ code: SealingErrorCode.KeyInvalid }))
    })

    it("refuses to open a text another key sealed", () => {
        const sealed = sealerOf(FAKE_KEY).seal("x")

        expect(() => sealerOf(randomBytes(32).toString("base64")).open(sealed)).toThrow(
            expect.objectContaining({ code: SealingErrorCode.Unreadable }),
        )
    })
})
