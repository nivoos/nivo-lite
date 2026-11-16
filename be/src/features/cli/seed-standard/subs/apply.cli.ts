import { text } from "node:stream/consumers"
import { CommandRunner, Option, SubCommand } from "nest-commander"
import { SeedStandardService } from "@modules/domain/workspace-seed"

/** What `seed-standard apply` is asked to do, as the command line parsed it. */
export interface StandardApplyCommand {
    /** The stack environment (`dev`, `production`). */
    readonly env: string
    /** The bring-up's dry run: what each standard would do, READY yes / no, the secret members by name; nothing written. */
    readonly dry: boolean
}

@SubCommand({
    name: "apply",
    description:
        "The stack seed step's command: the seed-standard declarations on stdin (`nivo/seed-standard@1`, one per standard), each applied ONCE (its receipt), re-seeded only by a force declared in the stack (once per pinned commit); --dry prints what the bring-up would do",
})
/** `cli seed-standard apply --env <env> [--dry] < <declarations envelope>`: run by the stack's bring-up. */
export class StandardApplyCli extends CommandRunner {
    constructor(private readonly standards: SeedStandardService) {
        super()
    }

    /** Hands stdin and the environment to the standards; the last printed line is `applied` or `unchanged`. */
    async run(_params: Array<string>, options: StandardApplyCommand): Promise<void> {
        await this.standards.apply(await text(process.stdin), options.env, options.dry)
    }

    /** The environment; none given is the empty name, which is refused. */
    @Option({ flags: "--env <name>", description: "The stack environment: dev | production", defaultValue: "" })
    parseEnv(value: string): string {
        return value
    }

    /** The bring-up's dry run. */
    @Option({ flags: "--dry", description: "Print what would happen; write nothing", defaultValue: false })
    parseDry(): boolean {
        return true
    }
}
