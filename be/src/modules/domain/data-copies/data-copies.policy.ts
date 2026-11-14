import {
    DataRefusal,
    type CopyReceipt,
    type CopyRun,
    type DataManifest,
    type DriverAdapter,
} from "@modules/integrations/seed"
import type { DomainError } from "@modules/platform/errors"
import { isRecord } from "@modules/platform/primitives"
import { classifyFailure } from "@modules/platform/queue"
import { dataCopyFailure } from "@modules/queues/data-copies"
import type { BackupCount, BackupWarning, KeptWrite } from "./data-copies.contracts"

/** The environment a manifest names as its source: the running deployment (the stack's own environment name belongs to the harness). */
export const SOURCE_ENVIRONMENT = "deployment"

/** The members of `all` the ids name; an id nothing provides is a missing setting (`config`: nothing can be written until a person binds it). */
export const membersOf = <T extends { readonly id: string }>(
    all: ReadonlyArray<T>,
    ids: ReadonlyArray<string>,
    what: string,
    setId: string,
): ReadonlyArray<T> =>
    ids.map((id) => {
        const found = all.find((member) => member.id === id)
        if (found === undefined)
            throw dataCopyFailure("config", `data set ${setId} names ${what} ${id}, which is not bound`)
        return found
    })

/** The items of the sets of a manifest. */
export const countsOf = (manifest: DataManifest): ReadonlyArray<BackupCount> =>
    manifest.sets.map((set) => ({ store: set.store, set: set.set, items: set.items }))

/** The warnings the legs of a run raised, by driver and code. */
export const warningsOf = (run: CopyRun): ReadonlyArray<BackupWarning> =>
    run.legs.flatMap((leg) => (leg.receipt?.warnings ?? []).map((code) => ({ driver: leg.driver, code })))

/** What of a receipt the ledger keeps. */
export const keptWriteOf = (receipt: CopyReceipt): KeptWrite => ({
    locator: receipt.ref.locator,
    exportDigest: receipt.ref.exportDigest,
    takenAt: receipt.ref.takenAt,
    bytes: receipt.bytes,
    changed: receipt.changed,
    warnings: [...receipt.warnings],
    at: receipt.at,
})

const isStrings = (value: unknown): value is ReadonlyArray<string> =>
    Array.isArray(value) && value.every((item) => typeof item === "string")

/** The write a ledger row kept, or null when the kept value is of another shape. */
const keptWriteFrom = (kept: unknown): KeptWrite | null => {
    if (!isRecord(kept) || !isStrings(kept.warnings)) return null
    const { locator, exportDigest, takenAt, bytes, changed, at } = kept
    if (
        typeof locator !== "string" ||
        typeof exportDigest !== "string" ||
        typeof takenAt !== "string" ||
        typeof at !== "string"
    )
        return null
    if (typeof bytes !== "number" || typeof changed !== "number") return null
    return { locator, exportDigest, takenAt, bytes, changed, warnings: kept.warnings, at }
}

/** The receipt a kept write stands for: the driver's own plan holds what was written. A kept value of another shape is refused (`input`). */
export const receiptFromKept = (driver: DriverAdapter, manifest: DataManifest, kept: unknown): CopyReceipt => {
    const write = keptWriteFrom(kept)
    if (write === null) throw dataCopyFailure("input", `kept copy write of driver ${driver.id} is unreadable`)
    return {
        schema: "starci/data-copy@1",
        ref: {
            driver: driver.id,
            kind: driver.kind,
            locator: write.locator,
            exportDigest: write.exportDigest,
            takenAt: write.takenAt,
        },
        holding: driver.plan(manifest),
        bytes: write.bytes,
        changed: write.changed,
        warnings: write.warnings,
        at: write.at,
    }
}

/** True when every driver's newest copy is the export (nothing changed since the last backup: nothing is written, nothing committed). */
export const heldEverywhere = (manifest: DataManifest, newestDigests: ReadonlyArray<string | null>): boolean =>
    newestDigests.length > 0 && newestDigests.every((digest) => digest === manifest.exportDigest)

/** True for a failure a driver raised that is no data refusal (the effects piece, a defect): the data package names its own refusals. */
const isForeign = (cause: unknown): boolean => cause !== undefined && !(cause instanceof DataRefusal)

/** What the copies written so far say, for the end of a failure's reason. */
const keptOf = (run: CopyRun): string => {
    const held = run.legs.filter((leg) => leg.outcome !== "failed").map((leg) => leg.driver)
    return held.length === 0 ? "no copy was written" : `copies kept by ${held.join(",")}`
}

/**
 * The failure a run ends with, or null when every driver holds the export. A configuration refusal (the copy outgrew git: `DATA_GIT_CAP_EXCEEDED`)
 * is never retried: a dead letter with ONE item for a person naming the driver and the code (the other copies are kept). A failure that is not
 * a data refusal (the effects piece, a bug) keeps the class the one classifier gives it. Any other leg failure is transient: the job is
 * tried again on its ladder, and a driver that already holds the export answers from the ledger without writing twice.
 */
export const backupFailureOf = (
    setId: string,
    run: CopyRun,
    raised: ReadonlyMap<string, unknown>,
): DomainError<string> | null => {
    const failed = run.legs.filter((leg) => leg.outcome === "failed")
    const [first] = failed
    if (first === undefined) return null
    const kept = keptOf(run)
    const configuration = failed.find((leg) => leg.failure?.retry === "configuration")
    if (configuration !== undefined) {
        const reason = `backup of ${setId}: driver ${configuration.driver} refused with ${configuration.failure?.code ?? "unknown"} (${kept})`
        return dataCopyFailure("config", reason, raised.get(configuration.driver))
    }
    const foreign = failed.find((leg) => isForeign(raised.get(leg.driver)))
    if (foreign !== undefined) {
        const cause = raised.get(foreign.driver)
        return dataCopyFailure(
            classifyFailure(cause),
            `backup of ${setId}: driver ${foreign.driver} failed unexpectedly (${kept})`,
            cause,
        )
    }
    const reason = `backup of ${setId}: driver ${first.driver} failed with ${first.failure?.code ?? "unknown"} (${kept})`
    return dataCopyFailure("transient", reason, raised.get(first.driver))
}

/**
 * A data refusal as a typed failure with its class: the retry class `configuration` (the copy outgrew git, a missing driver) is never retried,
 * `transient` goes to the ladder. A store that failed to read (`DATA_STORE_FAILED` is a configuration refusal of the data package) whose own
 * cause the one classifier calls transient (the database was away for a moment) is transient too.
 */
export const dataRefusalFailure = (cause: DataRefusal): DomainError<string> => {
    const storeAway = cause.code === "DATA_STORE_FAILED" && classifyFailure(cause.cause) === "transient"
    const permanent = cause.retry === "configuration" && !storeAway
    return dataCopyFailure(permanent ? "config" : "transient", cause.code, cause)
}
