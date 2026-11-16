import { text } from "node:stream/consumers"
import { CommandRunner, SubCommand } from "nest-commander"
import { OwnersError, OwnersErrorCode, OwnersService } from "@modules/domain/owners"

/** What the operator hands on stdin: one JSON object (never on a command line, where every process listing shows it). */
export interface CreateOwnerRequest {
    /** The sign-in address. */
    readonly email: string
    /** The password, 8 to 72 characters. */
    readonly password: string
}

/** Reads `{email, password}` from a stdin text; anything else is refused by code, never echoed. */
export const readCreateOwnerRequest = (input: string): CreateOwnerRequest => {
    let parsed: unknown
    try {
        parsed = JSON.parse(input)
    } catch {
        throw new OwnersError({ code: OwnersErrorCode.InputInvalid })
    }
    if (typeof parsed !== "object" || parsed === null) throw new OwnersError({ code: OwnersErrorCode.InputInvalid })
    const { email, password } = parsed as Record<string, unknown>
    if (typeof email !== "string" || email.trim() === "" || typeof password !== "string") throw new OwnersError({ code: OwnersErrorCode.InputInvalid })
    return { email, password }
}

@SubCommand({
    name: "run",
    description:
        "Create a confirmed account with a password, or set the password of the account that already has the address; reads {\"email\",\"password\"} as JSON on stdin.",
})
/** `cli create-owner run < {"email": ..., "password": ...}`: the first sign-in of a clean database, or a new password for the owner. */
export class RunCreateOwnerCli extends CommandRunner {
    constructor(private readonly owners: OwnersService) {
        super()
    }

    /** Creates the account, or sets its password. */
    async run(): Promise<void> {
        const request = readCreateOwnerRequest(await text(process.stdin))
        await this.owners.createOwner(request.email, request.password)
    }
}
