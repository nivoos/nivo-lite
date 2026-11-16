import { Injectable, Optional } from "@nestjs/common"
import type { StorageAssetsPort, StorageObjectsPort } from "@modules/integrations/object-storage"
import { InjectRemoteFiles, type RemoteFileAnswer, type RemoteFiles } from "@modules/integrations/remote-files"
import { RemoteFilesError, RemoteFilesErrorCode } from "@modules/integrations/remote-files/errors/remote-files.error"
import { InjectEffects, type Effects } from "@modules/platform/effects"
import { InjectErrorReporter, isDomainError, type ErrorReporter } from "@modules/platform/errors"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { classifyFailure } from "@modules/platform/queue"
import { KEEP_FILE_EFFECT } from "@modules/queues/inbound-delivery"
import { CHAT_FILE_BUCKET, CHAT_FILE_MAX_BYTES, chatFileNameOf, sniffChatFile } from "./chat-file.policy"
import type { CustomerAttachment, OptionalCustomerFileBytes } from "./chat-files.contracts"
import { InjectChatFilesAssets, InjectChatFilesStorage } from "./chat-files.decorators"
import { ChatFilesLogEvent } from "./chat-files.log-events"
import {
    CUSTOMER_FILE_REF,
    CUSTOMER_FILES_MAX,
    customerFilePathOf,
    customerObjectPathOf,
    fileOfKept,
    isCustomerFilePath,
    keptFileOf,
    partFileOf,
    unreadFileOf,
    type CustomerFile,
    type FileNotKept,
} from "./customer-files.policy"

/** The scope an attachment an intake could not keep is reported under (the app errors, /admin/health). */
const NOT_KEPT_SCOPE = "chat_files.customer_file_not_kept"

/** How long one file may take to come from the channel, milliseconds. */
const FETCH_TIMEOUT_MS = 15_000

/** The job a delivery keeps its files under: the effect keys of its files are `<jobId>:file:<index>`. */
export interface FileKeepJob {
    /** The id of the delivery job row (stable across its retries and resumes). */
    readonly jobId: string
}

/** What reading a channel's address came to: the answer, or the failure of a read no later try fixes. */
type ChannelRead = { readonly kind: "answer"; readonly answer: RemoteFileAnswer } | { readonly kind: "refused"; readonly cause: unknown }

/** The media type of a `content-type` value, without its parameters. */
const mediaTypeOf = (declared: string): string => declared.split(";", 1).join("").trim().toLowerCase()

/** A declared type worth reading: a picture or a PDF (the bytes decide what is kept). */
const isWanted = (declared: string): boolean => {
    const type = mediaTypeOf(declared)
    return type.startsWith("image/") || type === "application/pdf" || type === "application/octet-stream" || type === ""
}

@Injectable()
/**
 * The pictures and files a customer sends on a channel (D-MX-4): read ONCE from the channel's address, through the lane's guarded
 * fetch (size and time limits, a type check on the header and on the bytes), and kept in the shop's private store under a path the
 * message decides, so the line keeps an address that never expires (`chat-file:<path>`) and the same message heard again writes the
 * same object. A file that cannot be kept is a TYPED, REPORTED outcome (DEF-7): it stays on the event's stored line without an address,
 * its id naming why (`unread:<reason>:<index>`, `FileNotKept`), one app error is recorded per file (the event, the index, the reason, the
 * cause), and a model call is told it was not seen (`picturesNotSeen`): never an address that is not there, never a silent warning.
 */
export class CustomerFilesService {
    constructor(
        @InjectLogger() private readonly logger: Logger,
        @InjectRemoteFiles() private readonly remote: RemoteFiles,
        @InjectChatFilesStorage() private readonly storage: StorageObjectsPort,
        @InjectEffects() private readonly effects: Effects,
        @Optional() @InjectChatFilesAssets() private readonly assets?: StorageAssetsPort,
        @Optional() @InjectErrorReporter() private readonly errors?: ErrorReporter,
    ) {}

    /**
     * The files of one customer message as its line keeps them, in the order sent; at most `CUSTOMER_FILES_MAX`. Each file is one outside
     * effect keyed by the delivery job and the file's place (`<jobId>:file:<index>`): a retried or resumed delivery gets the entry kept the
     * first time without reading the channel again. A read that failed on the way or on a busy channel is a typed not-kept entry (the line is
     * stored and the pipeline goes on, R72 DEF-7: the customer's file host failing never fails the delivery job); only the shop's OWN
     * store being down THROWS (the job runner retries it on its ladder, then dead-letters it with one item).
     */
    keep(
        job: FileKeepJob,
        workspaceId: string,
        channelEventId: string,
        attachments: ReadonlyArray<CustomerAttachment>,
    ): Promise<ReadonlyArray<CustomerFile>> {
        return Promise.all(
            attachments
                .slice(0, CUSTOMER_FILES_MAX)
                .map((attachment, index) => this.keptOne(job, workspaceId, channelEventId, index, attachment)),
        )
    }

    /** The bytes of a kept customer file of this workspace, or null when the address is not the shop's or the store lost it. */
    async bytesOf(workspaceId: string, url: string): Promise<OptionalCustomerFileBytes> {
        const path = customerFilePathOf(url)
        if (path === null || !isCustomerFilePath(workspaceId, path)) return null
        const stored = await this.storage.download(CHAT_FILE_BUCKET, path)
        if (stored.kind !== "ok") return null
        const contentType = sniffChatFile(stored.value.bytes)
        return contentType === null ? null : { contentType, bytes: stored.value.bytes }
    }

    private keptOne(
        job: FileKeepJob,
        workspaceId: string,
        channelEventId: string,
        index: number,
        attachment: CustomerAttachment,
    ): Promise<CustomerFile> {
        // A part that carries no file (a link, a contact, a location) is kept as its typed part: nothing to fetch, nothing failed.
        if (attachment.contentType !== undefined) return Promise.resolve(partFileOf(index, attachment.contentType, attachment.name))
        const at: NotKeptAt = { workspaceId, channelEventId, index, kind: attachment.kind, name: attachment.name }
        if (attachment.url === "") return this.notKept(at, "no_address", null)
        const { assets } = this
        if (assets === undefined) return this.notKept(at, "no_store", null)
        return this.effects.once(`${job.jobId}:file:${String(index)}`, KEEP_FILE_EFFECT, {
            act: () => this.readAndStore(assets, at, attachment),
            keep: keptFileOf,
            from: (kept) => fileOfKept(kept, index, attachment.kind, attachment.name),
        })
    }

    /** Reads the channel's address once and writes the checked copy; any failure of the read or a refusal is a typed not-kept entry, only a transient failure of the shop's own store throws. */
    private async readAndStore(assets: StorageAssetsPort, at: NotKeptAt, attachment: CustomerAttachment): Promise<CustomerFile> {
        const read = await this.read(attachment)
        if (read.kind === "refused") return this.notKept(at, "fetch_failed", read.cause)
        const { answer } = read
        const bytes = answer.bytes
        const contentType = bytes === null ? null : sniffChatFile(bytes)
        if (bytes === null || contentType === null) {
            // A channel that answers busy or failing is no reason to lose the customer's message: the file is a typed not-kept entry too.
            return this.notKept(at, `refused_${answer.status}`, null)
        }
        const path = customerObjectPathOf(at.workspaceId, at.channelEventId, at.index, contentType)
        const written = await assets.upload(CHAT_FILE_BUCKET, path, bytes, contentType)
        if (written.error !== null) {
            if (classifyFailure(written.error) === "transient") {
                throw new RemoteFilesError({ code: RemoteFilesErrorCode.Unavailable, cause: written.error })
            }
            return this.notKept(at, "store_failed", written.error)
        }
        return { id: path, url: `${CUSTOMER_FILE_REF}${path}`, name: chatFileNameOf(at.name, path), contentType }
    }

    /** What the channel's address answered, or the failure of the read (network, timeout, an unreadable answer): the customer's file host failing never fails the delivery, it is recorded as not kept. */
    private async read(attachment: CustomerAttachment): Promise<ChannelRead> {
        try {
            const answer = await this.remote.read({
                url: attachment.url,
                maxBytes: CHAT_FILE_MAX_BYTES,
                timeoutMs: FETCH_TIMEOUT_MS,
                accepts: isWanted,
            })
            return { kind: "answer", answer }
        } catch (cause) {
            return { kind: "refused", cause }
        }
    }

    /**
     * The line's entry of a file that was not kept, with why in its id, after ONE app error is recorded for it (the event, the index,
     * the reason; the cause when there is one, else the remote files' typed failure). A report never throws.
     */
    private async notKept(at: NotKeptAt, reason: FileNotKept, cause: unknown): Promise<CustomerFile> {
        this.logger.warn(ChatFilesLogEvent.CustomerFileNotKept, { reason, channelEventId: at.channelEventId, index: at.index })
        const error = isDomainError(cause)
            ? cause
            : new RemoteFilesError({ code: RemoteFilesErrorCode.RequestFailed, params: { reason }, cause })
        await this.errors?.report(NOT_KEPT_SCOPE, error, {
            workspaceId: at.workspaceId,
            event: at.channelEventId,
            index: at.index,
            reason,
        })
        return unreadFileOf(at.index, at.kind, at.name, reason)
    }
}

/** Where a file that was not kept belongs: the workspace, the event it came with, its place and kind there. */
interface NotKeptAt {
    readonly workspaceId: string
    readonly channelEventId: string
    readonly index: number
    readonly kind: "image" | "file"
    readonly name: string
}
