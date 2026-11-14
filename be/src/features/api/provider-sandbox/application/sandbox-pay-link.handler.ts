import { QueryHandler } from "@nestjs/cqrs"
import { ProviderSandboxAccountsService, type SandboxPayLinkView } from "@modules/domain/provider-sandbox"
import { ICQRSHandler } from "@modules/platform/cqrs"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { SandboxPayLinkQuery } from "./provider-sandbox.queries"

@QueryHandler(SandboxPayLinkQuery)
/** Asks for one pay link of the workspace's sandbox by its id (owner or manager, dev switch on); no provider name here, the catalogues resolve the id. */
export class SandboxPayLinkHandler extends ICQRSHandler<SandboxPayLinkQuery, SandboxPayLinkView> {
    constructor(
        @InjectLogger() logger: Logger,
        private readonly accounts: ProviderSandboxAccountsService,
    ) {
        super(logger)
    }

    protected override process(query: SandboxPayLinkQuery): Promise<SandboxPayLinkView> {
        return this.accounts.payLink({ principalId: query.params.principal.id, workspaceId: query.params.request.workspaceId }, query.params.request.linkId)
    }
}
