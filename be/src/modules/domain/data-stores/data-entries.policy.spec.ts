import { Test } from "@nestjs/testing"
import { blobEntry, recordEntry, type DataEntry } from "@modules/integrations/seed"
import type { ImportTallies } from "./data-stores.contracts"
import { DataStoresError, DataStoresErrorCode } from "./errors/data-stores.error"
import {
    countCreated,
    countUpdated,
    countWritten,
    eachEntryInOrder,
    readInTurn,
    recordRefusalOf,
    refusalCodeOf,
    refuseKey,
    reportOf,
    setsOfTallies,
    tallyOf,
} from "./data-entries.policy"

const SUBJECT = Symbol("data-entries.policy")

const build = async () => {
    const moduleRef = await Test.createTestingModule({
        providers: [
            {
                provide: SUBJECT,
                useValue: {
                    countCreated,
                    countUpdated,
                    countWritten,
                    eachEntryInOrder,
                    readInTurn,
                    recordRefusalOf,
                    refusalCodeOf,
                    refuseKey,
                    reportOf,
                    setsOfTallies,
                    tallyOf,
                },
            },
        ],
    }).compile()
    return moduleRef.get<typeof import("./data-entries.policy")>(SUBJECT)
}

const pause = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

/** A stream of the given entries that records when each one is read from it. */
const recordingStream = (entries: ReadonlyArray<DataEntry>, events: Array<string>): AsyncIterable<DataEntry> => ({
    [Symbol.asyncIterator]: (): AsyncIterator<DataEntry> => {
        let index = 0
        return {
            next: async (): Promise<IteratorResult<DataEntry>> => {
                await pause()
                const entry = entries[index]
                index += 1
                if (entry === undefined) return { done: true, value: undefined }
                events.push(`read ${entry.key}`)
                return { done: false, value: entry }
            },
        }
    },
})

describe("eachEntryInOrder", () => {
    it("reads the next entry only after the step of the one before it settled", async () => {
        const subject = await build()
        const events: Array<string> = []
        const stream = recordingStream([recordEntry("s", "a", 1), recordEntry("s", "b", 2)], events)

        await subject.eachEntryInOrder(stream, async (entry) => {
            events.push(`start ${entry.key}`)
            await pause()
            events.push(`end ${entry.key}`)
        })

        expect(events).toEqual(["read a", "start a", "end a", "read b", "start b", "end b"])
    })

    it("stops at the first rejection: the entries after it are never taken", async () => {
        const subject = await build()
        const taken: Array<string> = []

        const stopped = subject.eachEntryInOrder(
            recordingStream([recordEntry("s", "a", 1), recordEntry("s", "b", 2)], []),
            async (entry) => {
                await pause()
                taken.push(entry.key)
                throw new DataStoresError({ code: DataStoresErrorCode.ScopeUnknown })
            },
        )

        await expect(stopped).rejects.toMatchObject({ code: DataStoresErrorCode.ScopeUnknown })
        expect(taken).toEqual(["a"])
    })
})

describe("readInTurn", () => {
    it("reads one item when the consumer asks for the next entry, and yields nothing for an item whose read answers null", async () => {
        const subject = await build()
        const reads: Array<string> = []
        const stream = subject.readInTurn(["a", "gone", "c"], async (key) => {
            await pause()
            reads.push(key)
            return key === "gone" ? null : blobEntry("files", key, new Uint8Array([1]), "text/plain")
        })
        const iterator = stream[Symbol.asyncIterator]()

        const first = await iterator.next()
        expect(reads).toEqual(["a"])
        const second = await iterator.next()
        const done = await iterator.next()

        expect(first.value?.key).toBe("a")
        expect(second.value?.key).toBe("c")
        expect(reads).toEqual(["a", "gone", "c"])
        expect(done.done).toBe(true)
    })
})

describe("the tallies of an import", () => {
    it("counts per set, creates the tally on first use, and states the sets in byte order with their outcome", async () => {
        const subject = await build()
        const tallies: ImportTallies = new Map()

        subject.countCreated(subject.tallyOf(tallies, "b"))
        subject.countUpdated(subject.tallyOf(tallies, "a"))
        subject.countWritten(subject.tallyOf(tallies, "a"), null)
        subject.countWritten(subject.tallyOf(tallies, "a"), { id: "held" })
        subject.refuseKey(subject.tallyOf(tallies, "c"), "k", "DATA_SET_UNKNOWN")

        expect(subject.setsOfTallies(tallies).map((count) => count.set)).toEqual(["a", "b", "c"])
        expect(tallies.get("a")).toMatchObject({ created: 1, updated: 2 })
        expect(subject.reportOf(tallies).outcome).toBe("partial")
    })
})

describe("the refusal of an entry", () => {
    it("refuses an entry of the wrong form or with a body that does not match its hash, by code", async () => {
        const subject = await build()
        const corrupt: DataEntry = { ...recordEntry("s", "k", { a: 1 }), sha256: "0".repeat(64) }

        expect(subject.recordRefusalOf(recordEntry("s", "k", { a: 1 }))).toBeNull()
        expect(subject.recordRefusalOf(blobEntry("s", "k", new Uint8Array([1]), "x/y"))).toBe("DATA_FORM_MISMATCH")
        expect(subject.recordRefusalOf(corrupt)).toBe("DATA_ENTRY_CORRUPT")
    })

    it("reads the code of a module's error, and none from anything else", async () => {
        const subject = await build()

        expect(subject.refusalCodeOf(new DataStoresError({ code: DataStoresErrorCode.RecordInvalid }))).toBe(
            "DATA_STORES_RECORD_INVALID",
        )
        expect(subject.refusalCodeOf(new Error("connection reset"))).toBeNull()
        expect(subject.refusalCodeOf("text")).toBeNull()
    })
})
