"use client"

import {
    mutateSetContactDoNotContact,
    type mutateSetContactDoNotContact as MutateSetContactDoNotContactOperation,
} from "@/modules/api/graphql/mutations/mutation-set-contact-do-not-contact"
import { answeredData } from "@/hooks/workspaceread"
import useSWRMutation, { type SWRMutationResponse } from "swr/mutation"
import type { SetContactDoNotContactMutation } from "@/modules/api"

/** The SWR key of the setContactDoNotContact mutation. */
export const MUTATE_SET_CONTACT_DO_NOT_CONTACT_SWR_KEY = "MUTATE_SET_CONTACT_DO_NOT_CONTACT_SWR"

/** SWR mutation for {@link mutateSetContactDoNotContact}: Sets or clears the do-not-contact mark of a person. `trigger(input)` answers the payload and rejects with the back end failure. */
export const useMutateSetContactDoNotContactSwr = (): SWRMutationResponse<
    SetContactDoNotContactMutation["setContactDoNotContact"],
    Error,
    typeof MUTATE_SET_CONTACT_DO_NOT_CONTACT_SWR_KEY,
    TriggerArg["arg"]
> =>
    useSWRMutation(
        MUTATE_SET_CONTACT_DO_NOT_CONTACT_SWR_KEY,
        async (_key: string, { arg }: TriggerArg) =>
            answeredData(await mutateSetContactDoNotContact({ request: arg }), MUTATE_SET_CONTACT_DO_NOT_CONTACT_SWR_KEY).setContactDoNotContact,
    )

/** The request accepted by this operation trigger. */
interface TriggerArg {
    readonly arg: Parameters<typeof MutateSetContactDoNotContactOperation>[0]["request"]
}
