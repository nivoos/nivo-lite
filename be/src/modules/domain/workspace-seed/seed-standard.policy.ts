import { parseJsonText } from "@modules/platform/primitives"
import { WorkspaceSeedError, WorkspaceSeedErrorCode } from "./errors/workspace-seed.error"
import type { SeedStandardRef } from "./seed-standard.port"
import { FORCE_KINDS, type ForceKind } from "./set-seed.contracts"

/** The schema of a seed standard's declaration in the stack: the repo, its ONE pinned commit, and the force a bring-up may consume. */
export const SEED_STANDARD_SCHEMA = "nivo/seed-standard@1"

/** The suffix of a seed standard's repository (R101: the suffix is law). */
export const SEED_STANDARD_SUFFIX = "-seed-standard"

/**
 * The marker a stack declaration of a seed standard carries (R106): its COMPLETENESS is judged by this project's own extension check
 * (`ext/checks/seed-standards.mjs`), not by the harness, which judges only the generic data standard (sealed, pinned, under the cap).
 */
export const SEED_STANDARD_COMPLETENESS = "ext:seed-standards"

/** The file of a seed standard that holds its one document. */
export const SEED_DOCUMENT_PATH = "seed.json"

/**
 * The ONLY sealed files of a seed standard (R107): the credentials, one file per place, the same member NAMES in both; everything else in
 * the repository is plain data. The applier reads the file of the place it runs in and never the other.
 */
export const SEALED_FILES = { local: "secrets.dev.enc.yaml", prod: "secrets.prod.enc.yaml" } as const

/** The sealed file of the place a run applies to. */
export const sealedPathOf = (place: "local" | "prod"): string => SEALED_FILES[place]

/** One file of a standard at its commit, as the layout rule reads it: its path and whether it carries sops metadata. */
export interface StandardFile {
    readonly path: string
    readonly sealed: boolean
}

/**
 * THE LAYOUT RULE of a seed standard (R107), structural, never a test of words: the two credential files are sealed and are the only
 * sealed files (a sealed data file, or a single `secrets.enc.yaml` / a `secrets/` folder, is refused); the one document is present.
 */
export const layoutProblemsOf = (files: ReadonlyArray<StandardFile>): ReadonlyArray<string> => {
    const allowed = new Set<string>(Object.values(SEALED_FILES))
    const problems: Array<string> = []
    if (!files.some((file) => file.path === SEED_DOCUMENT_PATH)) problems.push(`${SEED_DOCUMENT_PATH}: missing`)
    for (const file of files) {
        if (allowed.has(file.path) && !file.sealed) problems.push(`${file.path}: not sealed`)
        if (!allowed.has(file.path) && file.sealed) problems.push(`${file.path}: sealed, but a standard's data is plain (only ${[...allowed].join(" and ")} are sealed)`)
        if (!allowed.has(file.path) && /(^|\/)secrets([./]|$)/u.test(file.path)) problems.push(`${file.path}: credentials live only in ${[...allowed].join(" and ")}`)
    }
    return problems
}

const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/u
const COMMIT = /^[0-9a-f]{40}$/u
const KINDS: ReadonlySet<string> = new Set(FORCE_KINDS)

const invalid = (field: string): never => {
    throw new WorkspaceSeedError({ code: WorkspaceSeedErrorCode.InputInvalid, params: { field } })
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
    value !== null && typeof value === "object" && !Array.isArray(value)

/**
 * Reads one declaration: the repo's name (a `-seed-standard`), where it is fetched from, the pinned commit (a declaration without one is
 * refused), and the FORCE (R103: a member of the stack's declaration, never a cli flag; consumed once per pinned commit) with the kinds
 * whose person-made changes it overwrites.
 */
export const readSeedStandardRef = (document: unknown): SeedStandardRef => {
    if (!isRecord(document) || document.schema !== SEED_STANDARD_SCHEMA) return invalid("schema")
    const name = typeof document.name === "string" && NAME.test(document.name) ? document.name : invalid("name")
    if (!name.endsWith(SEED_STANDARD_SUFFIX)) invalid("name")
    const repository = typeof document.repository === "string" && document.repository.trim() !== "" ? document.repository.trim() : invalid("repository")
    const commit = typeof document.commit === "string" && COMMIT.test(document.commit) ? document.commit : invalid("commit")
    if (document.completeness !== SEED_STANDARD_COMPLETENESS) invalid("completeness")
    if (document.force !== undefined && typeof document.force !== "boolean") invalid("force")
    const kinds = document.forceKinds === undefined ? [] : Array.isArray(document.forceKinds) ? document.forceKinds : invalid("forceKinds")
    if (kinds.some((kind) => typeof kind !== "string" || !KINDS.has(kind))) invalid("forceKinds")
    if (kinds.length > 0 && document.force !== true) invalid("forceKinds")
    return { name, repository, commit, force: document.force === true, forceKinds: kinds as ReadonlyArray<ForceKind> }
}

/** The declarations the stack seed step hands on stdin (the envelope `{documents:[{path,document}]}`), one per document. */
export const readSeedStandardRefs = (input: string): ReadonlyArray<SeedStandardRef> => {
    const read = parseJsonText(input)
    const envelope = read.ok ? read.value : invalid("input")
    if (!isRecord(envelope) || !Array.isArray(envelope.documents) || envelope.documents.length === 0) return invalid("input")
    return (envelope.documents as ReadonlyArray<unknown>).map((entry) => (isRecord(entry) ? readSeedStandardRef(entry.document) : invalid("input")))
}

/** What a bring-up does with a declared standard, given its receipt (R102 + R103). */
export type SeedDecision =
    | { readonly act: "seed" }
    | { readonly act: "reseed"; readonly since: string }
    | { readonly act: "skip"; readonly why: string }

/** The receipt of a standard in one environment: which commit was applied, which commit a force was consumed at, when. */
export interface SeedReceipt {
    readonly name: string
    readonly environment: string
    readonly workspaceId: string
    readonly commit: string
    readonly forcedCommit: string | null
    readonly appliedAt: string
    /** The outcome of each DOOR step the door script sent after the seed (time zone, node settings), as last recorded; empty = none yet. */
    readonly doors: ReadonlyArray<SeedDoorOutcome>
}

/** One door step's outcome: done, or FAILED with the typed code the door answered (never a value). */
export interface SeedDoorOutcome {
    /** What the step is (`settings timeZone`, `node chatbot.front-desk/answer`). */
    readonly step: string
    readonly outcome: "done" | "failed"
    /** The typed code of a refusal, or null. */
    readonly code: string | null
}

const STEP = /^[\w .:/-]{1,200}$/u
const CODE = /^[A-Z][A-Z0-9_]{0,99}$/u

/** Reads the door outcomes the door script reports (`{standards: {<name>: [{step, outcome, code?}]}}`); anything else is refused by field. */
export const readDoorOutcomes = (input: string): ReadonlyMap<string, ReadonlyArray<SeedDoorOutcome>> => {
    const read = parseJsonText(input)
    const root = read.ok && isRecord(read.value) && isRecord(read.value.standards) ? read.value.standards : invalid("input")
    return new Map(
        Object.entries(root).map(([name, steps]) => {
            if (!NAME.test(name) || !Array.isArray(steps)) return invalid("standards")
            return [
                name,
                steps.map((step: unknown): SeedDoorOutcome => {
                    if (!isRecord(step) || typeof step.step !== "string" || !STEP.test(step.step)) return invalid("step")
                    if (step.outcome !== "done" && step.outcome !== "failed") return invalid("outcome")
                    const code = step.code === undefined || step.code === null ? null : typeof step.code === "string" && CODE.test(step.code) ? step.code : invalid("code")
                    return { step: step.step, outcome: step.outcome, code }
                }),
            ]
        }),
    )
}

/** The door steps of a receipt in one line: none sent yet, all done, or the FAILED ones with their codes. */
export const doorsLineOf = (doors: ReadonlyArray<SeedDoorOutcome>): string => {
    if (doors.length === 0) return "door steps: none recorded yet"
    const failed = doors.filter((one) => one.outcome === "failed")
    return failed.length === 0
        ? `door steps: ${String(doors.length)} done`
        : `door steps: ${String(failed.length)} of ${String(doors.length)} FAILED (${failed.map((one) => `${one.step}: ${one.code ?? "unknown"}`).join("; ")})`
}

/**
 * LOADED ONCE: no receipt = seed; a receipt = nothing (skipped whole, not even a find pass), unless the declaration says `force` and the
 * force was not yet consumed at this pinned commit: then a re-seed that keeps relations. A new pin without force is only reported.
 */
export const seedDecisionOf = (ref: SeedStandardRef, receipt: SeedReceipt | null): SeedDecision => {
    if (receipt === null) return { act: "seed" }
    if (ref.force && receipt.forcedCommit !== ref.commit) return { act: "reseed", since: receipt.appliedAt }
    if (receipt.commit === ref.commit) {
        return { act: "skip", why: `already seeded at ${receipt.commit}${receipt.forcedCommit === ref.commit ? " (force consumed at this commit)" : ""}; ${doorsLineOf(receipt.doors)}` }
    }
    return { act: "skip", why: `standard changed since it was seeded (${receipt.commit} -> ${ref.commit}): declare force on its stack declaration to re-seed` }
}
