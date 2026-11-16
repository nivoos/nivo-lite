import type { StoppedWorkView } from "@modules/domain/job-ops"
import type { StoppedWorkType } from "./dto/stopped-work.type"

/** Maps the stopped jobs of a workspace to the GraphQL type. */
export const toStoppedWorkTypes = (views: ReadonlyArray<StoppedWorkView>): Array<StoppedWorkType> =>
    views.map((view) => ({ ...view }))
