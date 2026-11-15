import { CommandHandler } from "@nestjs/cqrs"
import { ThreadParkedDeadlinesService } from "@modules/domain/agent-threads"
import { ProviderSandboxAccountsService, ProviderSandboxError, ProviderSandboxErrorCode } from "@modules/domain/provider-sandbox"
import { ICQRSHandler } from "@modules/platform/cqrs"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { ExpireSandboxWaitCommand } from "./provider-sandbox.commands"
import type { SandboxWaitExpiryView } from "./provider-sandbox.contracts"

@CommandHandler(ExpireSandboxWaitCommand)
/**
 * "Expire this run's deadline now" (R62 + R66; ENGINE-FIN (b): ANY parked deadline, a wait's timeout, an until round, a retry-ladder rung,
 * an approval's expiry, a stop's deadline): the sandbox gate first (switch on, owner or manager), then the engine's real deadline road.
 * Anything but `admitted` (closed, moved, early, refused) means the run was not parked on a deadline: refused with the engine's word.
 */
export class ExpireSandboxWaitHandler extends ICQRSHandler<ExpireSandboxWaitCommand, SandboxWaitExpiryView> {
    constructor(
        @InjectLogger() logger: Logger,
        private readonly accounts: ProviderSandboxAccountsService,
        private readonly expiry: ThreadParkedDeadlinesService,
    ) {
        super(logger)
    }

    protected override async process(command: ExpireSandboxWaitCommand): Promise<SandboxWaitExpiryView> {
        const { workspaceId, runId } = command.params.request
        await this.accounts.assertManager({ principalId: command.params.principal.id, workspaceId })
        const outcome = await this.expiry.fireNow(workspaceId, runId)
        if (outcome !== "admitted") {
            throw new ProviderSandboxError({ code: ProviderSandboxErrorCode.RunNotWaiting, params: { runId, reason: outcome } })
        }
        return { runId, outcome }
    }
}
