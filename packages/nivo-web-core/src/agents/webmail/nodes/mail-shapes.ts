import { z } from "zod"

/** The most lines of a person one run hears at once (the mails they sent while the run was busy are heard together as ONE mail). */
export const ROUND_MAILS_MAX = 25

/** The language the team reads. */
export type TeamLocale = "vi" | "en"

/** The most words of one heard mail a step reads (the line the engine keeps is the subject, then the text). */
export const HEARD_TEXT_MAX = 20_000

/** One mail the person sent, as the hearing hands it on: its head and its words, copied from the person's lines of the route. */
export type HeardMail = {
    /** The mail's id: the mailbox's id of it for the mail that woke the run, else the line's position on the route. */
    readonly id: string
    /** The mailbox account (connection id) it came in on. */
    readonly mailbox: string
    /** The sender's address (the person's identity on the mail channel). */
    readonly from: string
    /** The subject line. */
    readonly subject: string
    /** The words of the line as the engine keeps them: the subject line, then the text. */
    readonly text: string
    /** Whether it carries attachments (their content is never read). */
    readonly hasAttachments: boolean
}

/** The members of a heard mail's schema. */
export type HeardMailShape = {
    /** The schema of the mail's id. */
    id: z.ZodString
    /** The schema of the mailbox id. */
    mailbox: z.ZodString
    /** The schema of the sender. */
    from: z.ZodString
    /** The schema of the subject. */
    subject: z.ZodString
    /** The schema of the words. */
    text: z.ZodString
    /** The schema of the attachments flag. */
    hasAttachments: z.ZodBoolean
}

/** The schema of one heard mail, every member described for the model. */
export const heardMailSchema: z.ZodObject<HeardMailShape> = z.object({
    id: z.string().min(1).max(100).describe("The mail's id, exactly as it was given."),
    mailbox: z.string().min(1).max(100).describe("The mailbox account id it came in on."),
    from: z.string().max(400).describe("The sender's address; empty when none."),
    subject: z.string().max(400).describe("The subject line."),
    text: z.string().max(HEARD_TEXT_MAX).describe("The mail's words, the subject line first."),
    hasAttachments: z.boolean().describe("Whether the mail carries files."),
})

/** The schema of the team's language. */
export const localeSchema: z.ZodType<TeamLocale> = z.enum(["vi", "en"])

/** The longest summary of one mail: what the steps it is handed to read (`summary`, one line of at most 400). */
export const SUMMARY_MAX = 400

/**
 * What a mail is, as the sort step reads it (since `webmail.triage` v3): a customer's answer about a renewal, a support request,
 * a supplier's invoice or bill, someone asking to buy or for a price, another mail a person must handle, or a mail nobody needs
 * to act on.
 */
export type MailKind = "renewal-reply" | "ticket" | "supplier-invoice" | "enquiry" | "needs-person" | "other"

/** One mail as the sort step (`webmail.sort`) answered it: its head, what kind of mail it is, and what it says. */
export type KindedMail = {
    /** The mail's id. */
    readonly mailId: string
    /** The mailbox it was read from. */
    readonly mailbox: string
    /** The sender. */
    readonly from: string
    /** The subject. */
    readonly subject: string
    /** What kind of mail it is, as the model read it. */
    readonly kind: MailKind
    /**
     * One short line in the team's language: what the mail says or asks, its facts as written, and why a person must act when one
     * must.
     */
    readonly summary: string
}

/** One mail as a hand-off passes it to the next agent's workflow: what that workflow's first step reads per mail. */
export type HandedMail = {
    /** The mail's id. */
    readonly mailId: string
    /** The mailbox it was read from. */
    readonly mailbox: string
    /** The sender. */
    readonly from: string
    /** The subject. */
    readonly subject: string
    /** What the mail says or asks, its facts as written. */
    readonly summary: string
}

/** The schema of what kind a mail is, each kind described for the model: the model reads the mail, no word decides it. */
export const mailKindSchema: z.ZodType<MailKind> = z
    .enum(["renewal-reply", "ticket", "supplier-invoice", "enquiry", "needs-person", "other"])
    .describe(
        "What this mail is, by what it means: " +
            '"renewal-reply" = a customer answers about renewing a service they hold (they renew, decline, ask to change it, or answer a reminder); ' +
            '"ticket" = a customer asks for help or reports a fault or a problem with a service they hold; ' +
            '"supplier-invoice" = a supplier of the company sends an invoice, a bill or a payment notice for what the company bought; ' +
            '"enquiry" = someone asks to buy something new from the company or asks for a price; ' +
            '"needs-person" = none of these, and a person of the team must still handle it (by your guidance and the truths); ' +
            '"other" = nobody needs to act on it.',
    )

/** The members of one mail the sort step answered, every member described for the model. */
const kindedMailObject = z.object({
    mailId: z.string().min(1).max(100).describe("The `id` of the mail you were given."),
    mailbox: z.string().min(1).max(100).describe("The `mailbox` you were given."),
    from: z.string().max(400).describe("The `from` you were given."),
    subject: z.string().max(400).describe("The `subject` you were given."),
    kind: mailKindSchema,
    summary: z
        .string()
        .min(1)
        .max(SUMMARY_MAX)
        .describe(
            "One short line in the team's language: what the mail says or asks, with its facts exactly as written (a domain, an " +
                "invoice number, an amount, a date); for `needs-person`, also why a person must handle it.",
        ),
})

/** The schema of one mail the sort step answered (what the model writes). */
export const kindedMailSchema: z.ZodType<KindedMail> = kindedMailObject

/** The schema of one mail a hand-off passes on. */
export const handedMailSchema: z.ZodType<HandedMail> = z.object({
    mailId: z.string().min(1).max(100),
    mailbox: z.string().min(1).max(100),
    from: z.string().max(400),
    subject: z.string().max(400),
    summary: z.string().min(1).max(SUMMARY_MAX),
})

/** What the sort step answers the graph: the mail as the model sorted it, and the one-mail list the hand-off passes to the agent that handles its kind. */
export type SortedMail = KindedMail & {
    /** The mail as a hand-off passes it: a list of one (the callee's workflows loop over a list of mails). */
    readonly handed: ReadonlyArray<HandedMail>
}

/** The schema of what the sort step answers the graph (an object: its `kind` routes the run). */
export const sortedMailSchema: z.ZodType<SortedMail> = kindedMailObject.extend({
    handed: z.array(handedMailSchema).min(1).max(1),
})
