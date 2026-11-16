import { isRecord } from "@modules/platform/primitives"

/** The queue name: the contract between the website form door (which stores a submission) and the api's delivery of it to the one event pipeline. */
export const WEBSITE_FORM_QUEUE = "website_form"

/** The jobs of the website-form queue; the value is the job name inside the queue. */
export enum WebsiteFormJob {
    /** A submission was stored: the api meets the visitor's contact and hands the stored submission to the one event pipeline (`deliver`). */
    Deliver = "website-form.deliver",
}

/** A detail the visitor typed that the contact keeps as a claim (no proof): a phone or an email, in the contacts' form. */
export interface WebsiteFormClaim {
    readonly kind: "phone" | "email"
    readonly value: string
}

/** The payload of a deliver job: one stored submission of one site, with what the visitor gave and the agent that receives it. */
export interface WebsiteFormPayload {
    /** The workspace of the site. */
    readonly workspaceId: string
    /** The site the form sat under (the account of the visitor's identity). */
    readonly siteId: string
    /** The agent that receives the site's customers, resolved when the form was accepted. */
    readonly agentId: string
    /** The stored input of the submission: the once key of the job and the event id of the pipeline. */
    readonly inboundEventId: string
    /** The site's own id of the visitor: `visitor:<uuid>`, else `submission:<key>`. */
    readonly visitorKey: string
    /** What they gave, each null when left empty. */
    readonly name: string | null
    readonly phone: string | null
    readonly email: string | null
    readonly request: string | null
    /** The page, the campaign and the device of the visit, the ones that say something. */
    readonly source: Readonly<Record<string, string>>
    /** The phone and the email the visitor typed, as claims the contact keeps (never a merge). */
    readonly claims: ReadonlyArray<WebsiteFormClaim>
}

const TEXT_KEYS = ["workspaceId", "siteId", "agentId", "inboundEventId", "visitorKey"] as const
const OPTIONAL_KEYS = ["name", "phone", "email", "request"] as const

const isClaim = (value: unknown): value is WebsiteFormClaim =>
    isRecord(value) && (value["kind"] === "phone" || value["kind"] === "email") && typeof value["value"] === "string"

/** True when a job payload is the payload of a deliver job. */
export const isWebsiteFormPayload = (value: unknown): value is WebsiteFormPayload =>
    isRecord(value) &&
    TEXT_KEYS.every((key) => typeof value[key] === "string" && value[key] !== "") &&
    OPTIONAL_KEYS.every((key) => value[key] === null || typeof value[key] === "string") &&
    isRecord(value["source"]) &&
    Object.values(value["source"]).every((entry) => typeof entry === "string") &&
    Array.isArray(value["claims"]) &&
    value["claims"].every(isClaim)

/** The dedupe key of the deliver job of one submission: one per stored input, so a form the browser repeats adds no second job. */
export const websiteFormKeyOf = (inboundEventId: string): string => `website-form:${inboundEventId}`
