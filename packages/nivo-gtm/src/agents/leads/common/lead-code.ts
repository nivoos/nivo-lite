/**
 * A lead's code is its address on the channel: `<channel>-<id>`. A bare id is a Telegram id (`tg`), `<channel>:<id>` names another channel. The code is unique and indexed on the
 * `gtm.lead` object, so it is how a lead is found again and how a run that has only the lead (not the chat) knows where to write.
 */
export const leadCodeOf = (ref: string): string => {
    const text = ref.trim()
    const cut = text.indexOf(":")
    return cut > 0 ? `${text.slice(0, cut)}-${text.slice(cut + 1)}` : `tg-${text}`
}

/** The Telegram chat id a lead code (or a bare chat id) stands for: a private chat has the person's id as its chat id. */
export const chatIdOf = (to: string): string => (to.startsWith("tg-") ? to.slice(3) : to)
