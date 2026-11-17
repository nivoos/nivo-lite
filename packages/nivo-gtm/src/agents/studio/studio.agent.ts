import type { Agent } from "@starci/nivoos-sdk"
import { DriveMarketing } from "../../accounts/drive-marketing.account.ts"
import { SheetsMarketing } from "../../accounts/sheets-marketing.account.ts"
import { TelegramTeam } from "../../accounts/telegram-team.account.ts"
import { keyOf } from "../../package-key.ts"
import { IdeaRound } from "./idea-round/idea-round.workflow.ts"
import { Pick } from "./pick/pick.workflow.ts"
import { Produce } from "./produce/produce.workflow.ts"
import { ReviewCut } from "./review-cut/review-cut.workflow.ts"
import { Script } from "./script/script.workflow.ts"

/**
 * `nivo-gtm.studio` (Xưởng video): the video studio of NIVO Tăng trưởng, nested in its workspace. It thinks up the week's ideas, writes the script, tracks the shoot and the edit (a person shoots and edits: the agent hands over
 * the shot list and reminds them of the due date) and sends the cut to a person for approval. It publishes nothing: an approved cut goes to the Social agent. Accountable person: the content lead (decision D5).
 * Every step is internal (a card in the team room is work, not an approval that leaves the company), so every step runs `auto`. Drive (the shoot folder, the cut landing in it) is the provider seam, "chờ kết nối":
 * see `providers/pending-operations.ts`.
 */
export class Studio implements Agent {
    readonly key = keyOf("studio")
    readonly version = 2
    readonly title = { vi: "Xưởng video", en: "Video studio" }
    readonly workflows = [IdeaRound, Pick, Script, Produce, ReviewCut]
    readonly providers = [TelegramTeam, DriveMarketing, SheetsMarketing]
}
