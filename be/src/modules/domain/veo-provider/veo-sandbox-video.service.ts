import { Injectable } from "@nestjs/common"
import type { ConnectionRecord } from "@modules/domain/connections"
import {
    providerRefusal,
    withProof,
    type ProviderFile,
    type ProviderFileReader,
    type VideoGenerationPort,
    type VideoJob,
    type VideoRequest,
    type VideoStarted,
} from "@modules/domain/provider-registry"
import { ProviderSandboxService, type SandboxState } from "@modules/domain/provider-sandbox"
import { VEO_MODEL } from "./veo-credential.service"
import {
    VEO_SANDBOX_CASES,
    VEO_SANDBOX_DEFAULT_START,
    VEO_SANDBOX_FAILED_ERROR,
    VEO_SANDBOX_FILES,
    VEO_SANDBOX_FILE_NOT_FOUND_MESSAGE,
    VEO_SANDBOX_JOB_NOT_FOUND_MESSAGE,
    VEO_SANDBOX_NO_MODEL_CASE,
    VEO_SANDBOX_NO_MODEL_DETAIL,
    VEO_SANDBOX_PENDING_READS,
    VEO_SANDBOX_PROVIDER,
    VEO_SANDBOX_READS,
    VEO_SANDBOX_REJECTED_MESSAGE,
    VEO_SANDBOX_VIDEO_MIME,
    veoSandboxJobName,
    veoSandboxVideoBytesOf,
    veoSandboxVideoUri,
} from "./veo-sandbox.catalogue"
import { veoAuthRefused, veoRateLimited, veoServerError, veoUnreachable } from "./veo-sandbox.failures"

/** The state operation that holds one started generation, by its operation name: its case and how many reads it has taken. */
const JOB_STATE = "job"

/** The state operation that holds the video URIs a read answered (by URI): only those reopen. */
const FILE_STATE = "file"

/** What the account's state keeps of a started generation. */
interface KeptJob {
    readonly caseId: string
    readonly reads: number
}

/** A kept generation read back, or null when the value is not one. */
const keptJobOf = (value: unknown): KeptJob | null => {
    if (typeof value !== "object" || value === null) return null
    const caseId: unknown = Reflect.get(value, "caseId")
    const reads: unknown = Reflect.get(value, "reads")
    return typeof caseId === "string" && typeof reads === "number" ? { caseId, reads } : null
}

/** An answered refusal as the live twin throws it: Google's words, proved `not_sent`. */
const refusal = (reason: "rejected" | "not_found", detail: string): Error => withProof(providerRefusal(VEO_SANDBOX_PROVIDER, reason, detail), "not_sent")

/**
 * The failure the account's picked case of a READ (`get` / `file`) names, or null when the read goes on: the key refused, a 429, no
 * answer, or the thing not found. `ids` says which case id of the operation is which failure.
 */
const readFailureOf = (state: SandboxState, ids: typeof VEO_SANDBOX_READS | typeof VEO_SANDBOX_FILES, notFound: string): Error | null => {
    switch (state.nextCase) {
        case ids.authRefused:
            return veoAuthRefused()
        case ids.rateLimited:
            return veoRateLimited()
        case ids.timeout:
            return veoUnreachable()
        case ids.notFound:
            return refusal("not_found", notFound)
        default:
            return null
    }
}

@Injectable()
/**
 * Veo's SANDBOX implementation of its two ports, video generation and the files it holds (owner rulings R56 / R59 / R60): used when the
 * provider account is a sandbox account, it answers from the hardcoded catalogue (`VEO-<n>`) and the account's state through the generic
 * sandbox frame, and never reaches a host. A start is answered by the account's NEXT CASE of `start` (default: a video that completes),
 * which chooses the generation's whole life; the model is the request's, else the account's (`meta.model`), else nothing is sent
 * (`rejected`), as the live twin. The generation is read back as a live poll sees it (pending for the first reads, then its end, or
 * pending for ever), and the video it answers reopens by its URI with fixed bytes. A case the account picked for `get` or `file` fails
 * that read. A failure is the error the live adapter throws for the same case.
 */
export class VeoSandboxVideoService implements VideoGenerationPort, ProviderFileReader {
    /** The provider key. */
    readonly provider: string = VEO_SANDBOX_PROVIDER

    constructor(private readonly sandbox: ProviderSandboxService) {}

    /** Starts one generation as the account's next case says: refused, rate limited, no answer, accepted (its operation name is the next running one) or accepted with an unknown outcome. */
    start(connection: ConnectionRecord, request: VideoRequest): Promise<VideoStarted> {
        return this.sandbox.call(
            connection,
            "start",
            { request },
            {
                answer: async (state): Promise<VideoStarted> => {
                    const model = request.modelId ?? connection.meta[VEO_MODEL] ?? ""
                    if (model === "" || state.nextCase === VEO_SANDBOX_NO_MODEL_CASE) throw refusal("rejected", VEO_SANDBOX_NO_MODEL_DETAIL)
                    const chosen = VEO_SANDBOX_CASES.find((one) => one.caseId === state.nextCase) ?? VEO_SANDBOX_DEFAULT_START
                    switch (chosen.outcome) {
                        case "refused":
                            throw refusal("rejected", VEO_SANDBOX_REJECTED_MESSAGE)
                        case "auth_refused":
                            throw veoAuthRefused()
                        case "rate_limited":
                            throw veoRateLimited()
                        case "timeout":
                            throw veoUnreachable()
                        case "accepted":
                        case "unknown":
                            break
                    }
                    const jobId = veoSandboxJobName(model, state.seq)
                    await state.write(JOB_STATE, jobId, { caseId: chosen.caseId, reads: 0 })
                    if (chosen.outcome === "unknown") throw veoServerError()
                    return { jobId, modelId: model }
                },
            },
        )
    }

    /** The generation as one more read sees it: pending for the first reads, then its end (or pending for ever); an operation the account never started is `not_found`. */
    get(connection: ConnectionRecord, jobId: string): Promise<VideoJob> {
        return this.sandbox.call(
            connection,
            "get",
            { jobId },
            {
                key: jobId,
                answer: async (state): Promise<VideoJob> => {
                    const failed = readFailureOf(state, VEO_SANDBOX_READS, VEO_SANDBOX_JOB_NOT_FOUND_MESSAGE)
                    if (failed !== null) throw failed
                    const kept = keptJobOf(await state.read(JOB_STATE, jobId))
                    const chosen = kept === null ? undefined : VEO_SANDBOX_CASES.find((one) => one.caseId === kept.caseId)
                    if (kept === null || chosen === undefined) throw refusal("not_found", VEO_SANDBOX_JOB_NOT_FOUND_MESSAGE)
                    await state.write(JOB_STATE, jobId, { ...kept, reads: kept.reads + 1 })
                    if (chosen.end === "never" || kept.reads < VEO_SANDBOX_PENDING_READS) return { jobId, state: "pending", error: null, files: [] }
                    if (chosen.end === "error") return { jobId, state: "failed", error: VEO_SANDBOX_FAILED_ERROR, files: [] }
                    if (chosen.end === "blocked") return { jobId, state: "done", error: null, files: [] }
                    const uri = veoSandboxVideoUri(jobId)
                    await state.write(FILE_STATE, uri, true)
                    return { jobId, state: "done", error: null, files: [this.open(connection, uri)] }
                },
            },
        )
    }

    /** The video behind a URI a read of the account answered: fixed bytes on `fetch` (one sandbox call); any other URI is `not_found`. */
    open(connection: ConnectionRecord, handle: string): ProviderFile {
        const fetch = (): Promise<Buffer> =>
            this.sandbox.call(
                connection,
                "file",
                { handle },
                {
                    key: handle,
                    answer: async (state): Promise<Buffer> => {
                        const failed = readFailureOf(state, VEO_SANDBOX_FILES, VEO_SANDBOX_FILE_NOT_FOUND_MESSAGE)
                        if (failed !== null) throw failed
                        if ((await state.read(FILE_STATE, handle)) !== true) throw refusal("not_found", VEO_SANDBOX_FILE_NOT_FOUND_MESSAGE)
                        return veoSandboxVideoBytesOf(handle)
                    },
                },
            )
        return { provider: this.provider, handle, mimeType: VEO_SANDBOX_VIDEO_MIME, expiresAt: null, fetch }
    }
}
