import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { TellHost as TellHostCell } from "../tell-host.cell.ts"
import type { State } from "../book-demo.workflow.ts"
import { NoteBooked } from "./note-booked.step.ts"

export class TellHost extends NodeRun(TellHostCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ name: s.slots.name, label: s.book.label, link: s.book.link, host: s.book.host })
    override readonly into = ["told"] as const
    override readonly next = NoteBooked
}
