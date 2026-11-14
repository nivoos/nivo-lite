"use client"

import {
    mutateRequeueStoppedEvent,
    type mutateRequeueStoppedEvent as MutateRequeueStoppedEventOperation,
} from "@/modules/api/graphql/mutations/mutation-requeue-stopped-event"
import { answeredData } from "@/hooks/workspaceread"
import useSWRMutation, { type SWRMutationResponse } from "swr/mutation"
import type { RequeueStoppedEventMutation } from "@/modules/api"

/** The SWR key of the requeueStoppedEvent mutation. */
export const MUTATE_REQUEUE_STOPPED_EVENT_SWR_KEY = "MUTATE_REQUEUE_STOPPED_EVENT_SWR"

/** SWR mutation for {@link mutateRequeueStoppedEvent}: Puts a buried event back on its queue. `trigger(input)` answers the payload and rejects with the back end failure. */
export const useMutateRequeueStoppedEventSwr = (): SWRMutationResponse<
    RequeueStoppedEventMutation["requeueStoppedEvent"],
    Error,
    typeof MUTATE_REQUEUE_STOPPED_EVENT_SWR_KEY,
    TriggerArg["arg"]
> =>
    useSWRMutation(
        MUTATE_REQUEUE_STOPPED_EVENT_SWR_KEY,
        async (_key: string, { arg }: TriggerArg) =>
            answeredData(await mutateRequeueStoppedEvent({ request: arg }), MUTATE_REQUEUE_STOPPED_EVENT_SWR_KEY).requeueStoppedEvent,
    )

/** The request accepted by this operation trigger. */
interface TriggerArg {
    readonly arg: Parameters<typeof MutateRequeueStoppedEventOperation>[0]["request"]
}
