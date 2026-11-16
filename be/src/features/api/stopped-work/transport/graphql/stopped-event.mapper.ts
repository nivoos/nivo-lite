import type { StoppedEventView } from "@modules/domain/job-ops"
import type { StoppedEventType } from "./dto/stopped-event.type"

/** Maps the buried events of a workspace to the GraphQL type. */
export const toStoppedEventTypes = (views: ReadonlyArray<StoppedEventView>): Array<StoppedEventType> =>
    views.map((view) => ({ ...view }))
