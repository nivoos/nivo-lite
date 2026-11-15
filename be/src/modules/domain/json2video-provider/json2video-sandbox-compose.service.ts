import { Injectable } from "@nestjs/common"
import type { ConnectionRecord } from "@modules/domain/connections"
import { ProviderSandboxService } from "@modules/domain/provider-sandbox"
import { providerRefusal, withProof } from "@modules/domain/provider-registry"
import type {
    ComposeSpec,
    OptionalRenderCallback,
    OptionalRenderCompletion,
    OptionalRenderWebhook,
    RenderStarted,
    RenderState,
    VideoComposePort,
} from "@modules/domain/video-compose"
import { movieOf } from "./json2video-movie.policy"
import { JSON2VIDEO_TIMEOUT_WORDS, completionOf } from "./json2video-status.policy"
import {
    JSON2VIDEO_SANDBOX_DEFAULT_START,
    JSON2VIDEO_SANDBOX_FAILED_MESSAGE,
    JSON2VIDEO_SANDBOX_NOT_FOUND_MESSAGE,
    JSON2VIDEO_SANDBOX_NO_CREDITS_MESSAGE,
    JSON2VIDEO_SANDBOX_OUTPUT_URL,
    JSON2VIDEO_SANDBOX_PROVIDER,
    JSON2VIDEO_SANDBOX_READS,
    JSON2VIDEO_SANDBOX_STARTS,
    json2videoSandboxRenderId,
} from "./json2video-sandbox.catalogue"
import { json2videoAuthRefused, json2videoRateLimited, json2videoServerError, json2videoUnreachable } from "./json2video-sandbox.failures"

/** The state operation that holds one started render, by its render id: its case and how many status reads it has taken. */
const RENDER_STATE = "render"

/** What the account's state keeps of a started render. */
interface KeptRender {
    readonly caseId: string
    readonly reads: number
}

/** A kept render read back, or null when the value is not one. */
const keptRenderOf = (value: unknown): KeptRender | null => {
    if (typeof value !== "object" || value === null) return null
    const caseId: unknown = Reflect.get(value, "caseId")
    const reads: unknown = Reflect.get(value, "reads")
    return typeof caseId === "string" && typeof reads === "number" ? { caseId, reads } : null
}

@Injectable()
/**
 * Json2Video's SANDBOX implementation of the compose purpose (owner rulings R56 / R59 / R60): used when the provider account is a sandbox
 * account, it answers from the hardcoded catalogue (`CREATOMATE-<n>`) and the account's state through the generic sandbox frame, and
 * never reaches a host. A start is answered by the account's NEXT CASE of `start` (default: a render that completes); that case chooses
 * the render's whole life (completes, fails, never finishes, times out) and the render is read back by `statusOf` as a live poll would see it (queued,
 * rendering, then the end, one step per read), or finished by the provider's webhook (the inbound cases). A `statusOf` case the account
 * picked fails the read itself. A failure is the error the live adapter throws for the same case; the spec is mapped by the live pure
 * mapper first, so a spec the movie JSON cannot carry is refused `rejected`, `not_sent`, as the live does.
 */
export class Json2VideoSandboxComposeService implements VideoComposePort {
    /** The provider key. */
    readonly provider: string = JSON2VIDEO_SANDBOX_PROVIDER

    /** The same webhook as the live port: no signature header. */
    readonly webhook: OptionalRenderWebhook = { signatureHeader: null, timestampHeader: null }

    constructor(private readonly sandbox: ProviderSandboxService) {}

    /** Starts one render as the account's next case says: refused, rate limited, no answer, accepted (the next running id) or accepted with an unknown outcome. */
    start(connection: ConnectionRecord, spec: ComposeSpec, callback: OptionalRenderCallback): Promise<RenderStarted> {
        return this.sandbox.call(
            connection,
            "start",
            { spec, callback },
            {
                answer: async (state) => {
                    const built = movieOf(spec, callback)
                    if (!built.ok) throw withProof(providerRefusal(this.provider, "rejected", built.reason), "not_sent")
                    const chosen = JSON2VIDEO_SANDBOX_STARTS.find((one) => one.caseId === state.nextCase) ?? JSON2VIDEO_SANDBOX_DEFAULT_START
                    switch (chosen.outcome) {
                        case "refused":
                            throw withProof(providerRefusal(this.provider, "rejected", JSON2VIDEO_SANDBOX_NO_CREDITS_MESSAGE), "not_sent")
                        case "auth_refused":
                            throw json2videoAuthRefused()
                        case "rate_limited":
                            throw json2videoRateLimited()
                        case "timeout":
                            throw json2videoUnreachable()
                        case "accepted":
                        case "unknown":
                            break
                    }
                    const renderId = json2videoSandboxRenderId(state.seq)
                    await state.write(RENDER_STATE, renderId, { caseId: chosen.caseId, reads: 0 })
                    if (chosen.outcome === "unknown") throw json2videoServerError()
                    return { renderId }
                },
            },
        )
    }

    /** The render as one more status read sees it (or the failure the account's `statusOf` case names); a render the account never started is the refusal `not_found`. */
    statusOf(connection: ConnectionRecord, renderId: string): Promise<RenderState> {
        return this.sandbox.call(
            connection,
            "statusOf",
            { renderId },
            {
                key: renderId,
                answer: async (state) => {
                    switch (state.nextCase) {
                        case JSON2VIDEO_SANDBOX_READS.authRefused:
                            throw json2videoAuthRefused()
                        case JSON2VIDEO_SANDBOX_READS.rateLimited:
                            throw json2videoRateLimited()
                        case JSON2VIDEO_SANDBOX_READS.timeout:
                            throw json2videoUnreachable()
                        case JSON2VIDEO_SANDBOX_READS.notFound:
                            throw withProof(providerRefusal(this.provider, "not_found", JSON2VIDEO_SANDBOX_NOT_FOUND_MESSAGE), "not_sent")
                    }
                    const kept = keptRenderOf(await state.read(RENDER_STATE, renderId))
                    const chosen = kept === null ? undefined : JSON2VIDEO_SANDBOX_STARTS.find((one) => one.caseId === kept.caseId)
                    if (kept === null || chosen === undefined) {
                        throw withProof(providerRefusal(this.provider, "not_found", JSON2VIDEO_SANDBOX_NOT_FOUND_MESSAGE), "not_sent")
                    }
                    await state.write(RENDER_STATE, renderId, { caseId: kept.caseId, reads: kept.reads + 1 })
                    const status = chosen.polls[Math.min(kept.reads, chosen.polls.length - 1)] ?? "queued"
                    if (status === "done") return { renderId, status, outputUrl: JSON2VIDEO_SANDBOX_OUTPUT_URL }
                    if (status === "failed") return { renderId, status, error: chosen.timedOut === true ? JSON2VIDEO_TIMEOUT_WORDS : JSON2VIDEO_SANDBOX_FAILED_MESSAGE }
                    return { renderId, status }
                },
            },
        )
    }

    /** The completion a webhook body reports: the live pure mapping. */
    completionOf(body: unknown): OptionalRenderCompletion {
        return completionOf(body)
    }

    /** Json2Video signs nothing, as the live port. */
    proves(): boolean {
        return true
    }
}
