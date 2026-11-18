import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import { keyOf } from "../../../package-key.ts"
import { PullOutput } from "./pull.cell.ts"

export const SheetInput = z.strictObject({ instant: z.string().max(40), totals: PullOutput.shape.totals })
export const SheetOutput = z.strictObject({ appended: z.boolean(), refusal: z.string().max(80) })
/** The KPI sheet: an empty `spreadsheetId` means no sheet is connected yet, and the row is skipped. */
export const SheetSettings = z.strictObject({
    spreadsheetId: z.string().max(120).default(""),
    kpiSheetRange: z.string().min(1).max(100).default("KPI!A:G"),
})

type In = z.infer<typeof SheetInput>
type Out = z.infer<typeof SheetOutput>
type Settings = z.infer<typeof SheetSettings>

/**
 * `nivo-gtm.social-kpi-sheet` (Ghi dòng KPI vào Google Sheets): the PROVIDER SEAM of the KPI row (date, publications, views, reach, engagements, clicks, leads) for the sheet of the setting `spreadsheetId` + `kpiSheetRange`. The act,
 * `google.sheets.values.append` on the account `sheets-marketing`, cannot be named as a node mutation by the SDK build yet (catalogue operations are not acting callees), so the node answers `appended` false with `sheets_pending`
 * ("chờ kết nối"); the week's report is already in the team room.
 */
export class SocialKpiSheet implements Node<typeof SheetInput, typeof SheetOutput, typeof SheetSettings> {
    readonly key = keyOf("social-kpi-sheet")
    readonly version = 1
    readonly title = { vi: "Ghi dòng KPI vào Google Sheets", en: "Append the KPI row" }
    readonly input = SheetInput
    readonly output = SheetOutput
    readonly settings = SheetSettings
    readonly reads = []

    run(_input: In, reach: NodeReach<Settings>): Out {
        return { appended: false, refusal: reach.settings.spreadsheetId === "" ? "sheets_not_set" : "sheets_pending" }
    }
}
