import { Injectable } from "@nestjs/common"
import { PROVIDER } from "@nivo-lite/agent-sdk/names"
import type { ConnectionRecord } from "@modules/domain/connections"
import {
    providerRefusal,
    withProof,
    type InstagramContainer,
    type InstagramMediaRequest,
    type InstagramPublishPort,
    type InstagramPublishState,
    type ProviderRegistryError,
} from "@modules/domain/provider-registry"
import { ProviderSandboxService, type SandboxState } from "@modules/domain/provider-sandbox"
import {
    INSTAGRAM_CASE,
    INSTAGRAM_CONTAINER_WALKS,
    INSTAGRAM_PUBLISH_OPERATION,
    INSTAGRAM_RELEASE_OPERATION,
    INSTAGRAM_SANDBOX_CAROUSEL_MAX,
    INSTAGRAM_SANDBOX_REFUSALS,
    INSTAGRAM_STATUS_OPERATION,
    type InstagramSandboxCodes,
} from "./meta-instagram-sandbox.catalogue"
import { metaPublishingRateLimited, metaPublishingServerError, metaPublishingUnreachable } from "./meta-publishing-sandbox.failures"

/** State name: the containers the account created, by container id. */
const CONTAINER = "container"

/** A container as the account's state keeps it: the status words it walks, how many reads walked them, and whether it was published. */
interface KeptContainer {
    readonly codes: InstagramSandboxCodes
    readonly polls: number
    readonly published: boolean
}

/** Where a documented `status_code` leaves the container (the live adapter's own table). */
const STATE_OF_CODE: Readonly<Record<InstagramSandboxCodes[number], InstagramPublishState>> = {
    IN_PROGRESS: "pending",
    FINISHED: "ready",
    ERROR: "failed",
    EXPIRED: "failed",
}

const refused = (detail: string): ProviderRegistryError => withProof(providerRefusal(PROVIDER.meta, "rejected", detail), "not_sent")

/** The refusal a refusing case throws, or null when the picked case refuses nothing. */
const refusalOf = (nextCase: string | null): ProviderRegistryError | null => {
    const refusal = nextCase === null ? undefined : INSTAGRAM_SANDBOX_REFUSALS[nextCase]
    return refusal === undefined ? null : withProof(providerRefusal(PROVIDER.meta, refusal.reason, refusal.detail), "not_sent")
}

/** Reads the container kept under an id as the state holds it, or null when the account never created it. */
const keptOf = async (state: SandboxState, containerId: string): Promise<KeptContainer | null> => {
    const value = await state.read(CONTAINER, containerId)
    return value === null ? null : (value as KeptContainer)
}

@Injectable()
/**
 * Meta's SANDBOX implementation of the Instagram destination (`InstagramPublishPort`; owner rulings R56, R59, R60, R62): used when the Meta
 * account is a sandbox account. It answers through the generic sandbox frame from the hardcoded `INSTAGRAM-<n>` catalogue and never
 * reaches a host. The account's NEXT CASE of each operation (`instagram.publish`, `instagram.status`, `instagram.release`) picks the
 * answer (sticky; the operation's default while nothing is picked); the request's words pick nothing. Like the live twin, `publish`
 * creates the container, reads its status ONCE and publishes it when it is finished; the picked publish case decides the container's
 * fate: the container kept in state walks its status words one per read (processing, then finished, ERROR or EXPIRED, or processing for
 * ever) and stays on the last; `release` publishes a finished one. A published container reads `PUBLISHED` with no media id, as the live
 * read does. Refusals throw exactly the live ones (`providerRefusal` proving `not_sent`); a rate limit, an outage and a lost answer throw
 * the live failures (`meta-publishing-sandbox.failures.ts`). A request that does not fit its kind is refused `rejected` before anything is
 * created. Container ids run `sbx-ig-container-<n>` by the publishes the account took (`state.seq`). The sandbox adds no idempotency.
 */
export class MetaInstagramSandboxPublishService implements InstagramPublishPort {
    /** The provider key. */
    readonly provider: string = PROVIDER.meta

    constructor(private readonly sandbox: ProviderSandboxService) {}

    /** Creates the container of a sandbox account through exactly one sandbox call keyed by the caption, then reads it and publishes it when finished. */
    async publish(connection: ConnectionRecord, request: InstagramMediaRequest): Promise<InstagramContainer> {
        return await this.sandbox.call(connection, INSTAGRAM_PUBLISH_OPERATION, request, {
            key: request.caption ?? "",
            answer: async (state) => {
                if (request.mediaType === "carousel") {
                    if (request.children.length < 1 || request.children.length > INSTAGRAM_SANDBOX_CAROUSEL_MAX) throw refused("carousel items")
                } else if (request.mediaUrl === null) {
                    throw refused("media url")
                }
                const refusal = refusalOf(state.nextCase)
                if (refusal !== null) throw refusal
                if (state.nextCase === INSTAGRAM_CASE.rateLimited) throw metaPublishingRateLimited()
                if (state.nextCase === INSTAGRAM_CASE.serverError) throw metaPublishingServerError()
                if (state.nextCase === INSTAGRAM_CASE.timeout) throw metaPublishingUnreachable()
                const number = String(state.seq + 1).padStart(6, "0")
                const containerId = `sbx-ig-container-${number}`
                if (state.nextCase === INSTAGRAM_CASE.carouselPartial && request.mediaType === "carousel") {
                    // The live adapter creates one container per item, one at a time, and a refusal stops the rest (`createContainer`).
                    await state.write(CONTAINER, `${containerId}-1`, { codes: ["FINISHED"], polls: 0, published: false } satisfies KeptContainer)
                    throw refused("carousel item")
                }
                if (state.nextCase === INSTAGRAM_CASE.appliedNoAnswer) {
                    await state.write(CONTAINER, containerId, { codes: ["FINISHED"], polls: 0, published: false } satisfies KeptContainer)
                    throw metaPublishingUnreachable()
                }
                const codes = (state.nextCase === null ? undefined : INSTAGRAM_CONTAINER_WALKS[state.nextCase]) ?? INSTAGRAM_CONTAINER_WALKS[INSTAGRAM_CASE.accepted] ?? ["FINISHED"]
                return await this.stand(state, containerId, { codes, polls: 0, published: false }, true)
            },
        })
    }

    /** Reads a container the account created and publishes it when it is finished, through exactly one sandbox call. */
    async release(connection: ConnectionRecord, containerId: string): Promise<InstagramContainer> {
        return await this.read(connection, INSTAGRAM_RELEASE_OPERATION, containerId, true)
    }

    /** Reads one container (a pure read of the container; the sandbox poll clock moves one step), through exactly one sandbox call. */
    async status(connection: ConnectionRecord, containerId: string): Promise<InstagramContainer> {
        return await this.read(connection, INSTAGRAM_STATUS_OPERATION, containerId, false)
    }

    private async read(connection: ConnectionRecord, operation: string, containerId: string, publish: boolean): Promise<InstagramContainer> {
        return await this.sandbox.call(connection, operation, { containerId }, {
            key: containerId,
            answer: async (state) => {
                const refusal = refusalOf(state.nextCase)
                if (refusal !== null) throw refusal
                if (state.nextCase === INSTAGRAM_CASE.statusRateLimited || state.nextCase === INSTAGRAM_CASE.releaseRateLimited) throw metaPublishingRateLimited()
                if (state.nextCase === INSTAGRAM_CASE.statusTimeout || state.nextCase === INSTAGRAM_CASE.releaseTimeout) throw metaPublishingUnreachable()
                const kept = await keptOf(state, containerId)
                if (kept === null) throw withProof(providerRefusal(PROVIDER.meta, "not_found", "container not found"), "not_sent")
                const stood = await this.stand(state, containerId, kept, publish)
                if (state.nextCase === INSTAGRAM_CASE.releaseAppliedNoAnswer && stood.state === "published") throw metaPublishingUnreachable()
                return stood
            },
        })
    }

    /** Where the container stands after one more read; a finished one is published when asked; the new state is kept. */
    private async stand(state: SandboxState, containerId: string, kept: KeptContainer, publish: boolean): Promise<InstagramContainer> {
        if (kept.published) return { containerId, state: "published", statusCode: "PUBLISHED", mediaId: null }
        const code = kept.codes[Math.min(kept.polls, kept.codes.length - 1)] ?? "IN_PROGRESS"
        if (code === "FINISHED" && publish) {
            await state.write(CONTAINER, containerId, { ...kept, polls: kept.polls + 1, published: true })
            return { containerId, state: "published", statusCode: "PUBLISHED", mediaId: `sbx-ig-media-${containerId.slice(-6)}` }
        }
        await state.write(CONTAINER, containerId, { ...kept, polls: kept.polls + 1 })
        return { containerId, state: STATE_OF_CODE[code], statusCode: code, mediaId: null }
    }
}
