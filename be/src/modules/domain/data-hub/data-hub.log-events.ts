/** Log events of the data-hub capability. */
export enum DataHubLogEvent {
    /** An operator pinned (or found already pinned) an OpenAPI document on an API account from the terminal: who, the account, the namespace, the sha256 and the counts. */
    OpenApiPinned = "data_hub.openapi_pinned",
    /**
     * A mail the poll kept that no person wrote (the headers the standards define: an auto-reply, a list, a bounce): kept as the account's
     * data, no line, no event; counted (`notFromPerson`). The workspace and the account, never the mail.
     */
    MailNotFromPerson = "data_hub.mail_not_from_person",
}
