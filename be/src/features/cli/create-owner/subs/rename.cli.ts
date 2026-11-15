import { text } from "node:stream/consumers"
import { CommandRunner, Option, SubCommand } from "nest-commander"
import { OwnersError, OwnersErrorCode, OwnersService } from "@modules/domain/owners"

/** The two addresses, read from stdin as one JSON object (never on a command line). */
interface RenameOwnerRequest {
    readonly from: string
    readonly to: string
}

const readRenameRequest = (input: string): RenameOwnerRequest => {
    let parsed: unknown
    try {
        parsed = JSON.parse(input)
    } catch {
        throw new OwnersError({ code: OwnersErrorCode.InputInvalid })
    }
    if (typeof parsed !== "object" || parsed === null) throw new OwnersError({ code: OwnersErrorCode.InputInvalid })
    const { from, to } = parsed as Record<string, unknown>
    if (typeof from !== "string" || from.trim() === "" || typeof to !== "string" || to.trim() === "") throw new OwnersError({ code: OwnersErrorCode.InputInvalid })
    return { from, to }
}

/** What the command line says: only whether it is a dry run. */
interface RenameOwnerOptions {
    readonly dry: boolean
}

@SubCommand({
    name: "rename",
    description:
        "Change the sign-in address of the account that has `from` to `to`, in place (same account id, same workspaces); reads {\"from\",\"to\"} as JSON on stdin; --dry only says whether the old account exists and the new address is free",
})
/** `cli create-owner rename [--dry] < {"from": ..., "to": ...}`. */
export class RenameOwnerCli extends CommandRunner {
    constructor(private readonly owners: OwnersService) {
        super()
    }

    async run(_params: Array<string>, options: RenameOwnerOptions): Promise<void> {
        const request = readRenameRequest(await text(process.stdin))
        await this.owners.renameOwner(request.from, request.to, options.dry)
    }

    /** Read only: print whether the old account exists and the new address is free. */
    @Option({ flags: "--dry", description: "Read only; change nothing", defaultValue: false })
    parseDry(): boolean {
        return true
    }
}
