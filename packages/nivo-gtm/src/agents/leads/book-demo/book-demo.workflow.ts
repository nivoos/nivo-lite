import { z } from "zod"
import type { Workflow } from "@starci/nivoos-sdk"
import { LeadQualifiedData } from "../../../common/events/lead-qualified.event.ts"
import { keyOf } from "../../../package-key.ts"
import { EmitDemoDoneOutput } from "../common/emit-demo-done.cell.ts"
import { SendLineOutput } from "../common/send-line.cell.ts"
import { SetStageOutput } from "../common/set-stage.cell.ts"
import { SlotChosenData } from "../common/slot-chosen.event.ts"
import { TouchLeadOutput } from "../common/touch-lead.cell.ts"
import { AskOutcomeOutput } from "./ask-outcome.cell.ts"
import { BookOutput } from "./book.cell.ts"
import { PickSlotOutput } from "./pick-slot.cell.ts"
import { RecordDemoOutput } from "./record-demo.cell.ts"
import { SendEmailOutput } from "./send-email.cell.ts"
import { SlotsOutput } from "./slots.cell.ts"
import { TellHostOutput } from "./tell-host.cell.ts"
import { RetryDecisionOutput } from "../../../common/recover/retry-decision.cell.ts"
import { ParkAlertOutput } from "../../../common/recover/park-alert.cell.ts"
import { Open } from "./steps/open.step.ts"
import { Slots } from "./steps/slots.step.ts"
import { HasSlots } from "./steps/has-slots.step.ts"
import { IsInvite } from "./steps/is-invite.step.ts"
import { SendInvite } from "./steps/send-invite.step.ts"
import { NoteInvite } from "./steps/note-invite.step.ts"
import { PickSlot } from "./steps/pick-slot.step.ts"
import { IsPicked } from "./steps/is-picked.step.ts"
import { Book } from "./steps/book.step.ts"
import { SendConfirm } from "./steps/send-confirm.step.ts"
import { HasEmail } from "./steps/has-email.step.ts"
import { SendEmail } from "./steps/send-email.step.ts"
import { TellHost } from "./steps/tell-host.step.ts"
import { NoteBooked } from "./steps/note-booked.step.ts"
import { WaitRemind } from "./steps/wait-remind.step.ts"
import { SendReminder } from "./steps/send-reminder.step.ts"
import { WaitDemoEnd } from "./steps/wait-demo-end.step.ts"
import { AskOutcome } from "./steps/ask-outcome.step.ts"
import { WaitOutcome } from "./steps/wait-outcome.step.ts"
import { RecordDemo } from "./steps/record-demo.step.ts"
import { SetLeadStage } from "./steps/set-lead-stage.step.ts"
import { IsDone } from "./steps/is-done.step.ts"
import { EmitDemoDone } from "./steps/emit-demo-done.step.ts"
import { EndNoSlots } from "./steps/end-no-slots.step.ts"
import { EndInvited } from "./steps/end-invited.step.ts"
import { EndDeclined } from "./steps/end-declined.step.ts"
import { EndOutcomePending } from "./steps/end-outcome-pending.step.ts"
import { EndDone } from "./steps/end-done.step.ts"
import { EndNotHeld } from "./steps/end-not-held.step.ts"
import { SentSendInvite } from "./steps/sent-send-invite.step.ts"
import { HeldSendInvite } from "./steps/held-send-invite.step.ts"
import { OkNoteInvite } from "./steps/ok-note-invite.step.ts"
import { OkPickSlot } from "./steps/ok-pick-slot.step.ts"
import { OkBook } from "./steps/ok-book.step.ts"
import { SentSendConfirm } from "./steps/sent-send-confirm.step.ts"
import { HeldSendConfirm } from "./steps/held-send-confirm.step.ts"
import { OkNoteBooked } from "./steps/ok-note-booked.step.ts"
import { SentSendReminder } from "./steps/sent-send-reminder.step.ts"
import { HeldSendReminder } from "./steps/held-send-reminder.step.ts"
import { OkRecordDemo } from "./steps/ok-record-demo.step.ts"
import { OkSetLeadStage } from "./steps/ok-set-lead-stage.step.ts"
import { Retry } from "./steps/retry.step.ts"
import { IsAgain } from "./steps/is-again.step.ts"
import { RetryWait } from "./steps/retry-wait.step.ts"
import { Resume1 } from "./steps/resume1.step.ts"
import { Resume2 } from "./steps/resume2.step.ts"
import { Resume3 } from "./steps/resume3.step.ts"
import { Resume4 } from "./steps/resume4.step.ts"
import { Resume5 } from "./steps/resume5.step.ts"
import { Resume6 } from "./steps/resume6.step.ts"
import { Resume7 } from "./steps/resume7.step.ts"
import { Resume8 } from "./steps/resume8.step.ts"
import { Resume9 } from "./steps/resume9.step.ts"
import { ParkFailed } from "./steps/park-failed.step.ts"
import { EndParked } from "./steps/end-parked.step.ts"

/** What `engine.room.answered` carries: the answer of a member to a card with choices. */
export const Answer = z.strictObject({ answerKey: z.string(), messageId: z.string(), roomId: z.string(), runId: z.string(), stepKey: z.string(), choice: z.string(), memberId: z.string() })

/** The one state object of a run: the lead and why the run opened (invite or pick, with the words the lead wrote), the free slots, and what each step did. */
export const State = z.strictObject({
    leadId: z.string().optional(),
    phase: z.enum(["invite", "pick"]).optional(),
    choiceText: z.string().optional(),
    choiceEmail: z.string().optional(),
    slots: SlotsOutput.optional(),
    sent: SendLineOutput.optional(),
    touched: TouchLeadOutput.optional(),
    pick: PickSlotOutput.optional(),
    book: BookOutput.optional(),
    confirmed: SendLineOutput.optional(),
    emailed: SendEmailOutput.optional(),
    told: TellHostOutput.optional(),
    staged: SetStageOutput.optional(),
    reminded: SendLineOutput.optional(),
    asked: AskOutcomeOutput.optional(),
    answers: z.array(Answer).max(5).optional(),
    recorded: RecordDemoOutput.optional(),
    leadStaged: SetStageOutput.optional(),
    emitted: EmitDemoDoneOutput.optional(),
    retry: RetryDecisionOutput.optional(),
    alert: ParkAlertOutput.optional(),
})
export type Qualified = z.infer<typeof LeadQualifiedData>
export type Chosen = z.infer<typeof SlotChosenData>
export type Answer = z.infer<typeof Answer>

/**
 * `nivo-gtm.leads-book-demo` (Hẹn demo): two entries, one workflow. A QUALIFIED lead gets the invitation: the free demo times (fixed times on weekdays, minus the demos already held) are offered
 * and the invitation is sent after a person approves it. When the lead answers (the front door hears it and emits `SlotChosen`), the run reads which offered time they meant, books it
 * (`gtm.demo` `confirmed`), confirms it on Telegram and by email (each after approval), tells the host, waits until `remindHours` before to remind the lead, and an hour after the demo asks the host
 * how it went; the answer moves the demo and the lead and, after a demo that happened, announces `DemoDone`. Until the conversation hold (E1) lands, the invitation run ends when it is sent and the
 * lead's answer starts the second run.
 *
 * Failure paths (the recovery rule): a step that is refused (a model that declines or has no credit, an object write that is stale or refused, a send the channel refuses for another reason than a held route) is
 * retried `retries` times (default 3) `retryMinutes` apart (customer settings of `retry-decision`), then the run posts ONE alert card to the team room and ends `parked`. Only a refusal the callee DECLARES can be handled this way;
 * an undeclared failure still stops the run at its node for a person.
 */
export class BookDemo implements Workflow<typeof State> {
    readonly key = keyOf("leads-book-demo")
    readonly version = 2
    readonly title = { vi: "Hẹn demo", en: "Book a demo" }
    readonly state = State
    readonly append = ["answers"] as const
    readonly maxLifetime = { days: 30 }
    readonly start = Open
    readonly steps = [Open, Slots, HasSlots, IsInvite, SendInvite, NoteInvite, PickSlot, IsPicked, Book, SendConfirm, HasEmail, SendEmail, TellHost, NoteBooked, WaitRemind, SendReminder, WaitDemoEnd, AskOutcome, WaitOutcome, RecordDemo, SetLeadStage, IsDone, EmitDemoDone, EndNoSlots, EndInvited, EndDeclined, EndOutcomePending, EndDone, EndNotHeld, SentSendInvite, HeldSendInvite, OkNoteInvite, OkPickSlot, OkBook, SentSendConfirm, HeldSendConfirm, OkNoteBooked, SentSendReminder, HeldSendReminder, OkRecordDemo, OkSetLeadStage, Retry, IsAgain, RetryWait, Resume1, Resume2, Resume3, Resume4, Resume5, Resume6, Resume7, Resume8, Resume9, ParkFailed, EndParked]
}
