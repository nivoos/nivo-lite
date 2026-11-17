import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import type { NivoRef } from "@starci/nivoos-sdk"
import { Content } from "../../../objects/content.object.ts"
import { keyOf } from "../../../package-key.ts"
import { PENDING_DRIVE_STATUS } from "../providers/pending-operations.ts"

export const PrepareFolderInput = z.strictObject({ objectId: z.string().min(1) })
export const PrepareFolderOutput = z.strictObject({
    objectId: z.string(),
    code: z.string().max(40),
    title: z.string().max(200),
    folderName: z.string().max(260),
    /** The link of the shoot folder: the one the team set, else empty. */
    folderLink: z.string().max(500),
    /** `set` when a folder link is given by the setting; `pending` is the provider seam: Drive is not connected yet ("chờ kết nối"). */
    drive: z.enum(["set", "pending"]),
    driveNote: z.string().max(200),
})
/** The shoot folder the team made by hand while the Drive provider is "chờ kết nối": its link, if there is one. */
export const PrepareFolderSettings = z.strictObject({ shootFolderLink: z.string().max(500).default("") })

type In = z.infer<typeof PrepareFolderInput>
type Out = z.infer<typeof PrepareFolderOutput>
type Settings = z.infer<typeof PrepareFolderSettings>

/**
 * `nivo-gtm.studio-prepare-folder` (Chuẩn bị thư mục quay dựng): a decision node. The plan creates `<code> <title>` under the marketing Drive with `google-drive.files.create`; a business package cannot act through a catalogue
 * operation (the build knows only the package's own operations and the engine's acts), so the folder is the PROVIDER SEAM: this node names the folder, and says "chờ kết nối" unless the team gives a folder link in the setting.
 * The produce flow does not wait for Drive: the person who shoots creates the folder and puts its link in the item's evidence.
 */
export class StudioPrepareFolder implements Node<typeof PrepareFolderInput, typeof PrepareFolderOutput, typeof PrepareFolderSettings> {
    readonly key = keyOf("studio-prepare-folder")
    readonly version = 1
    readonly title = { vi: "Chuẩn bị thư mục quay dựng", en: "Prepare the shoot folder" }
    readonly input = PrepareFolderInput
    readonly output = PrepareFolderOutput
    readonly settings = PrepareFolderSettings
    readonly reads = ["object.get"]

    run(input: In, reach: NodeReach<Settings>): Out {
        const got = reach.objects(Content).get(input.objectId as NivoRef<Content>)
        if (got.error) throw got.error
        const { code, title } = got.result.values
        const link = reach.settings.shootFolderLink
        return {
            objectId: got.result.id,
            code,
            title,
            folderName: `${code} ${title}`.slice(0, 260),
            folderLink: link,
            drive: link === "" ? "pending" : "set",
            driveNote: link === "" ? PENDING_DRIVE_STATUS : "Thư mục do đội tạo",
        }
    }
}
