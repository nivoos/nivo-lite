/** Log events of the data copy jobs. */
export enum DataCopiesLogEvent {
    /** A backup wrote the export to its drivers (the result says how many items, which digest and which drivers hold it). */
    BackupDone = "data.backup.done",
    /** A backup found the export equal to the copy every driver already holds and wrote nothing. */
    BackupUnchanged = "data.backup.unchanged",
    /** A driver wrote its copy and warned (a copy nears its cap); the backup is not failed. */
    BackupWarning = "data.backup.warning",
    /** The deployment declares no backup settings (the reason names the keys): the ticks queue nothing and verify nothing. */
    BackupDisabled = "data.backup.disabled",
    /** A verify ended (the receipt says which copies, whether healthy, and the checks). */
    VerifyDone = "data.verify.done",
}
