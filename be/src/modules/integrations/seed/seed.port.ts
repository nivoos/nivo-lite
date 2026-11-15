import type { DriverAdapter, OpenContext } from "@starci/seed"
import type { createGitDriver, openReviewTree, pinRepository } from "@starci/seed/git"
import type { postgresStore } from "@starci/seed/postgres"
import type { OwnerConnection } from "@modules/platform/database"

/** Where a repository is fetched from and which commit it is read at. */
export interface SeedPinRequest {
    /** A git remote URL (never one holding a credential) or a local repository path. */
    readonly repository: string
    /** The commit, 40 hex digits. */
    readonly commit: string
    /** The mirror's folder name under the cache (the repository's name). */
    readonly name: string
}

/** Why a sealed file gave no text: a fixed word, never a value. */
export type SeedSealedReason = "identity_missing" | "file_missing" | "not_openable"

/** The text of a sealed file opened in memory, or the fixed reason it gave none. */
export type SeedSealedRead =
    { readonly opened: true; readonly text: string } | { readonly opened: false; readonly reason: SeedSealedReason }

/** The text of a file, or null when there is none. */
export type SeedFileText = string | null

/** What a pin gave: the repository at its commit, or why it could not be reached or lacks the commit (the cause, never a value). */
export type SeedPinOutcome =
    { readonly ok: true; readonly value: PinnedSeed } | { readonly ok: false; readonly cause: unknown }

/** What opening a working tree gave: the tree, or why the folder is not a git tree. */
export type SeedReviewOutcome =
    { readonly ok: true; readonly value: ReviewSeed } | { readonly ok: false; readonly cause: unknown }

/** A repository at its pinned commit: every read is of that commit. */
export interface PinnedSeed {
    /** The text of a repository-relative file at the commit, or null when the commit holds no such file. */
    readText(path: string): SeedFileText
    /** The text of a sops-sealed file of the commit, opened in memory with the environment's identity. */
    sealedText(path: string): SeedSealedRead
}

/** A working tree a person reviews and commits. */
export interface ReviewSeed {
    /** The text of a tree-relative file, or null. */
    readText(path: string): SeedFileText
    /** Writes a tree-relative text file; true when its content changed. */
    writeText(path: string, text: string): boolean
    /** Seals a plaintext document into `path` with the tree's own sops rule for it (the text reaches sops's stdin only); true when it wrote. */
    sealText(path: string, plaintext: string): boolean
}

/** What a backup copy repository is made of. */
export interface BackupDriverRequest {
    /** The driver id the stack manifest declares. */
    readonly id: string
    /** The local working copy (outside every code repository). */
    readonly checkout: string
    /** The remote URL, or undefined for a local copy only. */
    readonly remote: string | undefined
}

/** The git layer of the data standard: pinned reads, review trees and the backup copy driver, all with the integration's settings. */
export interface SeedGitPort {
    /** Fetches the repository and answers it at the pinned commit, or why it could not be reached or lacks the commit. */
    pin(request: SeedPinRequest): Promise<SeedPinOutcome>
    /** Opens a working tree for review writes, or says that the folder is not a git tree. */
    review(path: string): Promise<SeedReviewOutcome>
    /** The git driver of one backup copy repository. */
    backupDriver(request: BackupDriverRequest): DriverAdapter
    /** The handle a verify opens a copy with: the identity of this environment (an empty handle when none is declared). */
    openContext(): OpenContext
}

/** The functions of the git layer of `@starci/seed` the integration calls (injected, so a spec runs no git). */
export interface SeedGitLibrary {
    /** Fetches a repository into its bare mirror and answers it at a pinned commit. */
    readonly pinRepository: typeof pinRepository
    /** Opens a git working tree for review writes. */
    readonly openReviewTree: typeof openReviewTree
    /** Builds the git driver over a local working copy. */
    readonly createGitDriver: typeof createGitDriver
}

/** The function of the postgres layer of `@starci/seed` the integration calls (injected, so a spec runs no database). */
export interface SeedPostgresLibrary {
    /** Builds a store over a whole PostgreSQL database. */
    readonly postgresStore: typeof postgresStore
}

/** Builds the dedicated owner-role connection of the whole-database store. */
export interface SeedDatabaseConnector {
    /** The connection for a connection URL; nothing is opened until `initialize`. */
    connect(url: string): OwnerConnection
}
