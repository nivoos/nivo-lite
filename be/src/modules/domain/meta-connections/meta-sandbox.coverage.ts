import type { SandboxCoverage } from "@modules/domain/provider-sandbox/sandbox-situations"
import { META_INBOUND_CASE } from "./meta-sandbox.catalogue"
import { META_SEND_CASE } from "./meta-sandbox-send.catalogue"

/**
 * Meta (Messenger, Instagram direct messages, Facebook comments; one Page token) as the standard asks it (lane concept provider-sandbox
 * rule 18): the roles `inbound` and `act` (the customer send) and the account's `connection`. The Page publishing roles (Facebook,
 * Instagram) are in `meta-publishing-provider/meta-publishing-sandbox.coverage.ts`, merged by the gate under the same key.
 */
export const META_SANDBOX_COVERAGE: SandboxCoverage = {
    provider: "meta",
    roles: [
        {
            role: "inbound",
            // Every shape `integrations/meta/meta-webhook.policy.ts` `parseWebhook` reads (its spec): a text line, a picture or other attachment, a
            // quick reply, a postback, the Page's echo, a delivery receipt, a comment, a mention and a lead ad.
            shapes: {
                text: [META_INBOUND_CASE.facebookText, META_INBOUND_CASE.instagramText],
                picture: [META_INBOUND_CASE.facebookPhoto, META_INBOUND_CASE.instagramPhoto],
                attachment: [META_INBOUND_CASE.facebookAttachment, META_INBOUND_CASE.instagramAttachment],
                quick_reply: [META_INBOUND_CASE.facebookQuickReply, META_INBOUND_CASE.instagramQuickReply],
                postback: [META_INBOUND_CASE.facebookPostback, META_INBOUND_CASE.instagramPostback],
                echo: [META_INBOUND_CASE.facebookEcho],
                delivery_receipt: [META_INBOUND_CASE.facebookDelivery],
                comment: [META_INBOUND_CASE.facebookComment, META_INBOUND_CASE.instagramComment],
                mention: [META_INBOUND_CASE.facebookMention, META_INBOUND_CASE.instagramMention],
                lead_ad: [META_INBOUND_CASE.facebookLead],
            },
            covers: {
                // The `psid` input is any id: a person the account never wrote with is a first contact.
                "inbound.unknown_sender": { cases: [META_INBOUND_CASE.facebookText, META_INBOUND_CASE.instagramText] },
                "inbound.not_a_line": {
                    cases: [
                        META_INBOUND_CASE.facebookPostback,
                        META_INBOUND_CASE.instagramPostback,
                        META_INBOUND_CASE.facebookEcho,
                        META_INBOUND_CASE.facebookDelivery,
                        META_INBOUND_CASE.facebookComment,
                        META_INBOUND_CASE.instagramComment,
                        META_INBOUND_CASE.facebookLead,
                        META_INBOUND_CASE.facebookMention,
                        META_INBOUND_CASE.instagramMention,
                    ],
                },
                "inbound.malformed": { cases: [META_INBOUND_CASE.malformed] },
                "inbound.withheld": {
                    na: "Meta's message triggers declare withoutPoll: Meta retries a failed webhook for 36 hours and then drops it, and no read-back of messages by the webhook message key is verified, so no poll can find a withheld event.",
                },
            },
        },
        {
            role: "act",
            operation: "send",
            covers: {
                "act.final": {
                    na: "nivo.tool.customer.message.send declares its final refusals (customer_opted_out, no_recipient, no_channel_identity) and NIVO decides all three before the Meta port is asked; Meta itself has no answer the tool declares final.",
                },
                "act.unknown_applied": { cases: [META_SEND_CASE.appliedNoAnswer] },
                "act.confirm_read": {
                    na: "nivo.tool.customer.message.send is repeatable, not confirmBy, and the Meta port has no read of what a Page delivered, so no read can confirm an unknown outcome; the engine repeats and a duplicate line is the accepted worst case.",
                },
                "act.replay": {
                    na: "Meta's message send takes no idempotency key in the live client (meta-messaging.client.ts), so a repeat delivers again; the engine's ledger proves the tool repeatable instead.",
                },
                "act.partial": { cases: [META_SEND_CASE.partial] },
            },
        },
        {
            role: "connection",
            covers: {
                // One Page token serves the send and both publishing destinations: Graph code 190 answers the expired and the revoked token alike
                // (the live adapters classify both as auth failure), and the sticky next case keeps refusing every call until another is picked.
                "connection.credential_refused": { cases: [META_SEND_CASE.tokenRefused, "FACEBOOK-6", "INSTAGRAM-6", "INSTAGRAM-18", "INSTAGRAM-21"] },
                "connection.revoked": { cases: [META_SEND_CASE.tokenRefused, "FACEBOOK-6", "INSTAGRAM-6"] },
                "connection.refresh": {
                    na: "A Meta account holds a long-lived Page token that NIVO only reads (meta-publishing-credential.service.ts, meta-channel-sender.service.ts): the live code has no refresh call, so a refresh can be neither refused nor busy.",
                },
            },
        },
    ],
}
