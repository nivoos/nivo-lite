import { Injectable } from "@nestjs/common"
import { ContactsService, type ContactActor } from "@modules/domain/contacts"
import { WEBSITE_CHANNEL } from "@modules/domain/installed-plugins"
import { eachInOrder } from "@modules/platform/primitives"
import { isWebsiteFormPayload } from "@modules/queues/website-form"
import { WebsiteLeadWakeService } from "./website-lead-wake.service"

/** Who adds the claims of a form to the contact: the website entrance itself, no person and no step. */
const BY_FORM: ContactActor = { kind: "channel" }

@Injectable()
/**
 * THE WEBSITE FORM'S DELIVERY, run by the api only (the one app that drives runs): a queued submission (written by the form door in the
 * transaction that stored it) meets the visitor's core contact by the site's own id of them, adds the phone and the email they typed as
 * claims (unverified: they merge nothing), and hands the stored submission to the ONE event pipeline through `WebsiteLeadWakeService`.
 * Every step is idempotent (the contact met again is the same contact, a claim linked again is the same claim, the event id is kept once by
 * the pipeline), so a job redelivered after a crash wakes nobody twice. NOT provided by the intake module: only the api's job module
 * composes it.
 */
export class WebsiteSubmissionDeliveryService {
    constructor(
        private readonly contacts: ContactsService,
        private readonly wakes: WebsiteLeadWakeService,
    ) {}

    /** Delivers the submission a job names; a payload that is no submission (only the form door writes the job) ends the job doing nothing. */
    async deliverJob(payload: object): Promise<void> {
        if (!isWebsiteFormPayload(payload)) return
        const contactId = await this.contacts.meetChannel(payload.workspaceId, {
            channel: WEBSITE_CHANNEL,
            account: payload.siteId,
            userId: payload.visitorKey,
            name: payload.name,
        })
        await eachInOrder(payload.claims, (claim) => this.contacts.linkIdentity(payload.workspaceId, contactId, claim, BY_FORM))
        await this.wakes.wake(payload.workspaceId, payload.agentId, {
            contactId,
            siteId: payload.siteId,
            inboundEventId: payload.inboundEventId,
            visitorKey: payload.visitorKey,
            name: payload.name,
            phone: payload.phone,
            email: payload.email,
            request: payload.request,
            source: payload.source,
        })
    }
}
