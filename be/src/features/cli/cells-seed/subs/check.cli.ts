import { CommandRunner, Option, SubCommand } from "nest-commander"
import { CellSeedService } from "@modules/domain/cells"
import { PackageFolderClient } from "../package-folder.client"

/** What `cells-seed check` is asked to do, as the command line parsed it. */
export interface CellsSeedCheckCommand {
    /** The package folder. */
    readonly dir: string
}

@SubCommand({
    name: "check",
    description: "Judge every cell and graph of a package folder (no database, nothing written); prints one line each and READY, or the refusals with their codes and a non-zero exit",
})
/** `cli cells-seed check --dir <folder>`: the seed validation alone. */
export class CellsSeedCheckCli extends CommandRunner {
    constructor(
        private readonly seed: CellSeedService,
        private readonly folder: PackageFolderClient,
    ) {
        super()
    }

    /** Prints the lines of the check and sets the exit code from whether the package is ready. */
    async run(_params: Array<string>, options: CellsSeedCheckCommand): Promise<void> {
        const view = await this.seed.check(await this.folder.read(options.dir))
        process.stdout.write(`${view.lines.join("\n")}\n`)
        process.exitCode = Number(!view.ready)
    }

    /** The package folder. */
    @Option({ flags: "--dir <folder>", description: "The package folder (a checkout of the package repository)", defaultValue: "" })
    parseDir(value: string): string {
        return value
    }
}
