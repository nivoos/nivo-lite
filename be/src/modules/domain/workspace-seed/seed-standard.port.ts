import type { SealedValues } from "./set-seed.contracts"
import type { ForceKind } from "./set-seed.contracts"

/** The pin a stack names a workspace seed by (`nivo/seed-standard@1`): the `-seed` repo and the one commit it is applied at. */
export interface SeedStandardRef {
    /** The repo's name, ending `-seed` (`blocks-core-seed`). */
    readonly name: string
    /** Where the repo is fetched from (a git remote, or a local repository path on the owner's machine). */
    readonly repository: string
    /** The pinned commit, 40 hex digits. */
    readonly commit: string
    /** The force the stack declares (R103): re-seed once at this commit, keeping relations. */
    readonly force: boolean
    /** The kinds whose person-made changes the force overwrites. */
    readonly forceKinds: ReadonlyArray<ForceKind>
    /** The owner's sign-in address the stack declares (`owner`), or null: the owner of the document's `ownerWorkspace`. */
    readonly ownerEmail: string | null
}

/**
 * One `-seed` repo AT ITS PINNED COMMIT, as the data driver hands it over: the driver fetched it into a cache outside every app tree and
 * verified the commit; every read is of that commit. The sealed file is opened IN MEMORY only (sops on stdin/stdout, never a plaintext file);
 * a file the driver cannot open answers `{ opened: false, reason }`, never throws a value and never falls back to plaintext.
 */
export interface SeedStandardCheckout {
    /** The text of a repo-relative file at the pinned commit, or null when the commit holds no such file. */
    readText(path: string): Promise<string | null>
    /** The secret members of ONE sealed file (the place's `secrets.<dev|prod>.enc.yaml`), opened in memory. */
    sealedOf(path: string): Promise<SealedValues>
}

/**
 * The seam to the harness's DATA DRIVER (R99/R100: HARNESS-DATA owns fetching, pinning, sealing and the repository layout; this app owns
 * the document and its applier). A driver that cannot reach the repo or does not find the commit throws `WORKSPACE_SEED_PIN_UNVERIFIED`.
 */
export interface SeedStandardDriver {
    /** Fetches the repo the ref names into the driver's cache and answers it at the pinned commit. */
    checkout(ref: SeedStandardRef): Promise<SeedStandardCheckout>
}

/** A checkout of a `-seed` repo the EXPORT door writes into (a working tree; the person reviews, commits and re-pins: the export never touches the pin). */
export interface SeedStandardTarget {
    /** The text of a repo-relative file of the working tree, or null when there is none. */
    readText(path: string): Promise<string | null>
    /** Writes a repo-relative text file; true when its content changed. */
    writeText(path: string, text: string): Promise<boolean>
    /**
     * Seals the given secret members into ONE sealed file (the current place's `secrets.<dev|prod>.enc.yaml`) THROUGH the encrypt function
     * (sops, fed on stdin with the repo's own recipients for that file: public keys only), MERGING: each given member is set, every other
     * member of the file is kept; the values never reach a file, an argument, a log or an error. True when it wrote.
     */
    seal(path: string, values: Readonly<Record<string, Readonly<Record<string, string>>>>): Promise<boolean>
}

/** Opens the export target the driver writes through. */
export interface SeedStandardTargets {
    /** The checkout at a local path (refused unless it is a `-seed` repo's working tree). */
    open(path: string): Promise<SeedStandardTarget>
}

/** One node step's settings as a door step sends them: the module's workflow by key, the node, its mode and the accounts in try order. */
export interface SeedNodeDoor {
    readonly module: string
    readonly workflow: string
    readonly node: string
    readonly mode: string | null
    /** Connection ids in try order, or null to keep the choice. */
    readonly accountIds: ReadonlyArray<string> | null
}

/**
 * THE DOOR STEPS of a seed, through the app's own judged doors AS THE WORKSPACE'S OWNER (the same doors a person uses: the settings door
 * for the time zone, `setNodeSettings` for a step, which judges every account against the agent's attachments and the sandbox switch).
 * A refusal throws the door's typed error; the seed records its code in the receipt.
 */
export interface SeedDoorsPort {
    setTimeZone(workspaceId: string, ownerId: string, timeZone: string): Promise<void>
    setNodeSettings(workspaceId: string, ownerId: string, step: SeedNodeDoor): Promise<void>
    /**
     * Turns one trigger switch of an account to the declared state through the one switch door (from now: no catch-up). Answers `set`
     * when it changed it, `kept` when it already was so, and `used` when it differs but the trigger has fired and `overwriteUsed` is off
     * (a switch in use is a person's world: a re-seed leaves it).
     */
    setSwitch(workspaceId: string, ownerId: string, step: SeedSwitchDoor, overwriteUsed: boolean): Promise<"set" | "kept" | "used">
}

/** One trigger switch as a door step sends it: the account by connection id, the trigger's name and the declared state. */
export interface SeedSwitchDoor {
    readonly connectionId: string
    readonly trigger: string
    readonly enabled: boolean
}
