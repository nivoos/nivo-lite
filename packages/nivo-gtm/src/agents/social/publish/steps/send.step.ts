import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SocialSend as SendCell } from "../send.cell.ts"
import { TelegramTeam } from "../../../../accounts/telegram-team.account.ts"
import { IsSent } from "./is-sent.step.ts"
import type { State } from "../publish.workflow.ts"

/** The ask step: a person approves the post before it leaves the company. */
export class Send extends NodeRun(SendCell)<typeof State> {
    override readonly account = TelegramTeam
    override readonly input = (s: StateView<typeof State>) => ({ channel: s.slot.channel, text: s.slot.text })
    override readonly into = ["sent"] as const
    override readonly next = IsSent
}
