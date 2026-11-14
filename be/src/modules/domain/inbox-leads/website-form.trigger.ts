import { PROVIDER, TRIGGER } from "@nivo-lite/agent-sdk/names"
import { z } from "zod"
import type { DeclaredLine, OptionalCanonicalEvent, TriggerDeclaration } from "@modules/domain/provider-triggers"

/*
 * THE WEBSITE FORM'S TRIGGER (stage 1 of the one event pipeline, concept triggers rule 13): one accepted submission of the hosted form, as
 * ONE canonical event about the visitor. The site is the account of the identity (contacts rule 11: the site's own id of the visitor is a
 * `website` channel identity on the site); the phone and mail typed into the form are claims the entry links itself, never the subject.
 * Pure: the translate reads only its argument.
 */

/** The trigger's name. */
export const WEBSITE_FORM_SUBMITTED = "form.submitted"

/** The channel of a website visitor's identity. */
export const WEBSITE_IDENTITY_CHANNEL = "website"

/** One accepted submission, as the entry stored it (the input row) and read the visitor. */
export type WebsiteSubmissionRaw = {
    /** The site the form sat under. */
    readonly siteId: string
    /** The stored input of the submission (the inbox of a source with no account row). */
    readonly inboundEventId: string
    /** The site's own id of the visitor: `visitor:<uuid>`, else `submission:<key>` for a visitor the page did not name. */
    readonly visitorKey: string
    /** What they gave, each null when left empty. */
    readonly name: string | null
    readonly phone: string | null
    readonly email: string | null
    readonly request: string | null
    /** The page, the campaign and the device of the visit, the ones that say something. */
    readonly source: Readonly<Record<string, string>>
}

/** The data of a submission: the site, the stored input, what the visitor wrote and the details they left (claims), the visit. */
export type WebsiteFormData = {
    readonly siteId: string
    readonly inboundEventId: string
    readonly request: string | null
    readonly contact: { readonly name: string | null; readonly phone: string | null; readonly email: string | null }
    readonly source: Readonly<Record<string, string>>
}

/** The translate: one event per stored input, about the visitor by the site's own id of them, named as they named themselves. */
export const translateWebsiteSubmission = (raw: WebsiteSubmissionRaw): OptionalCanonicalEvent<WebsiteFormData> => {
    if (raw.inboundEventId === "" || raw.visitorKey === "" || raw.siteId === "") return null
    return {
        id: raw.inboundEventId,
        subject: { channel: WEBSITE_IDENTITY_CHANNEL, id: raw.visitorKey, ...(raw.name === null ? {} : { name: raw.name }) },
        data: {
            siteId: raw.siteId,
            inboundEventId: raw.inboundEventId,
            request: raw.request,
            contact: { name: raw.name, phone: raw.phone, email: raw.email },
            source: raw.source,
        },
    }
}

/** A text that may be empty, as JSON holds it. */
const OPTIONAL_TEXT = z.string().nullable()

/**
 * The line the visitor wrote to the shop (owner ruling R26, coordinator: the request IS the person's line on the website route): keyed
 * once by the stored input, said when it was received (a form carries no time of its own). A submission with no request is no line. Pure.
 */
export const websiteLineOf = (data: WebsiteFormData): DeclaredLine | null =>
    data.request === null || data.request.trim() === "" ? null : { key: data.inboundEventId, text: data.request, at: null }

/** The website form's declaration: received by the engine's own form door, keyed by the visitor's route on the site. */
export const WEBSITE_FORM_TRIGGER: TriggerDeclaration<WebsiteSubmissionRaw, WebsiteFormData> = {
    provider: PROVIDER.nivo,
    name: WEBSITE_FORM_SUBMITTED,
    verb: TRIGGER.websiteMessageReceived,
    via: ["internal"],
    // The door stores the submission and writes its delivery as a queue outbox row in the SAME transaction (job `website-form.deliver`, once key
    // per stored input): the job meets the visitor's contact and hands the stored submission to the one pipeline. A crash between the store and
    // the wake is a redelivery by the job frame, a failure runs the ladder, and a delivery that fails for good parks with one item for a
    // person. A form the browser repeats under the same `submissionId` is one stored input, one job, one event id.
    withoutPoll: {
        reason: {
            vi: "Biểu mẫu lưu lần gửi và ghi việc báo (website-form.deliver) cùng một giao dịch: chết giữa chừng thì việc được giao lại, lỗi thì thử lại theo bậc rồi dừng kèm một mục cho người xử lý. Cùng mã gửi (submissionId) chỉ là một lần gửi.",
            en: "The form door stores the submission and writes its delivery job (website-form.deliver) in the same transaction: a crash is redelivered, a failure is retried on the ladder, then parked with one item for a person. The same submissionId is one submission.",
        },
        source: "nivo:website-form.deliver",
    },
    words: {
        title: { vi: "Website · khách gửi biểu mẫu", en: "Website · form submitted" },
        summary: {
            vi: "Một khách điền và gửi biểu mẫu liên hệ trên website của bạn.",
            en: "A visitor fills in and sends the contact form on your website.",
        },
        members: {
            siteId: { vi: "Website nhận biểu mẫu.", en: "The site that took the form." },
            inboundEventId: { vi: "Mã bản ghi lần gửi trong NIVO.", en: "The id of the stored submission in NIVO." },
            request: { vi: "Điều khách viết.", en: "What the visitor wrote." },
            contact: { vi: "Tên, số điện thoại, email khách để lại (khách tự khai).", en: "The name, phone and email the visitor left (as they typed them)." },
            source: { vi: "Trang, chiến dịch và thiết bị của lượt truy cập.", en: "The page, campaign and device of the visit." },
        },
    },
    raw: z.object({
        siteId: z.string(),
        inboundEventId: z.string(),
        visitorKey: z.string(),
        name: OPTIONAL_TEXT,
        phone: OPTIONAL_TEXT,
        email: OPTIONAL_TEXT,
        request: OPTIONAL_TEXT,
        source: z.record(z.string(), z.string()),
    }),
    data: z.object({
        siteId: z.string().min(1),
        inboundEventId: z.string().min(1),
        request: OPTIONAL_TEXT,
        contact: z.object({ name: OPTIONAL_TEXT, phone: OPTIONAL_TEXT, email: OPTIONAL_TEXT }),
        source: z.record(z.string(), z.string()),
    }),
    translate: translateWebsiteSubmission,
    line: websiteLineOf,
    key: { by: "subject" },
    settle: null,
    // The visitor's request is a line of the route's stream: held requests are ONE marker the workflow reads the stream from (rule Q-4).
    combine: "stream",
}
