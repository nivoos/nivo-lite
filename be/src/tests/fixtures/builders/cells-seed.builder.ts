import { readdirSync, readFileSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import type { EntityManager } from "typeorm"
import {
    CELL_DEFINITIONS_WRITER,
    CELL_READER,
    CELL_RUNNER,
    CellSeedService,
    CellValidationService,
    type CellPackageFile,
    type CellPackageFiles,
    type CellPackageOrigin,
    type CellReader,
    type CellRunner,
    type SeedReceiptInput,
    type ValidatedCell,
    type ValidatedGraph,
} from "@modules/domain/cells"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { MemoryCellDefinitionsWriter, ScriptedCellRunner } from "./cells.builder"

/*
 * Builders of the seed specs (slice S2): the two fixture packages read from `fixtures/cells`, small edits of a package, and the seed service built over
 * the writer double, a scripted runner and an EntityManager double whose receipts are the writer double's.
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
            else if (/\.(ya?ml|js|ts)$/u.test(entry.name)) found.set(relative(root, path).split(sep).join("/"), readFileSync(path, "utf8"))
        }
    }
    walk(root)
    return found
}

/** A copy of the files with one file's text changed (or added). */
export const edited = (files: CellPackageFiles, path: string, change: (text: string) => string): Map<string, string> => {
    const copy = new Map(files)
    copy.set(path, change(copy.get(path) ?? ""))
    return copy
}

/** A copy of the files without the ones under a folder. */
export const withoutFolder = (files: CellPackageFiles, folder: string): Map<string, string> =>
    new Map([...files].filter(([path]) => !path.startsWith(`${folder}/`)))

/** The writer double with the real writer's package rule: a package version is one row whatever commit it is read from, so a new pin of the same files writes the same rows. */
class SeedWriterDouble extends MemoryCellDefinitionsWriter {
    override putPackage(manager: EntityManager, file: CellPackageFile, origin: CellPackageOrigin): Promise<string> {
        return super.putPackage(manager, file, { ...origin, commit: "" })
    }

    /** The review reference names the commit, which is not part of a row's content (the real hash is of the content and the source). */
    override putDefinition(manager: EntityManager, packageId: string, candidate: ValidatedCell): Promise<"created" | "unchanged"> {
        return super.putDefinition(manager, packageId, { ...candidate, reviewRef: null })
    }

    override putGraph(manager: EntityManager, packageId: string, graph: ValidatedGraph): Promise<"created" | "unchanged"> {
        return super.putGraph(manager, packageId, { ...graph, reviewRef: null })
    }
}

/** The EntityManager double: a transaction runs its work on the same manager; the receipts are the writer double's. */
const managerOver = (writer: MemoryCellDefinitionsWriter): EntityManager => {
    const manager = mock<EntityManager>()
    const where = (options: unknown): Partial<SeedReceiptInput> => (Reflect.get(Object(options), "where") ?? {}) as Partial<SeedReceiptInput>
    const matches = (receipt: SeedReceiptInput, wanted: Partial<SeedReceiptInput>): boolean =>
        Object.entries(wanted).every(([name, value]) => Reflect.get(receipt, name) === value)
    manager.transaction.mockImplementation(((work: (inner: EntityManager) => Promise<unknown>) => work(manager)) as never)
    manager.exists.mockImplementation(((_entity: unknown, options: unknown) => Promise.resolve(writer.receipts.some((receipt) => matches(receipt, where(options))))) as never)
    manager.find.mockImplementation(((_entity: unknown, options: unknown) =>
        Promise.resolve(writer.receipts.filter((receipt) => matches(receipt, { packageKey: where(options).packageKey ?? "" })).slice(-1))) as never)
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
    const writer = new SeedWriterDouble()
    const runner = new ScriptedCellRunner(undefined, options.problems ?? [])
    const manager = managerOver(writer)
    const moduleRef = await Test.createTestingModule({
        providers: [
            CellSeedService,
            CellValidationService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: manager },
            { provide: CELL_DEFINITIONS_WRITER, useValue: writer },
            { provide: CELL_RUNNER, useValue: runner satisfies CellRunner },
            ...(options.reader === undefined ? [] : [{ provide: CELL_READER, useValue: options.reader }]),
        ],
    }).compile()
    return { seed: moduleRef.get(CellSeedService), validation: moduleRef.get(CellValidationService), writer, runner, manager }
}
