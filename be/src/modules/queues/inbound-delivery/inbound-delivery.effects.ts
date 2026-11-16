import type { JobEffectDeclaration } from "@modules/platform/jobs"

/**
 * The outside effect every inbound delivery job shares when its message carries files: the channel's address of one file is read and its
 * checked copy written to the shop's own store, under a path the message decides. The kept entry of the file (its address in the store, or
 * the typed reason it was not kept) is the result kept on the ledger, so a retried or resumed delivery keeps the same entry without
 * reading the channel again (its address expires); when the outcome was lost the read is made again under the same key (a read changes
 * nothing, the copy overwrites the same object).
 */
export const KEEP_FILE_EFFECT: JobEffectDeclaration = { name: "chat-files.keep", settle: "repeatable" }
