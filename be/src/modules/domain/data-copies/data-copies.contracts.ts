import type { CopyVerdict, VerifyCheck } from "@modules/integrations/seed"

/** One data set a deployment keeps copies of: which stores it reads, which drivers hold the copies and how often. */
export interface DataSetDeclaration {
    /** The set's id; the copy name of its manifest is `<id>-seed-backup@1`. */
    readonly id: string
    /** Why it is copied: this job writes only a seed-backup (a seed-standard is never written by it). */
    readonly purpose: "seed-backup"
    /** The store ids it reads (ids of the data stores). */
    readonly stores: ReadonlyArray<string>
    /** The driver ids that each hold a copy (ids of the data drivers). */
    readonly drivers: ReadonlyArray<string>
    /** How often a backup is due, in minutes. */
    readonly everyMinutes: number
}

/** How many items one set of the export holds. */
export interface BackupCount {
    /** The store the set was read from. */
    readonly store: string
    /** The set. */
    readonly set: string
    /** The items. */
    readonly items: number
}

/** A warning a driver raised while it wrote (a copy near its cap): by driver and code. */
export interface BackupWarning {
    /** The driver. */
    readonly driver: string
    /** The code, e.g. `DATA_GIT_CAP_NEAR`. */
    readonly code: string
}

/** The result of one backup: when, what it holds, which drivers hold it. Logged; the copies' own manifests are the durable record (no table). */
export interface DataBackupResult {
    /** The data set. */
    readonly setId: string
    /** When the backup ran (ISO). */
    readonly at: string
    /** `unchanged`: every driver already held this export and nothing was written; `written`: every driver holds it now. */
    readonly outcome: "unchanged" | "written"
    /** The identity of the export. */
    readonly exportDigest: string
    /** Items per set. */
    readonly counts: ReadonlyArray<BackupCount>
    /** The drivers that hold the export. */
    readonly drivers: ReadonlyArray<string>
    /** What the drivers warned. */
    readonly warnings: ReadonlyArray<BackupWarning>
}

/** What a write of one driver keeps on the effect ledger row (JSON of plain values): enough to rebuild the receipt a replayed job answers with. */
export type KeptWrite = {
    /** Where the copy is (`CopyRef.locator`). */
    readonly locator: string
    /** The export the copy holds. */
    readonly exportDigest: string
    /** When the export was taken (ISO). */
    readonly takenAt: string
    /** The bytes the copy holds. */
    readonly bytes: number
    /** How many entries the write changed. */
    readonly changed: number
    /** The warnings the driver raised. */
    readonly warnings: ReadonlyArray<string>
    /** When the write ended (ISO). */
    readonly at: string
}

/** One copy a verify looked at. */
export interface VerifiedCopy {
    /** The driver that holds it. */
    readonly driver: string
    /** Where it is (`CopyRef.locator`). */
    readonly ref: string
    /** The export it holds. */
    readonly exportDigest: string
    /** True when the driver's verify and the restore into scratch both passed. */
    readonly healthy: boolean
    /** The driver's checks, then `restore` (the scratch export equals the manifest, set by set). */
    readonly checks: ReadonlyArray<VerifyCheck>
}

/** The receipt of the verify of one data set: when, which copies, whether healthy, with their checks, and what a person must read (empty when all is well). */
export interface DataVerifyReceipt {
    /** The data set. */
    readonly setId: string
    /** When the verify ran (ISO). */
    readonly at: string
    /** True when every copy is healthy and the copies agree. */
    readonly healthy: boolean
    /** The newest copy of each driver that holds one. */
    readonly copies: ReadonlyArray<VerifiedCopy>
    /** What is wrong: codes and ids only, never a value. */
    readonly findings: ReadonlyArray<string>
}

/** What the verify of one driver found: its verdict and copy when it holds one, and what is wrong with it. */
export interface DriverVerification {
    /** The driver's verdict on its newest copy; absent when it holds none. */
    readonly verdict: CopyVerdict | null
    /** The copy looked at; absent when the driver holds none. */
    readonly copy: VerifiedCopy | null
    /** What is wrong with it (empty when healthy). */
    readonly findings: ReadonlyArray<string>
}

/** The reason no backup runs, or none when it does. */
export type MaybeReason = string | null
