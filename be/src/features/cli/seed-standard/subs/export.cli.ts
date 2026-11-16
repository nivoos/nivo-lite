import { CommandRunner, Option, SubCommand } from "nest-commander"
import { SeedStandardExportService } from "@modules/domain/workspace-seed"

/** What `seed-standard export` is asked to do. */
export interface StandardExportCommand {
    /** The name of the workspace to export. */
    readonly workspace: string
    /** The path of a checkout of the workspace's `-seed-standard` repo. */
    readonly to: string
    /** The environment whose sealed file receives the credentials. */
    readonly env: string
    /** Write only the sealed file (the credentials the app holds now), never seed.json. */
    readonly credentialsOnly: boolean
}

@SubCommand({
    name: "export",
    description:
        "Write a working workspace into a CHECKOUT of its seed standard for review and re-pinning (never the pin): seed.json, and each live account's credential read from the app's sealed store in memory and sealed straight through sops into secrets/<env>.enc.yaml; no value is printed or written in plain",
})
/** `cli seed-standard export --workspace <name> --to <checkout> --env dev`: by hand, where the app's own key is. */
export class StandardExportCli extends CommandRunner {
    constructor(private readonly exporter: SeedStandardExportService) {
        super()
    }

    /** Exports. */
    async run(_params: Array<string>, options: StandardExportCommand): Promise<void> {
        await this.exporter.export(options.workspace, options.to, options.env, options.credentialsOnly)
    }

    /** The workspace name. */
    @Option({ flags: "--workspace <name>", description: "The workspace to export", defaultValue: "" })
    parseWorkspace(value: string): string {
        return value
    }

    /** The checkout. */
    @Option({ flags: "--to <path>", description: "A checkout of the workspace's -seed-standard repo", defaultValue: "" })
    parseTo(value: string): string {
        return value
    }

    /** The environment. */
    @Option({ flags: "--env <name>", description: "The environment whose sealed file is written: dev | production", defaultValue: "" })
    parseEnv(value: string): string {
        return value
    }

    /** Only the sealed file. */
    @Option({ flags: "--credentials-only", description: "Seal the credentials the app holds now for the accounts the checkout declares; write nothing else", defaultValue: false })
    parseCredentialsOnly(): boolean {
        return true
    }
}
