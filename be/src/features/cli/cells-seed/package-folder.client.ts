import { readdir, readFile } from "node:fs/promises"
import { join, relative, sep } from "node:path"
import { Injectable } from "@nestjs/common"

/** The files of a package folder the seed reads: data, sources and their origins. */
const READ = /\.(ya?ml|js|ts)$/u
/** Folders that are never part of a package. */
const SKIPPED: ReadonlySet<string> = new Set([".git", "node_modules"])

@Injectable()
/** Reads a package folder (a checkout of the package repository at its pinned commit) into the map of text files the seed judges. */
export class PackageFolderClient {
    /** Every `.yaml`, `.yml`, `.js` and `.ts` file under the folder, by path relative to it with forward slashes. */
    async read(folder: string): Promise<ReadonlyMap<string, string>> {
        const found = new Map<string, string>()
        const walk = async (directory: string): Promise<void> => {
            const entries = await readdir(directory, { withFileTypes: true })
            await Promise.all(
                entries.map(async (entry) => {
                    const path = join(directory, entry.name)
                    if (entry.isDirectory()) return SKIPPED.has(entry.name) ? undefined : walk(path)
                    if (entry.isFile() && READ.test(entry.name)) found.set(relative(folder, path).split(sep).join("/"), await readFile(path, "utf8"))
                    return undefined
                }),
            )
        }
        await walk(folder)
        return found
    }
}
