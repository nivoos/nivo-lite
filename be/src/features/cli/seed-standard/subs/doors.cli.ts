import { text } from "node:stream/consumers"
import { CommandRunner, Option, SubCommand } from "nest-commander"
import { SeedStandardService } from "@modules/domain/workspace-seed"

/** What `seed-standard doors` is asked to do. */
export interface StandardDoorsCommand {
    /** The stack environment. */
    readonly env: string
}

@SubCommand({
    name: "doors",
    description: "Print, one JSON object a line, the door steps of the declared standards on stdin (time zone; node settings on the first seed or when the declared force names node-settings) for the door script",
})
/** `cli seed-standard doors --env <env> < <declarations envelope> | node doors.cjs`. */
export class StandardDoorsCli extends CommandRunner {
    constructor(private readonly standards: SeedStandardService) {
        super()
    }

    /** Prints the door steps. */
    async run(_params: Array<string>, options: StandardDoorsCommand): Promise<void> {
        await this.standards.doors(await text(process.stdin), options.env)
    }

    /** The environment. */
    @Option({ flags: "--env <name>", description: "The stack environment: dev | production", defaultValue: "" })
    parseEnv(value: string): string {
        return value
    }
}
