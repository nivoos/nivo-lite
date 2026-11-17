import { NodeWait, take, ObjectFieldChanged, type ObjectFieldChangedItem } from "@starci/nivoos-sdk"
import type { State } from "../quote.workflow.ts"
import { Read } from "./read.step.ts"

/** The start: a deal in proposal got its plan. */
export class Open extends NodeWait<typeof State> {
    override readonly take = [
        take<typeof State>(
            ObjectFieldChanged,
            { when: (items: ObjectFieldChangedItem[]) => items.filter((c) => c.typeKey === "gtm.deal" && c.field === "plan" && c.to !== null && c.values["status"] === "proposal") },
            (s, changes: ObjectFieldChangedItem[]) => { const [first] = changes; if (first !== undefined) s.change = { objectId: first.objectId, version: first.version } },
        ),
    ]
    override readonly next = Read
}
