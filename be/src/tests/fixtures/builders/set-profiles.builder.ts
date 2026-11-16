import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

/** The folder of the set profiles (data beside the code that reads it). */
export const SETS_DIR = join(__dirname, "..", "..", "..", "modules", "domain", "workspace-seed", "sets")

/** The names of the profile files, in the order the owner runs them. */
export const SET_NAMES: ReadonlyArray<string> = [
    "set-empty",
    "set-small-shop",
    "set-large",
    "set-conflicting",
    "set-multichannel",
    "set-clinic",
    "set-agency",
]

/** One profile file as the stack seed step wraps it for a command: one document on stdin. */
export const envelopeOf = (name: string): string =>
    JSON.stringify({ documents: [{ path: `sets/${name}.json`, document: JSON.parse(readFileSync(join(SETS_DIR, `${name}.json`), "utf8")) }] })

/** The profile files that exist in the folder, sorted (a spec checks that none is left out of `SET_NAMES`). */
export const profileFilesOnDisk = (): ReadonlyArray<string> =>
    readdirSync(SETS_DIR)
        .filter((file) => file.endsWith(".json"))
        .map((file) => file.replace(/\.json$/u, ""))
        .toSorted()
