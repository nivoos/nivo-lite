import { parseTokenPair, tokenPairOf } from "./zalo-token-pair.policy"

describe("zalo token pair", () => {
    it("makes the end of the access token absolute from the moment the answer came", () => {
        expect(tokenPairOf({ accessToken: "a", renewalToken: "r", expiresInSeconds: 60 }, 1000)).toEqual({
            accessToken: "a",
            renewalToken: "r",
            expiresAt: 61_000,
        })
    })

    it("reads back the pair it wrote", () => {
        const pair = tokenPairOf({ accessToken: "a", renewalToken: "r", expiresInSeconds: 1 }, 0)
        expect(parseTokenPair(JSON.stringify(pair))).toEqual(pair)
    })

    it.each(["not json", "null", '"text"', "[]", '{"accessToken":"a"}', '{"accessToken":"a","renewalToken":"r","expiresAt":"1"}'])(
        "refuses a text that is not a pair: %s",
        (text) => {
            expect(parseTokenPair(text)).toBeNull()
        },
    )
})
