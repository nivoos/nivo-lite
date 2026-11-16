import { CommandHandler } from "@nestjs/cqrs"
import { ProviderSandboxAccountsService, type SandboxNextCase } from "@modules/domain/provider-sandbox"
import { ICQRSHandler } from "@modules/platform/cqrs"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { SetSandboxNextOutcomeCommand } from "./provider-sandbox.commands"

@CommandHandler(SetSandboxNextOutcomeCommand)
/** Picks the account's next answer of an outbound operation by the generic outcome: the same for every provider. */
export class SetSandboxNextOutcomeHandler extends ICQRSHandler<SetSandboxNextOutcomeCommand, SandboxNextCase> {
    constructor(
        @InjectLogger() logger: Logger,
        private readonly accounts: ProviderSandboxAccountsService,
    ) {
        super(logger)
    }

    protected override process(command: SetSandboxNextOutcomeCommand): Promise<SandboxNextCase> {
        const { request, principal } = command.params
        return this.accounts.setNextOutcome(
            { principalId: principal.id, workspaceId: request.workspaceId },
            request.connectionId,
            request.operation,
            request.outcome,
        )
    }
}
