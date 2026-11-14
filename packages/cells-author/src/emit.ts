import { compileSource, type ReadText } from "./compile"
import type { AuthorProject, CellFileData } from "./types"
import { yamlOf } from "./yaml"

/** One file the helper emits: its posix path relative to the package root and its exact text. */
export interface EmittedFile {
    readonly path: string
    readonly text: string
}

/** A file on disk that differs from what the helper emits. */
export interface EmitDiff {
    readonly path: string
    readonly reason: "missing" | "differs"
    /** The index of the first differing character; null when missing. */
    readonly at: number | null
}

/** The folder of one cell version: `cells/<kind>/<key>/v<version>`. */
export const cellDirOf = (cell: Pick<CellFileData, "kind" | "key" | "version">): string => `cells/${cell.kind}/${cell.key}/v${String(cell.version)}`

/** The origin of a compiled source: `run.js` comes from `run.ts` beside it. */
export const originOf = (source: string): string => source.replace(/\.js$/u, ".ts")

/**
 * Everything the helper writes for a project, sorted by path: the package file, the data file of every cell, the COMPILED source of every cell
 * that has one (from its `.ts` origin beside the data file) and the graph files. Byte-stable: the same project and sources give the same files.
 */
export const emitProject = (project: AuthorProject, read: ReadText): ReadonlyArray<EmittedFile> => {
    const files: Array<EmittedFile> = [{ path: "cells.package.yaml", text: yamlOf(project.package) }]
    for (const cell of project.cells) {
        const dir = cellDirOf(cell)
        files.push({ path: `${dir}/cell.yaml`, text: yamlOf(cell) })
        if (cell.source !== undefined) {
            if (!cell.source.endsWith(".js")) throw new Error(`${dir}/cell.yaml: source "${cell.source}" must be a .js file name (compiled from its .ts origin)`)
            if (cell.origin !== originOf(cell.source)) throw new Error(`${dir}/cell.yaml: origin must be "${originOf(cell.source)}" for source "${cell.source}"`)
            files.push({ path: `${dir}/${cell.source}`, text: compileSource(`${dir}/${originOf(cell.source)}`, read) })
        }
    }
    for (const graph of project.graphs) files.push({ path: `graphs/${graph.key}/v${String(graph.version)}/graph.yaml`, text: yamlOf(graph) })
    return files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
}

/** Compares emitted files with the disk (`emit --check`): a missing file or any differing byte is a diff; files the helper does not emit are not judged. */
export const diffFiles = (files: ReadonlyArray<EmittedFile>, read: ReadText): ReadonlyArray<EmitDiff> =>
    files.flatMap((file): ReadonlyArray<EmitDiff> => {
        const kept = read(file.path)
        if (kept === null) return [{ path: file.path, reason: "missing", at: null }]
        if (kept === file.text) return []
        let at = 0
        while (at < kept.length && at < file.text.length && kept[at] === file.text[at]) at += 1
        return [{ path: file.path, reason: "differs", at }]
    })
