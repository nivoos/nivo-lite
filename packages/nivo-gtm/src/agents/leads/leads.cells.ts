// Every cell class of the Leads agent (nodes and its own event kind), as ONE list the package entry spreads: `...LEADS_CELLS`.
import { SlotChosen } from "./common/slot-chosen.event.ts"
import { EmitDemoDone } from "./common/emit-demo-done.cell.ts"
import { EmitLeadQualified } from "./common/emit-lead-qualified.cell.ts"
import { EmitLeadReady } from "./common/emit-lead-ready.cell.ts"
import { EmitSlotChosen } from "./common/emit-slot-chosen.cell.ts"
import { FindLead } from "./common/find-lead.cell.ts"
import { OpenLead } from "./common/open-lead.cell.ts"
import { PostNotice } from "./common/post-notice.cell.ts"
import { SendLine } from "./common/send-line.cell.ts"
import { SetStage } from "./common/set-stage.cell.ts"
import { TouchLead } from "./common/touch-lead.cell.ts"
import { AskOutcome } from "./book-demo/ask-outcome.cell.ts"
import { Book } from "./book-demo/book.cell.ts"
import { PickSlot } from "./book-demo/pick-slot.cell.ts"
import { RecordDemo } from "./book-demo/record-demo.cell.ts"
import { SendConfirm } from "./book-demo/send-confirm.cell.ts"
import { SendEmail } from "./book-demo/send-email.cell.ts"
import { SendInvite } from "./book-demo/send-invite.cell.ts"
import { SendReminder } from "./book-demo/send-reminder.cell.ts"
import { Slots } from "./book-demo/slots.cell.ts"
import { TellHost } from "./book-demo/tell-host.cell.ts"
import { Answer } from "./front/answer.cell.ts"
import { Readiness } from "./front/readiness.cell.ts"
import { Understand } from "./front/understand.cell.ts"
import { CheckFollowUp } from "./nurture/check-follow-up.cell.ts"
import { CountFollowUp } from "./nurture/count-follow-up.cell.ts"
import { DraftFollowUp } from "./nurture/draft-follow-up.cell.ts"
import { SaveScore } from "./qualify/save-score.cell.ts"
import { Score } from "./qualify/score.cell.ts"
import { CountLeads } from "./report/count-leads.cell.ts"
import { Opener } from "./signal/opener.cell.ts"

export const LEADS_CELLS = [
    SlotChosen,
    FindLead,
    OpenLead,
    TouchLead,
    SetStage,
    SendLine,
    PostNotice,
    EmitLeadReady,
    EmitSlotChosen,
    EmitLeadQualified,
    EmitDemoDone,
    Understand,
    Answer,
    Readiness,
    Opener,
    Score,
    SaveScore,
    CheckFollowUp,
    DraftFollowUp,
    CountFollowUp,
    Slots,
    SendInvite,
    PickSlot,
    Book,
    SendConfirm,
    SendEmail,
    TellHost,
    SendReminder,
    AskOutcome,
    RecordDemo,
    CountLeads,
]
