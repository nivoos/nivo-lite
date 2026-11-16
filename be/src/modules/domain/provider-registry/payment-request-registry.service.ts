import { Injectable } from "@nestjs/common"
import { ProviderRegistryService } from "./provider-registry.service"
import type { PaymentRequestPort } from "./payment-request-ports.contracts"

@Injectable()
/** The money providers that ask a payer to pay (generic purpose `nivo.tool.payment.request.*`, owner ruling R111): one port, every provider. */
export class PaymentRequestRegistryService extends ProviderRegistryService<PaymentRequestPort> {}
