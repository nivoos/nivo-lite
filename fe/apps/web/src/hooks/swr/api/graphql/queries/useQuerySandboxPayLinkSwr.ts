"use client"

import useSWR from "swr"
import { useWorkspaceKey } from "@/hooks/workspaceKey"
import { querySandboxPayLink } from "@/modules/api/graphql/queries/query-sandbox-pay-link"
import { answeredData, type WorkspaceReadKey, type ReadResponse } from "@/hooks/workspaceread"
import type { SandboxPayLinkQuery } from "@/modules/api"

/** The SWR key of the sandboxPayLink query. */
export const QUERY_SANDBOX_PAY_LINK_SWR_KEY = "QUERY_SANDBOX_PAY_LINK_SWR"

/**
 * One sandbox pay link (account, amount, content, order code, state, the cases that apply); `undefined` waits. A refusal (unknown link,
 * live account, switch off) is a typed answer of the page, so the read does not ask again by itself.
 */
export const useQuerySandboxPayLinkSwr = (
    linkId: string | undefined,
): ReadResponse<SandboxPayLinkQuery["sandboxPayLink"]> =>
    useSWR(
        useWorkspaceKey(QUERY_SANDBOX_PAY_LINK_SWR_KEY, [linkId ?? ""], linkId !== undefined),
        ([, , value]: WorkspaceReadKey<string>) =>
            querySandboxPayLink({ request: { linkId: value } }).then(
                (answer) => answeredData(answer, "sandboxPayLink").sandboxPayLink,
            ),
        { shouldRetryOnError: false },
    )
