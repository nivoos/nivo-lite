import { Injectable, Optional } from "@nestjs/common"
import type {
    ChannelTarget,
    CustomerSendPort,
    CustomerSendRequest,
    DeliveryResult,
    OptionalEntranceMissing,
} from "@modules/domain/channels"
import { actsAs, type ConnectionRecord } from "@modules/domain/connections"
import { WorkspacesService } from "@modules/domain/workspaces"
import { renderEmail } from "@modules/integrations/mail"
import { InjectMessageCatalog, type MessageCatalog } from "@modules/platform/i18n"
import { mailDeliveryOf, mailThreadOf } from "./mail-delivery.policy"
import { WorkspaceMailService } from "./workspace-mail.service"

/** What the mail log and the mail service record a message of the one send as. */
export const CUSTOMER_MESSAGE_PURPOSE = "customer_message"

/** The shop name a mail carries when the workspace has none. */
const DEFAULT_SHOP = "NIVO"

/** The provider of a mailbox's inbound half (MAIL-IN rule MI-1): a mailbox account that holds it receives the person's answers. */
const INBOUND_HALF = "imap"

/** The language of the mail's frame (its footer); the words are the agent's own, in the customer's language. */
const FRAME_LOCALE = "vi"

/** The thread a reply answers, as the send takes it: none when the send answers no mail. */
const threadOf = (answers: ReadonlyArray<string> | undefined) => {
    const thread = mailThreadOf(answers ?? [])
    return thread === null ? {} : { thread }
}

@Injectable()
/**
 * The customer channel `email` of the ONE customer send (rule SO-1): what `CustomerSendRegistryService.portFor(account)` answers for a
 * workspace mail account (provider `smtp`). The executor of `nivo.tool.customer.message.send` has already judged the address, the route,
 * the hold, the consent, the rights, the subject the channel requires and the node's mode, and claimed the send key in the delivery
 * ledger; this port only frames the words as a mail (the shop's name, the subject, the footer) and sends it through the workspace mail
 * service on THAT account, which keeps the mail log and the account's own data and resolves the account's live or sandbox SMTP send (the
 * SMTP registry's own switch: a sandbox account is only recorded, `SMTP-1..4`). The answer is mapped onto the port's classes by
 * `mailDeliveryOf`. The same instance serves a live and a sandbox account: it holds no provider client, the SMTP send below it does.
 */
export class MailCustomerSendService implements CustomerSendPort {
    readonly provider = "smtp"

    /**
     * A mail account is a customer ENTRANCE only when it holds its inbound half too (MAIL-IN rule MI-3): a mail sent from an account that
     * reads nothing would get answers no one reads.
     */
    entranceOf(account: ConnectionRecord): OptionalEntranceMissing {
        return actsAs(account, INBOUND_HALF) ? null : "inbound"
    }

    constructor(
        private readonly mail: WorkspaceMailService,
        @Optional() @InjectMessageCatalog() private readonly catalog?: MessageCatalog,
        @Optional() private readonly workspaces?: WorkspacesService,
    ) {}

    /** Mails the words to the person's address on the account; answers the delivery result (a limit or an unreachable server throws "not sent"). */
    async send(account: ConnectionRecord, target: ChannelTarget, userId: string | null, request: CustomerSendRequest): Promise<DeliveryResult> {
        const to = (userId ?? "").trim()
        const subject = (request.subject ?? "").trim()
        const shop = (await this.workspaces?.nameOf(target.workspaceId)) ?? ""
        const shopName = shop === "" ? DEFAULT_SHOP : shop
        const rendered = renderEmail({
            shopName,
            title: subject,
            body: request.text,
            footer: this.catalog?.get("performers.emailFooter", { shop: shopName }, FRAME_LOCALE) ?? "",
            lang: FRAME_LOCALE,
        })
        const sent = await this.mail.send({
            workspaceId: target.workspaceId,
            connectionId: account.id,
            to,
            subject,
            html: rendered.html,
            text: rendered.text,
            purpose: CUSTOMER_MESSAGE_PURPOSE,
            refs: { route_id: target.id, send_key: request.messageId },
            audience: "customer",
            ...threadOf(request.answers),
        })
        return mailDeliveryOf(sent)
    }
}
