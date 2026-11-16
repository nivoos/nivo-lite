import type { AccountDataInput } from "@modules/domain/account-data"
import type { MetaEvent } from "@modules/integrations/meta"
import { metaEvent, metaMessage, metaUser } from "./meta.data-types"

/** The event row of one event of a connected surface: the normalised `MetaEvent` untouched in `raw`, keyed by its `event_key`. */
export const metaEventRowsOf = (event: MetaEvent): ReadonlyArray<AccountDataInput> => [
    { type: metaEvent.name, value: { eventKey: event.event_key, raw: event } },
]

/**
 * What the account keeps of one event beside it: the person of a direct message or a postback (`meta.user`, by their page / Instagram scoped
 * id), and a direct message with any content (`meta.message`, by the event key: its words, empty for parts only, and its parts). Comments and mentions keep nothing here: they live with the
 * Page's comments.
 */
export const metaDerivedRowsOf = (event: MetaEvent): ReadonlyArray<AccountDataInput> => {
    const person = event.sender_psid ?? event.sender_igsid
    if ((event.kind !== "dm" && event.kind !== "postback") || person === null) return []
    const user: AccountDataInput = {
        type: metaUser.name,
        value: {
            userId: person,
            platform: event.platform,
            ...(event.sender_name === null ? {} : { name: event.sender_name }),
        },
    }
    // A DM with any content (words or a part) is a message the account keeps; one with neither keeps only its person.
    const parts = event.attachments ?? []
    if (event.kind !== "dm" || ((event.text === null || event.text === "") && parts.length === 0)) return [user]
    const message: AccountDataInput = {
        type: metaMessage.name,
        value: {
            eventKey: event.event_key,
            ...(event.mid === null ? {} : { mid: event.mid }),
            platform: event.platform,
            userId: person,
            direction: "in",
            text: event.text ?? "",
            ...(parts.length === 0 ? {} : { attachments: parts.map((part) => ({ type: part.type, url: part.url, name: part.name })) }),
            at: new Date(event.timestamp).toISOString(),
        },
    }
    return [message, user]
}
