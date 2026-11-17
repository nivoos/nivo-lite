import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import type { NivoRef } from "@starci/nivoos-sdk"
import { Content } from "../../../objects/content.object.ts"
import { keyOf } from "../../../package-key.ts"
import { addHours, clip } from "../common/helpers.ts"
import { ShotListOutput } from "./shot-list.cell.ts"
import { PrepareFolderOutput } from "./prepare-folder.cell.ts"

/** Who makes the video, until when, and the two cards the workflow posts about it (the brief now, the reminder before the due date). Rework writes the same shape. */
export const AssignedShape = z.strictObject({
    code: z.string().max(40),
    editor: z.string().max(80),
    dueAt: z.string(),
    remindAt: z.string(),
    cardText: z.string().min(1).max(3000),
    remindText: z.string().min(1).max(1000),
    overdueText: z.string().min(1).max(1000),
})

export const AssignInput = z.strictObject({ folder: PrepareFolderOutput, shots: ShotListOutput })
export const AssignOutput = AssignedShape
/** Who shoots and edits, how many days they have and how long before the due date they are reminded: per-customer rules with defaults. An empty `editor` leaves the item with the Studio agent until D5 names a person. */
export const AssignSettings = z.strictObject({
    editor: z.string().max(80).default(""),
    produceDays: z.number().int().min(1).max(60).default(5),
    remindHours: z.number().int().min(1).max(240).default(24),
})

type In = z.infer<typeof AssignInput>
type Out = z.infer<typeof AssignOutput>
type Settings = z.infer<typeof AssignSettings>

const STUDIO = "nivo-gtm.studio"

/**
 * `nivo-gtm.studio-assign` (Giao việc quay dựng): one act, `object.update` of the content item: status `producing`, the owner (the editor of the setting, else the Studio agent), the next action "Quay và dựng" due in
 * `produceDays`, the folder in the evidence. It also makes the brief card (who, until when, the shot list, how to hand the cut in) and the reminder text, so the next steps only post them.
 */
export class StudioAssign implements Node<typeof AssignInput, typeof AssignOutput, typeof AssignSettings> {
    readonly key = keyOf("studio-assign")
    readonly version = 2
    readonly title = { vi: "Giao việc quay dựng", en: "Assign the shoot and edit" }
    readonly input = AssignInput
    readonly output = AssignOutput
    readonly settings = AssignSettings
    readonly reads = ["object.get"]
    readonly mutation = "object.update"

    run(input: In, reach: NodeReach<Settings>): Out {
        const got = reach.objects(Content).get(input.folder.objectId as NivoRef<Content>)
        if (got.error) throw got.error
        const at = reach.facts.at
        const dueAt = addHours(at, reach.settings.produceDays * 24)
        const remindAt = addHours(dueAt, -reach.settings.remindHours)
        const editor = reach.settings.editor === "" ? STUDIO : reach.settings.editor
        const folderText = input.folder.folderLink === "" ? `${input.folder.driveNote}: tạo thư mục "${input.folder.folderName}" rồi dán liên kết vào ô Bằng chứng` : input.folder.folderLink
        const { error } = reach.objects(Content).update({
            id: got.result.id,
            version: got.result.version,
            values: {
                status: "producing",
                owner: editor,
                nextAction: reach.settings.editor === "" ? "Quay và dựng (chưa có người phụ trách: gán người quay dựng)" : "Quay và dựng",
                nextAt: dueAt,
                evidence: clip(folderText, 2000),
                driveFolder: clip(input.folder.folderLink, 500),
            },
        })
        if (error) throw error
        const shots = input.shots.shots.map((shot) => `${String(shot.n)}. ${shot.scene} (${shot.camera}): ${shot.line}`).join("\n")
        const code = got.result.values.code
        const cardText = clip(
            `Quay và dựng ${code}: ${input.folder.title}\nNgười làm: ${editor}. Hạn: ${dueAt.slice(0, 10)}.\nThư mục: ${folderText}\n\nDanh sách cảnh:\n${shots}\n\nCần chuẩn bị: ${input.shots.props.join(", ")}\n\nXong thì đổi trạng thái sang cut_ready và dán liên kết bản dựng vào ô Bằng chứng.`,
            3000,
        )
        return { code, editor, dueAt, remindAt, cardText, remindText: `Nhắc: ${code} đến hạn ${dueAt.slice(0, 10)}. Đổi trạng thái sang cut_ready và dán liên kết bản dựng khi xong.`, overdueText: `Quá hạn quay dựng ${code}: chưa có bản dựng. Hỏi người phụ trách ${editor}, gia hạn rồi chuyển trạng thái về script_ok để chạy lại khâu này.` }
    }
}
