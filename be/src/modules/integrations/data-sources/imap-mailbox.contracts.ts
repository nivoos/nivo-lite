/** Where and how to log in to one mailbox. */
export interface ImapLogin {
    /** The server name or address the owner typed. */
    readonly host: string
    /** The server port. */
    readonly port: number
    /** True for implicit TLS, false for STARTTLS. */
    readonly secure: boolean
    /** The login name. */
    readonly user: string
    /** The password (an app password). */
    readonly password: string
}

/** One person on a message. */
export interface ImapAddress {
    /** The display name, if any. */
    readonly name: string | null
    /** The mail address, if any. */
    readonly address: string | null
}

/** One message as a hub row; structurally a data record. */
export interface ImapMessageRow {
    /** `<folder>:<uidvalidity>:<uid>`. */
    readonly externalId: string
    /** The subject. */
    readonly title: string
    /** When the message was sent (or received when it has no date). */
    readonly occurredAt: Date | null
    /** The message fields. */
    readonly data: Readonly<Record<string, unknown>>
}

/** One window of a mailbox the poll reads: its folders, the instants it spans and the most messages one page holds. */
export interface ImapPageRequest {
    /** The folders to read. */
    readonly folders: ReadonlyArray<string>
    /** Only messages received at or after this instant. */
    readonly from: Date
    /** Only messages received at or before this instant; undefined reads up to now. */
    readonly to: Date | undefined
    /** The most messages the page holds: the newest of the window. */
    readonly limit: number
}

/** One page of a mailbox: the newest messages of the window, newest first, and how many the window held in all. */
export interface ImapPage {
    /** The rows of the page, newest first. */
    readonly rows: ReadonlyArray<ImapMessageRow>
    /** How many messages the window held in all folders (a page holding `limit` of more means an older page follows). */
    readonly fetched: number
    /** When the oldest message of the page was received; undefined for an empty page. */
    readonly oldestAt: Date | undefined
    /** When the newest message of the page was received; undefined for an empty page. */
    readonly newestAt: Date | undefined
}
