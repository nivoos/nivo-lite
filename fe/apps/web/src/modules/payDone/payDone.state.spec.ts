import { payDoneStateOf } from "./payDone.state"

describe("payDoneStateOf", () => {
    it("says returned for the provider's return query (cancel false, any other status)", () => {
        expect(payDoneStateOf({ code: "00", id: "abc", cancel: "false", status: "PAID", orderCode: "1780000000001" })).toBe("returned")
        expect(payDoneStateOf({ cancel: "false", status: "PENDING" })).toBe("returned")
    })

    it("says cancelled for the provider's cancel query (cancel true, or status CANCELLED)", () => {
        expect(payDoneStateOf({ code: "00", id: "abc", cancel: "true", status: "CANCELLED", orderCode: "1780000000001" })).toBe("cancelled")
        expect(payDoneStateOf({ cancel: "true" })).toBe("cancelled")
        expect(payDoneStateOf({ status: "CANCELLED" })).toBe("cancelled")
    })

    it("says returned, the neutral sentence, for an absent or unknown state", () => {
        expect(payDoneStateOf({})).toBe("returned")
        expect(payDoneStateOf({ cancel: undefined, status: undefined })).toBe("returned")
        expect(payDoneStateOf({ status: "SOMETHING_NEW" })).toBe("returned")
    })

    it("reads hostile values as no state at all: only the exact words count", () => {
        const hostile = [
            "<script>alert(1)</script>",
            "javascript:alert(1)",
            "true<img src=x onerror=alert(1)>",
            " true",
            "TRUE",
            "cancelled",
            "'; DROP TABLE orders;--",
            "%3Cscript%3E",
            "a".repeat(100_000),
            "",
        ]
        for (const value of hostile) {
            expect(payDoneStateOf({ cancel: value, status: value })).toBe("returned")
        }
        expect(payDoneStateOf({ cancel: ["true"], status: ["CANCELLED"] })).toBe("returned")
        expect(payDoneStateOf({ cancel: ["true", "true"] })).toBe("returned")
        const inherited: Record<string, string> = {}
        Reflect.setPrototypeOf(inherited, { cancel: "true", status: "CANCELLED" })
        expect(payDoneStateOf(inherited)).toBe("returned")
    })
})
