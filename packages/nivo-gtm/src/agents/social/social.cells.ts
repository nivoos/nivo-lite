// The cells of the Social agent: the one list the package entry spreads (`...SOCIAL_CELLS`), so the entry takes one line for the whole agent.
import { SocialAskTeam } from "./common/ask-team.cell.ts"
import { SocialCalendarRead } from "./calendar-round/read.cell.ts"
import { SocialPlan } from "./calendar-round/plan.cell.ts"
import { SocialFileSlots } from "./calendar-round/file-slots.cell.ts"
import { SocialMirror } from "./calendar-round/mirror.cell.ts"
import { SocialSchedule } from "./calendar-round/schedule.cell.ts"
import { SocialDraftRead } from "./post-draft/read.cell.ts"
import { SocialDraft } from "./post-draft/draft.cell.ts"
import { SocialRevise } from "./post-draft/revise.cell.ts"
import { SocialSaveDraft } from "./post-draft/save.cell.ts"
import { SocialApprovePost } from "./post-draft/approve.cell.ts"
import { SocialEmitApproved } from "./post-draft/emit-approved.cell.ts"
import { SocialPublishOpen } from "./publish/open.cell.ts"
import { SocialFinalCheck } from "./publish/final-check.cell.ts"
import { SocialSend } from "./publish/send.cell.ts"
import { SocialRecord } from "./publish/record.cell.ts"
import { SocialMarkContentPublished } from "./publish/mark-content.cell.ts"
import { SocialEmitPublished } from "./publish/emit-published.cell.ts"
import { SocialSort } from "./replies/sort.cell.ts"
import { SocialLeadSignal } from "./replies/lead-signal.cell.ts"
import { SocialAnswer } from "./replies/answer.cell.ts"
import { SocialSendReply } from "./replies/send-reply.cell.ts"
import { SocialPull } from "./performance-round/pull.cell.ts"
import { SocialSaveMetrics } from "./performance-round/save-metrics.cell.ts"
import { SocialReport } from "./performance-round/report.cell.ts"
import { SocialKpiSheet } from "./performance-round/sheet.cell.ts"

export const SOCIAL_CELLS = [
    SocialAskTeam,
    SocialCalendarRead,
    SocialPlan,
    SocialFileSlots,
    SocialMirror,
    SocialSchedule,
    SocialDraftRead,
    SocialDraft,
    SocialRevise,
    SocialSaveDraft,
    SocialApprovePost,
    SocialEmitApproved,
    SocialPublishOpen,
    SocialFinalCheck,
    SocialSend,
    SocialRecord,
    SocialMarkContentPublished,
    SocialEmitPublished,
    SocialSort,
    SocialLeadSignal,
    SocialAnswer,
    SocialSendReply,
    SocialPull,
    SocialSaveMetrics,
    SocialReport,
    SocialKpiSheet,
]
