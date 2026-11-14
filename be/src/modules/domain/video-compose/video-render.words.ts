import type { TriggerDeclaration } from "@modules/domain/provider-triggers"

/** The owner words of a declaration, and its reason for having no poll (read off the one contract). */
type TriggerOwnerWords = TriggerDeclaration["words"]
type TriggerWithoutPoll = NonNullable<TriggerDeclaration["withoutPoll"]>

/*
 * THE WORDS OF THE COMPOSE PROVIDERS' RENDER TRIGGER (the owner's switch page and a graph's trigger picker read them from the declaration;
 * they moved here from the old trigger catalogue). The members' keys are members of the trigger's `data`.
 */

/** What the owner's pages say of the render trigger: its title, what it is, and what each member of its data means. */
export const RENDER_TRIGGER_WORDS: TriggerOwnerWords = {
    title: { vi: "Dựng video · đã dựng xong", en: "Video render · finished" },
    summary: {
        vi: "Một video đã dựng xong (hoặc dựng lỗi).",
        en: "A video render finished (done or failed).",
    },
    members: {
        renderId: { vi: "Mã lần dựng tại nhà cung cấp.", en: "The provider's id of the render." },
        status: { vi: "done là xong, failed là lỗi.", en: "done or failed." },
        outputUrl: { vi: "Địa chỉ video đã dựng xong (khi done).", en: "The address of the finished video (when done)." },
        error: { vi: "Lời nhà cung cấp báo khi dựng lỗi (khi failed).", en: "The provider's words when the render failed (when failed)." },
        provider: { vi: "Nhà cung cấp đã dựng.", en: "The compose provider that rendered it." },
    },
}

/**
 * Why a render needs no poll. None of the three compose providers has a call that lists an account's renders (their public API
 * references document only the read of ONE render by its id: Creatomate "Get the status of a render", Shotstack's render read, JSON2Video
 * `GET /v2/movies?project=`), and the ids of the renders still open are held by the runs that wait for them (a NIVO table a poll receiver
 * may not read). So the completion arrives by the provider's webhook; a lost one is brought back by the engine's own road: the waiting run
 * has a deadline (every `wait` has a timeout road, triggers rule 12) fired by the thread-deadline job, and the run then reads the render
 * itself with the `video.render.get` tool.
 */
export const RENDER_WITHOUT_POLL: TriggerWithoutPoll = {
    reason: {
        vi: "Nhà cung cấp dựng video không có lệnh liệt kê các lần dựng, nên không đọc lại theo cửa sổ được. Lần dựng nào bị lỡ thì lượt chạy đang chờ nó hết hạn chờ (job thread_deadline) rồi tự đọc trạng thái lần dựng bằng công cụ video.render.get.",
        en: "The compose providers have no call that lists renders, so there is no window to read back. A completion that is lost is caught by the waiting run's own deadline (the thread_deadline job): the run then reads the render's status itself with the video.render.get tool.",
    },
    source: "nivo:thread_deadline",
}
