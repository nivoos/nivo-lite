import { readdirSync, readFileSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { Test } from "@nestjs/testing"
import { parse, stringify } from "yaml"
import { mock } from "@starci/jest-preset"
import type { EntityManager } from "typeorm"
import {
    CELL_DEFINITIONS_WRITER,
    CELL_READER,
    CELL_RUNNER,
    CellSeedService,
    CellValidationService,
    CellJsonSchemaPolicy,
    type CellPackageFiles,
    type CellReader,
    type CellRunner,
} from "@modules/domain/cells"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { MemoryCellDefinitionsWriter, ScriptedCellRunner } from "./cells.builder"

/*
 * Builders of the seed specs (slice S2): the two fixture packages read from `fixtures/cells`, small edits of a package, and the seed service built over
 * the writer double, a scripted runner and an EntityManager double that runs each transaction on itself.
 */

/** The folder of the fixture packages. */
const FIXTURES = join(__dirname, "..", "cells")

/** The two fixture packages. */
export const FIXTURE_PACKAGES = ["demo-money", "demo-crm-lead"] as const

/** The pinned origin the specs seed at. */
export const ORIGIN = { repository: "file:fixtures/cells", commit: "a".repeat(40) } as const

/** Reads one fixture package into the map of files the seed takes. */
export const packageFiles = (name: string): Map<string, string> => {
    const root = join(FIXTURES, name)
    const found = new Map<string, string>()
    const walk = (directory: string): void => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const path = join(directory, entry.name)
            if (entry.isDirectory()) walk(path)
            else if (/\.(ya?ml|js|ts)$/u.test(entry.name))
                found.set(relative(root, path).split(sep).join("/"), readFileSync(path, "utf8"))
        }
    }
    walk(root)
    return found
}

/** A copy of the files with one file's text changed (or added). */
export const edited = (
    files: CellPackageFiles,
    path: string,
    change: (text: string) => string,
): Map<string, string> => {
    const copy = new Map(files)
    copy.set(path, change(copy.get(path) ?? ""))
    return copy
}

/** A parsed yaml document a spec changes in place (the shape of a fixture file is the author's, so a spec never edits its text). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type YamlDocument = any

/** A copy of the files with one yaml file parsed, changed by `mutate` and written back, whatever layout the file had. */
export const editedYaml = (
    files: CellPackageFiles,
    path: string,
    mutate: (document: YamlDocument) => void,
): Map<string, string> => {
    const document: YamlDocument = parse(files.get(path) ?? "")
    mutate(document)
    const copy = new Map(files)
    copy.set(path, stringify(document))
    return copy
}

/** A copy of the files without the ones under a folder. */
export const withoutFolder = (files: CellPackageFiles, folder: string): Map<string, string> =>
    new Map([...files].filter(([path]) => !path.startsWith(`${folder}/`)))

/** The EntityManager double: a transaction runs its work on the same manager (the receipts are the writer double's, read through the port). */
const transactionalManager = (): EntityManager => {
    const manager = mock<EntityManager>()
    manager.transaction.mockImplementation(((work: (inner: EntityManager) => Promise<unknown>) =>
        work(manager)) as never)
    return manager
}

/** The seed service built over its doubles. */
export const buildSeed = async (
    options: { readonly problems?: ReadonlyArray<string>; readonly reader?: CellReader } = {},
): Promise<{
    readonly seed: CellSeedService
    readonly validation: CellValidationService
    readonly writer: MemoryCellDefinitionsWriter
    readonly runner: ScriptedCellRunner
    readonly manager: EntityManager
}> => {
    const writer = new MemoryCellDefinitionsWriter()
    const runner = new ScriptedCellRunner(undefined, options.problems ?? [])
    const manager = transactionalManager()
    const moduleRef = await Test.createTestingModule({
        providers: [
            CellSeedService,
            CellValidationService,
            CellJsonSchemaPolicy,
            CellJsonSchemaPolicy,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: manager },
            { provide: CELL_DEFINITIONS_WRITER, useValue: writer },
            { provide: CELL_RUNNER, useValue: runner satisfies CellRunner },
            ...(options.reader === undefined ? [] : [{ provide: CELL_READER, useValue: options.reader }]),
        ],
    }).compile()
    return {
        seed: moduleRef.get(CellSeedService),
        validation: moduleRef.get(CellValidationService),
        writer,
        runner,
        manager,
    }
}
