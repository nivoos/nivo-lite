import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { OpenLead as OpenLeadCell } from "../../common/open-lead.cell.ts"
import type { State } from "../front.workflow.ts"
import { Understand } from "./understand.step.ts"

/** Runs `OpenLead` (who owns a new lead until a person takes it over (an agent or a member id)) and keeps its result in `lead`; the run then goes to `Understand`. */
export class OpenLead extends NodeRun(OpenLeadCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({
        ref: s.messages[0].fromId,
        name: s.messages[0].fromName,
        source: "telegram",
        note: "",
    })
    override readonly into = ["lead"] as const
    override readonly next = Understand
}
