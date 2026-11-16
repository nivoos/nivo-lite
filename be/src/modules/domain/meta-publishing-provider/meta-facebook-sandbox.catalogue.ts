import { PROVIDER } from "@nivo-lite/agent-sdk/names"
import type { SandboxCase, SandboxCatalogue } from "@modules/domain/provider-sandbox"

/** The operation of a Page post in the sandbox call log and in the account's next-case selector (`<capability>.<verb>`: Instagram shares the key `meta`). */
export const FACEBOOK_PUBLISH_OPERATION = "facebook.publish"

/** The Page id every sandbox post id starts with (a Page post id is `<page id>_<post number>`). */
export const FACEBOOK_SANDBOX_PAGE_ID = "100000000000001"

/** The case ids by what they do, so the service and its specs name no bare number. */
export const FACEBOOK_CASE = {
    accepted: "FACEBOOK-1",
    photo: "FACEBOOK-2",
    video: "FACEBOOK-3",
    policy: "FACEBOOK-4",
    tooLarge: "FACEBOOK-5",
    authRefused: "FACEBOOK-6",
    rateLimited: "FACEBOOK-7",
    serverError: "FACEBOOK-8",
    timeout: "FACEBOOK-9",
    appliedNoAnswer: "FACEBOOK-10",
} as const

/** How a refused case ends: the refusal the live twin throws for a Graph answer, with Meta's words as the detail. */
export interface FacebookSandboxRefusal {
    readonly reason: "rejected" | "auth_refused"
    readonly detail: string
}

/** The refusing cases (picked by the account's next case; the request's own words never pick one). */
export const FACEBOOK_SANDBOX_REFUSALS: Readonly<Record<string, FacebookSandboxRefusal>> = {
    [FACEBOOK_CASE.policy]: { reason: "rejected", detail: "policy: spam content" },
    [FACEBOOK_CASE.tooLarge]: { reason: "rejected", detail: "video file too large" },
    [FACEBOOK_CASE.authRefused]: { reason: "auth_refused", detail: "Error validating access token: session expired" },
}

/**
 * The cases of the Facebook Page post (R62 next-case shape: ONE default, `FACEBOOK-1`, answered while nothing is picked; every other case
 * is picked per account and STICKY). The receipt's shape follows the request, as the live edges answer (a text or link post, a photo, a
 * video): `-2` and `-3` NAME the photo and the video receipt (accepted, tagged `ok`), they do not change what the request is. A post with
 * no message, link or media is refused `rejected` first, whatever case is picked (the live adapter's own precondition). Words: Graph's
 * `error.code` table of `integrations/meta-publishing` (190 auth; 4 / 17 / 341 rate; 1 / 2 outage) and the live adapter's refusals.
 */
export const FACEBOOK_SANDBOX_CASES: ReadonlyArray<SandboxCase> = [
    { id: FACEBOOK_CASE.accepted, label: "The post is accepted: a text or link post answers a post id", operation: FACEBOOK_PUBLISH_OPERATION, outcome: "ok", default: true },
    { id: FACEBOOK_CASE.photo, label: "A photo post is accepted: the post id and the photo's own id (the receipt follows the request's media)", operation: FACEBOOK_PUBLISH_OPERATION, outcome: "ok" },
    { id: FACEBOOK_CASE.video, label: "A video post is accepted: no post id yet, only the video's own id (the receipt follows the request's media)", operation: FACEBOOK_PUBLISH_OPERATION, outcome: "ok" },
    { id: FACEBOOK_CASE.policy, label: "Refused by the content policy (rejected, nothing posted)", operation: FACEBOOK_PUBLISH_OPERATION, outcome: "refused" },
    { id: FACEBOOK_CASE.tooLarge, label: "Refused as too large a video (rejected, nothing posted)", operation: FACEBOOK_PUBLISH_OPERATION, outcome: "refused" },
    { id: FACEBOOK_CASE.authRefused, label: "Refused: the Page token expired or was revoked (Graph code 190, auth refused, nothing posted); sticky, so every call is refused until the owner picks another case", operation: FACEBOOK_PUBLISH_OPERATION, outcome: "refused" },
    { id: FACEBOOK_CASE.rateLimited, label: "Graph answers its rate limit (code 4): nothing posted, a retry may pass", operation: FACEBOOK_PUBLISH_OPERATION, outcome: "transient" },
    { id: FACEBOOK_CASE.serverError, label: "Graph answers an outage (code 2, a 5xx): the outcome is unknown, nothing posted", operation: FACEBOOK_PUBLISH_OPERATION, outcome: "transient" },
    { id: FACEBOOK_CASE.timeout, label: "No answer arrives: the outcome is unknown and nothing was posted", operation: FACEBOOK_PUBLISH_OPERATION, outcome: "timeout" },
    { id: FACEBOOK_CASE.appliedNoAnswer, label: "No answer arrives, but the post WAS made (it is in the account's kept posts): a second publish posts again", operation: FACEBOOK_PUBLISH_OPERATION, outcome: "timeout" },
]

/** The hardcoded catalogue of the Facebook Page publishing sandbox (ruling R60): ids `FACEBOOK-<n>`, identical on every machine. */
export const FACEBOOK_SANDBOX_CATALOGUE: SandboxCatalogue = { provider: PROVIDER.meta, cases: FACEBOOK_SANDBOX_CASES }
