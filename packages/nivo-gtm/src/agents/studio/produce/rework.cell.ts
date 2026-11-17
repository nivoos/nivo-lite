import { z } from "zod"
import type { Node, NodeReach, RoomMessagePost } from "@starci/nivoos-sdk"
import type { NivoRef } from "@starci/nivoos-sdk"
import { Content } from "../../../objects/content.object.ts"
import { keyOf } from "../../../package-key.ts"
import { addHours, clip } from "../common/helpers.ts"
import { AssignedShape } from "./assign.cell.ts"

export const ReworkInput = z.strictObject({ objectId: z.string().min(1) })
export const ReworkOutput = AssignedShape
/** How long the editor has to fix a cut a person sent back, and how long before the new due date they are reminded. */
export const ReworkSettings = z.strictObject({
    reworkDays: z.number().int().min(1).max(30).default(2),
    remindHours: z.number().int().min(1).max(240).default(12),
})

type In = z.infer<typeof ReworkInput>
type Out = z.infer<typeof ReworkOutput>
type Settings = z.infer<typeof ReworkSettings>

/**
 * `nivo-gtm.studio-rework` (Giao lại bản sửa): one act, `room.message.post`: the cut was sent back (the review wrote the reason to the item's next action), so the card tells the editor what to fix and the new due date. The
 * node answers the new due and reminder times, which the workflow's waits read; it then waits for the next cut again.
 */
export class StudioRework implements Node<typeof ReworkInput, typeof ReworkOutput, typeof ReworkSettings> {
    readonly key = keyOf("studio-rework")
    readonly version = 1
    readonly title = { vi: "Giao lại bản sửa", en: "Hand back the fix" }
    readonly input = ReworkInput
    readonly output = ReworkOutput
    readonly settings = ReworkSettings
    readonly reads = ["object.get"]
    readonly mutation = "room.message.post"

    run(input: In, reach: NodeReach<Settings>): Out {
        const got = reach.objects(Content).get(input.objectId as NivoRef<Content>)
        if (got.error) throw got.error
        const dueAt = addHours(reach.facts.at, reach.settings.reworkDays * 24)
        const remindAt = addHours(dueAt, -reach.settings.remindHours)
        const values = got.result.values
        const cardText = clip(`Bản dựng ${values.code} cần sửa. Việc cần làm: ${values.nextAction ?? "xem danh sách kiểm tra trong thẻ duyệt"}.\nHạn mới: ${dueAt.slice(0, 10)}. Sửa xong thì đổi trạng thái sang cut_ready và dán liên kết bản mới vào ô Bằng chứng.`, 3000)
        const { error } = reach.call<RoomMessagePost>("room.message.post", { text: cardText })
        if (error) throw error
        return { code: values.code, editor: values.owner ?? "", dueAt, remindAt, cardText, remindText: `Nhắc: bản sửa ${values.code} đến hạn ${dueAt.slice(0, 10)}.` }
    }
}
