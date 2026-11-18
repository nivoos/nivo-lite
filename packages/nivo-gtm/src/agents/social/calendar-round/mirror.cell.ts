import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import { keyOf } from "../../../package-key.ts"
import { FileSlotsOutput } from "./file-slots.cell.ts"

export const MirrorInput = z.strictObject({ weekCode: z.string().max(40), filed: FileSlotsOutput.shape.filed })
export const MirrorOutput = z.strictObject({
    mirrored: z.boolean(),
    rows: z.number().int(),
    refusal: z.string().max(80),
})
/** The calendar sheet: an empty `spreadsheetId` means no sheet is connected yet, and the week is not mirrored (the plan still works). */
export const MirrorSettings = z.strictObject({
    spreadsheetId: z.string().max(120).default(""),
    calendarSheetRange: z.string().min(1).max(100).default("Lich!A:E"),
})

type In = z.infer<typeof MirrorInput>
type Out = z.infer<typeof MirrorOutput>
type Settings = z.infer<typeof MirrorSettings>

/**
 * `nivo-gtm.social-mirror` (Chép lịch sang Google Sheets): the PROVIDER SEAM of the calendar mirror. The sheet is the setting `spreadsheetId` + `calendarSheetRange`; the act
 * itself, `google.sheets.values.append` of provider-templates on the account `sheets-marketing`, is a catalogue operation the SDK build cannot name as a node's mutation yet (only a package's own operations and the engine acts are
 * acting callees), so today the node answers `mirrored` false with the refusal `sheets_pending` ("chờ kết nối") and the run goes on: the calendar lives in the objects, the sheet is only a copy.
 */
export class SocialMirror implements Node<typeof MirrorInput, typeof MirrorOutput, typeof MirrorSettings> {
    readonly key = keyOf("social-mirror")
    readonly version = 1
    readonly title = { vi: "Chép lịch sang Google Sheets", en: "Mirror the calendar to Google Sheets" }
    readonly input = MirrorInput
    readonly output = MirrorOutput
    readonly settings = MirrorSettings
    readonly reads = []

    run(input: In, reach: NodeReach<Settings>): Out {
        const row = input.filed.length
        return {
            mirrored: false,
            rows: 0,
            refusal: row === 0 || reach.settings.spreadsheetId === "" ? "sheets_not_set" : "sheets_pending",
        }
    }
}
