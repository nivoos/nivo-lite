#!/usr/bin/env node
// `cells-author emit [--check] [--root <dir>] [--entry <file>]`: writes (or, with --check, compares) the seed files of a package repository.
// The entry module (default `cells.author.ts` in the root) default-exports the `AuthorProject` its builders made. Node 24 loads a `.ts` entry natively.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { diffFiles, emitProject } from "./emit"
import type { AuthorProject } from "./types"

const args = process.argv.slice(2)
const flag = (name: string): string | undefined => {
    const at = args.indexOf(name)
    return at === -1 ? undefined : args[at + 1]
}
const root = resolve(flag("--root") ?? ".")
const entry = resolve(root, flag("--entry") ?? "cells.author.ts")
const check = args.includes("--check")

const read = (path: string): string | null => {
    try {
        return readFileSync(resolve(root, path), "utf8")
    } catch {
        return null
    }
}

const main = async (): Promise<number> => {
    if (args[0] !== "emit") {
        console.error("usage: cells-author emit [--check] [--root <dir>] [--entry <file>]")
        return 2
    }
    // `require` (the package is CommonJS): Node 24 loads a compiled `.js` entry and a `.ts` entry (type stripping) the same way.
    const loaded = require(entry) as { default: AuthorProject }
    const files = emitProject(loaded.default, read)
    if (check) {
        const diffs = diffFiles(files, read)
        for (const diff of diffs) console.error(`${diff.path}: ${diff.reason}${diff.at === null ? "" : ` at character ${String(diff.at)}`}`)
        console.log(`cells-author emit --check: ${String(diffs.length)} file(s) differ of ${String(files.length)}`)
        return diffs.length > 0 ? 1 : 0
    }
    for (const file of files) {
        mkdirSync(dirname(resolve(root, file.path)), { recursive: true })
        writeFileSync(resolve(root, file.path), file.text)
    }
    console.log(`cells-author emit: ${String(files.length)} file(s) written`)
    return 0
}

main().then(
    (code) => process.exit(code),
    (error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error))
        process.exit(1)
    },
)
