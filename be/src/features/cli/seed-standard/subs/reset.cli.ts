import { text } from "node:stream/consumers"
import { CommandRunner, Option, SubCommand } from "nest-commander"
import { SeedStandardService } from "@modules/domain/workspace-seed"

/** What `seed-standard reset` is asked to do. */
export interface StandardResetCommand {
    /** The stack environment: `dev` only. */
    readonly env: string
    /** Remove; without it the plan is printed. */
    readonly execute: boolean
}

@SubCommand({
    name: "reset",
    description: "Take the workspace of each declared standard on stdin off the LOCAL stack through the owner's delete door (soft) and drop its receipt; dry unless --execute; refused in production",
})
/** `cli seed-standard reset --env dev [--execute] < <declarations envelope>`: by hand. */
export class StandardResetCli extends CommandRunner {
    constructor(private readonly standards: SeedStandardService) {
        super()
    }

    /** Prints the plan and, with --execute, removes. */
    async run(_params: Array<string>, options: StandardResetCommand): Promise<void> {
        await this.standards.reset(await text(process.stdin), options.env, options.execute)
    }

    /** The environment. */
    @Option({ flags: "--env <name>", description: "The stack environment: dev", defaultValue: "" })
    parseEnv(value: string): string {
        return value
    }

    /** Removes instead of printing the plan. */
    @Option({ flags: "--execute", description: "Remove; without it nothing is removed", defaultValue: false })
    parseExecute(): boolean {
        return true
    }
}
