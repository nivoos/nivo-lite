import { Injectable } from "@nestjs/common"
import { ProviderRegistryService } from "./provider-registry.service"
import type {
    BankTransactionsPort,
    FeedWebhookPort,
    LedgerPort,
    PollReceiver,
} from "./provider-ports.contracts"
import type { DomainRegistrarPort } from "./domain-ports.contracts"
import type { ChannelProfilePort } from "./channel-profile-ports.contracts"

@Injectable()
/** The bank providers that list a connection's transactions to nodes and agents. */
export class BankTransactionsRegistryService extends ProviderRegistryService<BankTransactionsPort> {}

@Injectable()
/** The bank providers whose webhook feeds a workspace bank feed. */
export class FeedWebhookRegistryService extends ProviderRegistryService<FeedWebhookPort> {}

@Injectable()
/** The providers that keep the business ledger of a workspace. */
export class LedgerRegistryService extends ProviderRegistryService<LedgerPort> {}

@Injectable()
/** The domain registrars whose accounts serve the generic domain purposes (`nivo.tool.domain.*`). */
export class DomainRegistrarRegistryService extends ProviderRegistryService<DomainRegistrarPort> {}

@Injectable()
/** The messaging providers that read what their channel says of a person (name, picture), for the provider-neutral profile tool. */
export class ChannelProfileRegistryService extends ProviderRegistryService<ChannelProfilePort> {}

@Injectable()
/** The providers that can be POLLED for a data type: one receiver per provider, read by the engine's one poll job (owner R95). */
export class PollReceiverRegistryService extends ProviderRegistryService<PollReceiver> {}
