import { NodeWait, ObjectFieldChanged, take, type ObjectFieldChangedItem } from "@starci/nivoos-sdk"
import { ReadBrief } from "./read-brief.step.ts"
import type { State } from "../script.workflow.ts"

/** A video idea became `chosen`: one run per content item (the subject is the object). */
export class Open extends NodeWait<typeof State> {
    override readonly take = [
        take<typeof State>(
            ObjectFieldChanged,
            { when: (items: ObjectFieldChangedItem[]) => items.filter((change) => change.typeKey === "gtm.content" && change.field === "status" && change.to === "chosen" && change.values.kind === "video") },
            (s, changes: ObjectFieldChangedItem[]) => { const [first] = changes; if (first !== undefined) s.change = { objectId: first.objectId } },
        ),
    ]
    override readonly next = ReadBrief
}
