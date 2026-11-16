import { PROVIDER } from "@nivo-lite/agent-sdk/names"
import type { SandboxCase, SandboxCatalogue } from "@modules/domain/provider-sandbox"

/** The `status_code` words a container goes through, in the order its status reads walk them (the last one is where it stays): the live adapter's own table (`ContainerStatusCode`). */
export type InstagramSandboxCodes = ReadonlyArray<"IN_PROGRESS" | "FINISHED" | "ERROR" | "EXPIRED">

/** The operations in the sandbox call log and in the account's next-case selector (`<capability>.<verb>`: Facebook shares the key `meta`). */
export const INSTAGRAM_PUBLISH_OPERATION = "instagram.publish"
export const INSTAGRAM_STATUS_OPERATION = "instagram.status"
export const INSTAGRAM_RELEASE_OPERATION = "instagram.release"

/** The longest carousel Instagram content publishing documents (the live adapter refuses a longer one before anything is sent). */
export const INSTAGRAM_SANDBOX_CAROUSEL_MAX = 20

/** The case ids by what they do, so the service and its specs name no bare number. */
export const INSTAGRAM_CASE = {
    accepted: "INSTAGRAM-1",
    processing: "INSTAGRAM-2",
    encodingError: "INSTAGRAM-3",
    policy: "INSTAGRAM-4",
    tooLong: "INSTAGRAM-5",
    authRefused: "INSTAGRAM-6",
    releaseNotFound: "INSTAGRAM-7",
    neverFinishes: "INSTAGRAM-8",
    statusNotFound: "INSTAGRAM-9",
    statusRead: "INSTAGRAM-10",
    releaseRead: "INSTAGRAM-11",
    rateLimited: "INSTAGRAM-12",
    serverError: "INSTAGRAM-13",
    timeout: "INSTAGRAM-14",
    appliedNoAnswer: "INSTAGRAM-15",
    carouselPartial: "INSTAGRAM-16",
    expired: "INSTAGRAM-17",
    statusAuthRefused: "INSTAGRAM-18",
    statusRateLimited: "INSTAGRAM-19",
    statusTimeout: "INSTAGRAM-20",
    releaseAuthRefused: "INSTAGRAM-21",
    releaseRateLimited: "INSTAGRAM-22",
    releaseTimeout: "INSTAGRAM-23",
    releaseAppliedNoAnswer: "INSTAGRAM-24",
} as const

/** The status words the container a publish case creates walks, one per status read (the case a publish picks decides the container's fate). */
export const INSTAGRAM_CONTAINER_WALKS: Readonly<Record<string, InstagramSandboxCodes>> = {
    [INSTAGRAM_CASE.accepted]: ["FINISHED"],
    [INSTAGRAM_CASE.processing]: ["IN_PROGRESS", "FINISHED"],
    [INSTAGRAM_CASE.encodingError]: ["IN_PROGRESS", "ERROR"],
    [INSTAGRAM_CASE.neverFinishes]: ["IN_PROGRESS"],
    [INSTAGRAM_CASE.expired]: ["IN_PROGRESS", "EXPIRED"],
}

/** How a refused case ends: the refusal the live twin throws for a Graph answer, with Meta's words as the detail. */
export interface InstagramSandboxRefusal {
    readonly reason: "rejected" | "auth_refused" | "not_found"
    readonly detail: string
}

/** The refusing cases, by case id (picked by the account's next case of the operation; the request's own words never pick one). */
export const INSTAGRAM_SANDBOX_REFUSALS: Readonly<Record<string, InstagramSandboxRefusal>> = {
    [INSTAGRAM_CASE.policy]: { reason: "rejected", detail: "policy: media violates community guidelines" },
    [INSTAGRAM_CASE.tooLong]: { reason: "rejected", detail: "video duration over the limit" },
    [INSTAGRAM_CASE.authRefused]: { reason: "auth_refused", detail: "Error validating access token: session expired" },
    [INSTAGRAM_CASE.releaseNotFound]: { reason: "not_found", detail: "container not found" },
    [INSTAGRAM_CASE.statusNotFound]: { reason: "not_found", detail: "container not found" },
    [INSTAGRAM_CASE.statusAuthRefused]: { reason: "auth_refused", detail: "Error validating access token: session expired" },
    [INSTAGRAM_CASE.releaseAuthRefused]: { reason: "auth_refused", detail: "Error validating access token: session expired" },
}

const publish = (id: string, label: string, outcome: NonNullable<SandboxCase["outcome"]>, isDefault = false): SandboxCase => ({
    id,
    label,
    operation: INSTAGRAM_PUBLISH_OPERATION,
    outcome,
    ...(isDefault ? { default: true as const } : {}),
})
const status = (id: string, label: string, outcome: NonNullable<SandboxCase["outcome"]>, isDefault = false): SandboxCase => ({
    id,
    label,
    operation: INSTAGRAM_STATUS_OPERATION,
    outcome,
    ...(isDefault ? { default: true as const } : {}),
})
const release = (id: string, label: string, outcome: NonNullable<SandboxCase["outcome"]>, isDefault = false): SandboxCase => ({
    id,
    label,
    operation: INSTAGRAM_RELEASE_OPERATION,
    outcome,
    ...(isDefault ? { default: true as const } : {}),
})

/**
 * The cases of Instagram content publishing (R62 next-case shape: ONE default per operation, answered while nothing is picked; every other
 * case is picked per account and operation and is STICKY). A PUBLISH case also decides the FATE of the container it creates: the status
 * words its later `instagram.status` / `instagram.release` reads walk (the live adapter's `status_code` table). Words: Graph's `error.code`
 * table of `integrations/meta-publishing` (190 auth, 4 / 17 / 341 rate, 1 / 2 outage) and the live adapter's own refusals.
 */
export const INSTAGRAM_SANDBOX_CASES: ReadonlyArray<SandboxCase> = [
    publish(INSTAGRAM_CASE.accepted, "The media request creates a container that is finished at once and is published in the same call", "ok", true),
    publish(INSTAGRAM_CASE.processing, "The container is still processing; a later status read says finished, release publishes it", "ok"),
    publish(INSTAGRAM_CASE.encodingError, "The container is accepted, then its status read says ERROR (failed, never publishable)", "ok"),
    publish(INSTAGRAM_CASE.policy, "Refused by the content policy (rejected, nothing created)", "refused"),
    publish(INSTAGRAM_CASE.tooLong, "Refused as too long a video (rejected, nothing created)", "refused"),
    publish(INSTAGRAM_CASE.authRefused, "Refused: the token expired or was revoked (Graph code 190, auth refused); sticky, so every call is refused until the owner picks another case", "refused"),
    release(INSTAGRAM_CASE.releaseNotFound, "Releasing a container the account never created answers not found", "refused"),
    publish(INSTAGRAM_CASE.neverFinishes, "The container is accepted and stays IN_PROGRESS on every status read, for ever", "ok"),
    status(INSTAGRAM_CASE.statusNotFound, "Reading the status of a container the account never created answers not found", "refused"),
    status(INSTAGRAM_CASE.statusRead, "The status read answers where the container stands (the status words its publish case set)", "ok", true),
    release(INSTAGRAM_CASE.releaseRead, "The release reads the container and publishes it when it is finished; any other state is answered as it stands", "ok", true),
    publish(INSTAGRAM_CASE.rateLimited, "Graph answers its rate limit (code 4): nothing created, a retry may pass", "transient"),
    publish(INSTAGRAM_CASE.serverError, "Graph answers an outage (code 2, a 5xx): the outcome is unknown, nothing created", "transient"),
    publish(INSTAGRAM_CASE.timeout, "No answer arrives: the outcome is unknown and nothing was created", "timeout"),
    publish(INSTAGRAM_CASE.appliedNoAnswer, "No answer arrives, but the container WAS created (its id is the next running one, a status read finds it)", "timeout"),
    publish(INSTAGRAM_CASE.carouselPartial, "A carousel: the first item's container is created, the second item is refused (rejected); nothing is published (a request that is no carousel is answered like the default)", "refused"),
    publish(INSTAGRAM_CASE.expired, "The container is accepted, then its status read says EXPIRED (never publishable)", "ok"),
    status(INSTAGRAM_CASE.statusAuthRefused, "The status read is refused: the token expired or was revoked (Graph code 190)", "refused"),
    status(INSTAGRAM_CASE.statusRateLimited, "The status read hits Graph's rate limit (code 4): a retry may pass", "transient"),
    status(INSTAGRAM_CASE.statusTimeout, "The status read never answers", "timeout"),
    release(INSTAGRAM_CASE.releaseAuthRefused, "The release is refused: the token expired or was revoked (Graph code 190)", "refused"),
    release(INSTAGRAM_CASE.releaseRateLimited, "The release hits Graph's rate limit (code 4): nothing published, a retry may pass", "transient"),
    release(INSTAGRAM_CASE.releaseTimeout, "The release never answers: the outcome is unknown and nothing was published", "timeout"),
    release(INSTAGRAM_CASE.releaseAppliedNoAnswer, "The release never answers, but the container WAS published: the next status read says published", "timeout"),
]

/** The hardcoded catalogue of the Instagram publishing sandbox (ruling R60): ids `INSTAGRAM-<n>`, identical on every machine. */
export const INSTAGRAM_SANDBOX_CATALOGUE: SandboxCatalogue = { provider: PROVIDER.meta, cases: INSTAGRAM_SANDBOX_CASES }
