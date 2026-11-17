import { NodeWait, take } from "@starci/nivoos-sdk"
import { LeadQualified } from "../../../../common/events/lead-qualified.event.ts"
import { SlotChosen } from "../../common/slot-chosen.event.ts"
import type { State, Qualified, Chosen } from "../book-demo.workflow.ts"
import { Slots } from "./slots.step.ts"

/** The start, two ways: a qualified lead (invite it to choose a demo time) or a lead that answered the invitation (book the time it chose). */
export class Open extends NodeWait<typeof State> {
    override readonly take = [
        take<typeof State>(LeadQualified, {}, (s, qualified: Qualified[]) => { const [first] = qualified; if (first !== undefined) { s.leadId = first.leadId; s.phase = "invite" } }),
        take<typeof State>(SlotChosen, {}, (s, chosen: Chosen[]) => { const [first] = chosen; if (first !== undefined) { s.leadId = first.leadId; s.phase = "pick"; s.choiceText = first.text; s.choiceEmail = first.email } }),
    ]
    override readonly next = Slots
}
