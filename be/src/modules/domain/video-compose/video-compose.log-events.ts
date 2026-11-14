/** Log events of the compose purpose's render door: ids and counts only, never a body, an address or a secret. */
export enum VideoComposeLogEvent {
    /** A render webhook was taken: the provider, the account, what it came to (kept, repeat, ignored, unreadable, unknown account). */
    RenderReceived = "video_compose.render_received",
    /** A proven render webhook's body was no JSON: the provider and the parser's words, never the body. */
    RenderUnreadable = "video_compose.render_unreadable",
    /** A kept render row was delivered after its account was gone (another provider holds it, or it was removed): the row is completed and nothing is woken. */
    RenderAccountGone = "video_compose.render_account_gone",
}
