import type { SandboxCoverage } from "@modules/domain/provider-sandbox/sandbox-situations"
import { FACEBOOK_CASE, FACEBOOK_PUBLISH_OPERATION } from "./meta-facebook-sandbox.catalogue"
import { INSTAGRAM_CASE, INSTAGRAM_PUBLISH_OPERATION, INSTAGRAM_RELEASE_OPERATION, INSTAGRAM_STATUS_OPERATION } from "./meta-instagram-sandbox.catalogue"

/** The reason no Meta publishing operation shows an idempotency replay: the live client sends no key (`meta-publishing.client.ts`). */
const NO_KEY =
    "Meta's publishing edges take no idempotency key in the live client (meta-publishing.client.ts), so the same call made again acts again; the engine's ledger, not the provider, proves a repeat."

/** The reason the publishing tools meet no final refusal: their specs declare none (`tool-specs.policy.ts`: no `finalRefusals`). */
const NO_FINAL =
    "The publish tool declares no finalRefusals in tool-specs.policy.ts, so every refusal of this operation is a failed act a person can resolve and none is a business answer."

/**
 * Meta's publishing destinations as the standard asks them (lane concept provider-sandbox rule 18): Facebook Page posts (`facebook.publish`)
 * and Instagram content publishing (`instagram.publish` creates a container, `instagram.status` reads it, `instagram.release` publishes it).
 * The account's `connection` and the inbound / send roles are in `meta-connections/meta-sandbox.coverage.ts` (one key, `meta`).
 */
export const META_PUBLISHING_SANDBOX_COVERAGE: SandboxCoverage = {
    provider: "meta",
    roles: [
        {
            role: "act",
            operation: FACEBOOK_PUBLISH_OPERATION,
            covers: {
                "act.final": { na: NO_FINAL },
                "act.unknown_applied": { cases: [FACEBOOK_CASE.appliedNoAnswer] },
                "act.confirm_read": {
                    na: "The Facebook port has no read of a Page post and facebook.post.publish declares no confirmBy, so nothing can confirm an unknown outcome through NIVO.",
                },
                "act.replay": { na: NO_KEY },
                "act.partial": { na: "One post is one call to one Graph edge (feed, photos or videos): it is made or it is not, there is no batch that could be partly done." },
            },
        },
        {
            role: "act",
            operation: INSTAGRAM_PUBLISH_OPERATION,
            covers: {
                "act.final": { na: NO_FINAL },
                "act.unknown_applied": { cases: [INSTAGRAM_CASE.appliedNoAnswer] },
                "act.confirm_read": {
                    na: "instagram.media.publish declares no confirmBy, and a lost answer is the only place the new container's id was told, so the engine cannot name which container a status read should confirm.",
                },
                "act.replay": { na: NO_KEY },
                "act.partial": { cases: [INSTAGRAM_CASE.carouselPartial] },
            },
        },
        {
            // The container is Instagram's long job: created by the publish, read by the status poll, published by the release.
            role: "job",
            operation: INSTAGRAM_PUBLISH_OPERATION,
            covers: {
                "job.done": { cases: [INSTAGRAM_CASE.processing] },
                "job.failed": { cases: [INSTAGRAM_CASE.encodingError, INSTAGRAM_CASE.expired] },
                "job.never_finishes": { cases: [INSTAGRAM_CASE.neverFinishes] },
                "job.callback_done": {
                    na: "The live Instagram adapter has no callback: the container's status is read by polling (instagram.status; Instagram's own guidance is about once a minute), so no callback can report it done.",
                },
                "job.callback_failed": {
                    na: "The live Instagram adapter has no callback: a failed container is only seen when instagram.status reads ERROR or EXPIRED, so no callback can report it failed.",
                },
                "job.callback_lost": {
                    na: "There is no callback to lose: the container's end is found only by the status poll, which is the only way the live adapter learns it.",
                },
                "job.unknown_job": { cases: [INSTAGRAM_CASE.releaseNotFound, INSTAGRAM_CASE.statusNotFound] },
            },
        },
        {
            role: "read",
            operation: INSTAGRAM_STATUS_OPERATION,
            covers: {
                "read.not_found": { cases: [INSTAGRAM_CASE.statusNotFound] },
                "read.page": { na: "One container is read by its id and answers one status code: there is no list, no page and no limit in the live status read." },
            },
        },
        {
            role: "act",
            operation: INSTAGRAM_RELEASE_OPERATION,
            covers: {
                "act.final": { na: NO_FINAL },
                "act.unknown_applied": { cases: [INSTAGRAM_CASE.releaseAppliedNoAnswer] },
                // The status poll finds a container published whose release answer was lost (the picked case publishes it before failing).
                "act.confirm_read": { cases: [INSTAGRAM_CASE.releaseAppliedNoAnswer, INSTAGRAM_CASE.statusRead] },
                "act.replay": { na: NO_KEY },
                "act.partial": { na: "A release publishes one container with one media_publish call: it is published or it is not, there is no batch that could be partly done." },
            },
        },
    ],
}
