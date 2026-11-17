/**
 * The provider seam of the Social agent: the channels the calendar can plan but no provider carries yet (decisions D1/D2: Facebook, TikTok, YouTube). Each names the account and the operation a later provider fills;
 * nothing here is implemented, so a publication planned for one of them ends `channel_pending` and is parked with its next action "chờ kết nối".
 */
export const PENDING_CHANNELS = [
    { channel: "facebook", account: "facebook-page", operation: "facebook.page.post", status: "chờ kết nối" },
    { channel: "tiktok", account: "tiktok-creator", operation: "tiktok.video.upload", status: "chờ kết nối" },
    { channel: "youtube", account: "youtube-channel", operation: "youtube.video.upload", status: "chờ kết nối" },
] as const

/** True when the channel has no provider yet. */
export const isPending = (channel: string): boolean => PENDING_CHANNELS.some((pending) => pending.channel === channel)
