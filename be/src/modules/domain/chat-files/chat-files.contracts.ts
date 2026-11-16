/** A picture or file a customer sent on a channel, where the channel serves it, before the shop keeps a copy. */
export interface CustomerAttachment {
    /** `image` or `file`. */
    readonly kind: "image" | "file"
    /** The channel's address of the bytes (it may expire); empty when the channel gave none. */
    readonly url: string
    /**
     * The name the sender gave it, or an empty text. For a part with NO bytes (`contentType` set) it is what the channel sends of the part,
     * as sent: a link's address, a contact's name and number, a place's coordinates and title.
     */
    readonly name: string
    /**
     * Set only for a content part that carries no file (a shared link, a contact card, a location): its media type (`text/uri-list`,
     * `text/vcard`, `application/geo+json`). The line keeps it as a typed part with no address (`notKept: "no_file"`), never fetched.
     */
    readonly contentType?: string | undefined
}

/** The bytes of a kept customer file, as a model call carries them. */
export interface CustomerFileBytes {
    /** The type read from the bytes. */
    readonly contentType: string
    /** The bytes. */
    readonly bytes: Uint8Array
}

/** A kept customer file's bytes, or null when the store no longer holds it or the address is not the shop's. */
export type OptionalCustomerFileBytes = CustomerFileBytes | null
