import { text } from "node:stream/consumers"
import { CommandRunner, Option, SubCommand } from "nest-commander"
import { SeedStandardService } from "@modules/domain/workspace-seed"

/** What `seed-standard record-doors` is asked to do. */
export interface StandardRecordDoorsCommand {
    /** The stack environment. */
    readonly env: string
}

@SubCommand({
    name: "record-doors",
    description: "Record in each standard's receipt the door script's report on stdin (`{standards: {<name>: [{step, outcome, code?}]}}`): a refused door step is a FAILED seed step with its typed code",
})
/** `node doors.cjs --results r.json < steps; cli seed-standard record-doors --env dev < r.json`. */
export class StandardRecordDoorsCli extends CommandRunner {
    constructor(private readonly standards: SeedStandardService) {
        super()
    }

    /** Records the outcomes. */
    async run(_params: Array<string>, options: StandardRecordDoorsCommand): Promise<void> {
        await this.standards.recordDoors(await text(process.stdin), options.env)
    }

    /** The environment. */
    @Option({ flags: "--env <name>", description: "The stack environment: dev | production", defaultValue: "" })
    parseEnv(value: string): string {
        return value
    }
}
