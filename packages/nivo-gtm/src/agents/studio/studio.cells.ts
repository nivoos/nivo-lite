// The cells of the Studio agent: the one list the package entry spreads (`...STUDIO_CELLS`), so the entry takes one line for the whole agent.
import { StudioAskTeam } from "./common/ask-team.cell.ts"
import { StudioFileIdeas } from "./idea-round/file-ideas.cell.ts"
import { StudioIdeas } from "./idea-round/ideas.cell.ts"
import { StudioReadContext } from "./idea-round/read-context.cell.ts"
import { StudioApplyChoice } from "./pick/apply-choice.cell.ts"
import { StudioAssign } from "./produce/assign.cell.ts"
import { StudioEmitCutReady } from "./produce/emit-cut-ready.cell.ts"
import { StudioPrepareFolder } from "./produce/prepare-folder.cell.ts"
import { StudioRecordCut } from "./produce/record-cut.cell.ts"
import { StudioRework } from "./produce/rework.cell.ts"
import { StudioShotList } from "./produce/shot-list.cell.ts"
import { StudioCheckCut } from "./review-cut/check-cut.cell.ts"
import { StudioEmitApproved } from "./review-cut/emit-approved.cell.ts"
import { StudioMarkCut } from "./review-cut/mark-cut.cell.ts"
import { StudioReadCut } from "./review-cut/read-cut.cell.ts"
import { StudioReviewCard } from "./review-cut/review-card.cell.ts"
import { StudioSetContentStatus } from "./review-cut/set-content-status.cell.ts"
import { StudioApproveScript } from "./script/approve-script.cell.ts"
import { StudioDraft } from "./script/draft.cell.ts"
import { StudioReadBrief } from "./script/read-brief.cell.ts"
import { StudioRevise } from "./script/revise.cell.ts"
import { StudioSaveScript } from "./script/save-script.cell.ts"

export const STUDIO_CELLS = [
    StudioAskTeam,
    StudioReadContext,
    StudioIdeas,
    StudioFileIdeas,
    StudioApplyChoice,
    StudioReadBrief,
    StudioDraft,
    StudioSaveScript,
    StudioApproveScript,
    StudioRevise,
    StudioPrepareFolder,
    StudioShotList,
    StudioAssign,
    StudioRecordCut,
    StudioEmitCutReady,
    StudioRework,
    StudioReadCut,
    StudioCheckCut,
    StudioReviewCard,
    StudioMarkCut,
    StudioSetContentStatus,
    StudioEmitApproved,
]
