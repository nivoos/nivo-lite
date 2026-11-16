import { outcomeRowsOf } from "./sandbox.outcomes"

/** One outbound case as the back end lists it. */
const outbound = (id: string, operation: string, outcome: string | null, isDefault = false) => ({
    id,
    direction: "outbound",
    operation,
    isDefault,
    outcome,
})

/** Cases of two providers the page has never heard of, with operation names of no known shape. */
const ZED = [
    outbound("ZED-1", "zed.fetch", "ok", true),
    outbound("ZED-2", "zed.fetch", "timeout"),
    outbound("ZED-3", "zed.fetch", "refused"),
    outbound("ZED-4", "zed.fetch", "transient"),
    outbound("ZED-5", "zed.only", "ok", true),
    { id: "ZED-IN-1", direction: "inbound", operation: null, isDefault: false, outcome: null },
]
const QUX = [
    outbound("QUX-1", "qux.make", "ok", true),
    outbound("QUX-2", "qux.make", "refused"),
    outbound("QUX-3", "qux.make", "banned"),
    outbound("QUX-9", "qux.make", null),
]

describe("outcomeRowsOf", () => {
    it("offers, per outbound operation, the outcomes its cases are tagged with in the frame's order, and skips an operation with no choice", () => {
        const rows = outcomeRowsOf(ZED, [])
        expect(rows.map((row) => row.operation)).toEqual(["zed.fetch"])
        expect(rows[0]?.options).toEqual(["ok", "refused", "transient", "timeout"])
    })

    it("reads the current outcome from the case the account answers next; no pick is the default, which is ok", () => {
        expect(outcomeRowsOf(ZED, [])[0]).toMatchObject({ current: "ok", caseId: "ZED-1" })
        expect(outcomeRowsOf(ZED, [{ operation: "zed.fetch", caseId: "ZED-2", isDefault: false }])[0]).toMatchObject({
            current: "timeout",
            caseId: "ZED-2",
        })
        expect(outcomeRowsOf(ZED, [{ operation: "zed.fetch", caseId: "ZED-1", isDefault: true }])[0]).toMatchObject({ current: "ok" })
    })

    it("puts an outcome the frame does not know after the known ones, and names a picked case that carries no outcome", () => {
        const row = outcomeRowsOf(QUX, [{ operation: "qux.make", caseId: "QUX-9", isDefault: false }])[0]
        expect(row?.options).toEqual(["ok", "refused", "banned"])
        expect(row).toMatchObject({ current: null, caseId: "QUX-9" })
    })

    it("draws nothing for an account with no outbound case", () => {
        expect(outcomeRowsOf([{ id: "A-1", direction: "inbound", operation: null, isDefault: false, outcome: null }], [])).toEqual([])
    })
})
