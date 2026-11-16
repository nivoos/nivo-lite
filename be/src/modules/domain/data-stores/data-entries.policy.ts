import {
    byteOrder,
    entryIntact,
    importOutcome,
    type DataEntry,
    type ImportReport,
    type SetImport,
} from "@modules/integrations/seed"
import { isDomainError } from "@modules/platform/errors"
import type { ImportTallies, ImportTally } from "./data-stores.contracts"
import { DataRefusalCode } from "./data-stores.policy"

/** What one step of a stream takes. */
export type EntryStep = (entry: DataEntry) => Promise<void>

/**
 * Takes the entries of a stream one at a time, in order: a step starts only after the one before it settled and the next entry is read only
 * then, so a stream of blobs is never held in memory whole. The first rejection stops the stream.
 */
export const eachEntryInOrder = async (entries: AsyncIterable<DataEntry>, step: EntryStep): Promise<void> => {
    const source = entries[Symbol.asyncIterator]()
    const next = async (): Promise<void> => {
        const taken = await source.next()
        if (taken.done === true) return
        await step(taken.value)
        return next()
    }
    await next()
}

/** What one read of a stream answers: an entry, or none (the read found nothing to yield). */
export type EntryRead<Item> = (item: Item) => Promise<DataEntry | null>

/**
 * A stream of the entries the reads answer, one item at a time: the read of the next item starts when the consumer asks for the next entry,
 * an item whose read answers null yields nothing.
 */
export const readInTurn = <Item>(
    items: ReadonlyArray<Item>,
    read: EntryRead<Item>,
): AsyncIterable<DataEntry, undefined> => ({
    [Symbol.asyncIterator]: (): AsyncIterator<DataEntry, undefined> => {
        let index = 0
        const next = async (): Promise<IteratorResult<DataEntry, undefined>> => {
            if (index >= items.length) return { done: true, value: undefined }
            const item = items[index]
            index += 1
            const entry = item === undefined ? null : await read(item)
            return entry === null ? next() : { done: false, value: entry }
        }
        return { next }
    },
})

/** The tally of a set, created empty on first use. */
export const tallyOf = (tallies: ImportTallies, set: string): ImportTally => {
    const found = tallies.get(set) ?? { created: 0, updated: 0, unchanged: 0, removed: 0, refused: [] }
    tallies.set(set, found)
    return found
}

/** Reports a key refused with its code. */
export const refuseKey = (count: ImportTally, key: string, code: string): void => {
    count.refused.push({ key, code })
}

/** Counts an entry written under a key nothing held before. */
export const countCreated = (count: ImportTally): void => {
    count.created += 1
}

/** Counts an entry written over a row the key held before. */
export const countUpdated = (count: ImportTally): void => {
    count.updated += 1
}

/** Counts an entry written: updated when the key held a row, else created. */
export const countWritten = <Held>(count: ImportTally, held: Held | null): void => {
    if (held === null) countCreated(count)
    else countUpdated(count)
}

/** The sets of an import in set byte order, as the report states them. */
export const setsOfTallies = (tallies: ImportTallies): ReadonlyArray<SetImport> =>
    [...tallies.entries()].sort(([left], [right]) => byteOrder(left, right)).map(([set, count]) => ({ set, ...count }))

/** The report of an import: its sets and the outcome they make. */
export const reportOf = (tallies: ImportTallies): ImportReport => {
    const sets = setsOfTallies(tallies)
    return { sets, outcome: importOutcome(sets) }
}

/** The code that refuses an entry of a record set before any door is asked, or null. */
export const recordRefusalOf = (entry: DataEntry): string | null => {
    if (entry.form !== "record") return DataRefusalCode.FormMismatch
    return entryIntact(entry) ? null : DataRefusalCode.EntryCorrupt
}

/** The refusal code of an error a door raised: a module error carries one; anything else is not a refusal. */
export const refusalCodeOf = (error: unknown): string | null => (isDomainError(error) ? String(error.code) : null)
