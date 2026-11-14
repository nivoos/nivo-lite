import { isIP } from "node:net"
import { Injectable } from "@nestjs/common"
import { ImapFlow, type FetchMessageObject } from "imapflow"
import { simpleParser } from "mailparser"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { eachInOrder } from "@modules/platform/primitives"
import { InjectDataSourcesOptions, InjectPublicHost } from "./data-sources.decorators"
import type { DataSourcesOptions } from "./data-sources.options"
import { DataSourcesError, DataSourcesErrorCode } from "./errors/data-sources.error"
import { describeImapError } from "./imap-error.policy"
import type { ImapLogin, ImapMessageRow, ImapPage, ImapPageRequest } from "./imap-mailbox.contracts"
import { messageToRow, unreadableRow } from "./imap-message.policy"
import { ImapLogEvent } from "./imap.log-events"
import type { PublicHostClient } from "./public-host.client"

const BATCH_SIZE = 20
const DAY_MS = 86_400_000
const MAX_SOURCE = 2_000_000
const CONNECT_TIMEOUT_MS = 10_000
const SOCKET_TIMEOUT_MS = 60_000

const toError = (error: unknown): DataSourcesError => {
    if (error instanceof DataSourcesError) return error
    const failure = describeImapError(error)
    return new DataSourcesError({
        code: failure.rejected ? DataSourcesErrorCode.Rejected : DataSourcesErrorCode.Unavailable,
        params: { detail: failure.detail },
        cause: error,
    })
}

const folderRank = (path: string): number => (path === "INBOX" ? 0 : 1)

const compareFolders = (a: string, b: string): number => folderRank(a) - folderRank(b) || a.localeCompare(b)

const batchesOf = (uids: ReadonlyArray<number>): Array<Array<number>> => {
    const batches: Array<Array<number>> = []
    for (let start = 0; start < uids.length; start += BATCH_SIZE) batches.push(uids.slice(start, start + BATCH_SIZE))
    return batches
}

/** One message of a folder inside the window: where it is and when it was received. */
interface Found {
    readonly path: string
    readonly validity: string
    readonly uid: number
    readonly at: Date
}

/** A message's INTERNALDATE as an instant, or null when it carries none. */
const receivedAt = (value: Date | string | undefined): Date | null => {
    if (value === undefined) return null
    const at = new Date(value)
    return Number.isNaN(at.getTime()) ? null : at
}

@Injectable()
/** The client that reads a mailbox over IMAP, read only. */
export class ImapClient {
    constructor(
        @InjectLogger() private readonly logger: Logger,
        @InjectDataSourcesOptions() private readonly options: DataSourcesOptions,
        @InjectPublicHost() private readonly hosts: PublicHostClient,
    ) {}

    /** Logs in and lists the selectable folder paths, INBOX first. */
    async listFolders(login: ImapLogin): Promise<Array<string>> {
        const client = await this.open(login)
        let paths: Array<string>
        try {
            const list = await client.list()
            paths = list
                .filter((box) => !box.flags.has(String.raw`\Noselect`) && !box.flags.has(String.raw`\NonExistent`))
                .map((box) => box.path)
                .sort(compareFolders)
        } catch (error) {
            await this.close(client)
            throw toError(error)
        }
        await this.close(client)
        return paths
    }

    /**
     * Reads ONE PAGE of the mailbox's window (the connection poll's walk, providers rule 12): the messages of the folders received inside
     * `[from, to]`, the newest `limit` of them, newest first, each with its row. IMAP searches by day (`SINCE` / `BEFORE`), so the window
     * is narrowed on each message's INTERNALDATE read first (no body); only the page's messages are then fetched whole. A folder that
     * cannot be opened fails the read (the poll classifies it): a page never silently skips a folder.
     */
    async page(login: ImapLogin, request: ImapPageRequest): Promise<ImapPage> {
        const client = await this.open(login)
        try {
            const found: Array<Found> = []
            await eachInOrder(request.folders, async (path) => {
                found.push(...(await this.inWindow(client, path, request)))
            })
            const ordered = found.toSorted((a, b) => b.at.getTime() - a.at.getTime() || b.uid - a.uid)
            const chosen = ordered.slice(0, request.limit)
            const rows: Array<ImapMessageRow> = []
            await eachInOrder(request.folders, async (path) => {
                const mine = chosen.filter((one) => one.path === path)
                if (mine.length > 0) rows.push(...(await this.rowsOf(client, path, mine)))
            })
            const byTime = rows.toSorted((a, b) => (b.occurredAt?.getTime() ?? 0) - (a.occurredAt?.getTime() ?? 0))
            return { rows: byTime, fetched: found.length, oldestAt: chosen.at(-1)?.at, newestAt: chosen[0]?.at }
        } catch (error) {
            throw toError(error)
        } finally {
            await this.close(client)
        }
    }

    private async open(login: ImapLogin): Promise<ImapFlow> {
        const { address } = await this.hosts.resolve(login.host)
        const host = login.host.trim().replaceAll(/^\[|\]$/gu, "")
        const named = isIP(host) === 0 ? { servername: host } : {}
        const client = new ImapFlow({
            host: address,
            port: login.port,
            secure: login.secure,
            ...(login.secure ? {} : { doSTARTTLS: true }),
            ...named,
            tls: { ...named, ...(this.options.allowPrivateHosts ? { rejectUnauthorized: false } : {}) },
            auth: { user: login.user, pass: login.password },
            logger: false,
            disableAutoIdle: true,
            disableCompression: true,
            connectionTimeout: CONNECT_TIMEOUT_MS,
            greetingTimeout: CONNECT_TIMEOUT_MS,
            socketTimeout: SOCKET_TIMEOUT_MS,
        })
        client.on("error", () => undefined)
        try {
            await client.connect()
        } catch (error) {
            client.close()
            throw toError(error)
        }
        return client
    }

    private async close(client: ImapFlow): Promise<void> {
        try {
            await client.logout()
        } catch (error) {
            this.logger.warn(ImapLogEvent.LogoutFailed, { reason: describeImapError(error).detail })
            client.close()
        }
    }

    /** The messages of one folder received inside the window, by their INTERNALDATE (no body read). */
    private async inWindow(client: ImapFlow, path: string, request: ImapPageRequest): Promise<ReadonlyArray<Found>> {
        const lock = await client.getMailboxLock(path, { readOnly: true })
        try {
            const box = client.mailbox
            if (box === false) return []
            const validity = String(box.uidValidity)
            const before = request.to === undefined ? undefined : new Date(request.to.getTime() + DAY_MS)
            const uids = await client.search({ since: request.from, ...(before === undefined ? {} : { before }) }, { uid: true })
            const listed = uids === false || uids === undefined ? [] : uids
            const found: Array<Found> = []
            await eachInOrder(batchesOf(listed), async (batch) => {
                for await (const message of client.fetch(batch.join(","), { uid: true, internalDate: true }, { uid: true })) {
                    const at = receivedAt(message.internalDate)
                    if (at === null || at < request.from || (request.to !== undefined && at > request.to)) continue
                    found.push({ path, validity, uid: message.uid, at })
                }
            })
            return found
        } finally {
            lock.release()
        }
    }

    /** The rows of the chosen messages of one folder, fetched whole. */
    private async rowsOf(client: ImapFlow, path: string, chosen: ReadonlyArray<Found>): Promise<ReadonlyArray<ImapMessageRow>> {
        const lock = await client.getMailboxLock(path, { readOnly: true })
        try {
            const validity = chosen[0]?.validity ?? ""
            const rows: Array<ImapMessageRow> = []
            await eachInOrder(batchesOf(chosen.map((one) => one.uid)), async (batch) => {
                const messages = await this.fetchBatch(client, batch)
                rows.push(...(await Promise.all(messages.map((message) => this.toRow(path, validity, message)))))
            })
            return rows
        } finally {
            lock.release()
        }
    }

    private async fetchBatch(client: ImapFlow, uids: ReadonlyArray<number>): Promise<Array<FetchMessageObject>> {
        const messages: Array<FetchMessageObject> = []
        for await (const message of client.fetch(
            uids.join(","),
            { uid: true, internalDate: true, source: { maxLength: MAX_SOURCE } },
            { uid: true },
        )) {
            if (message.source !== undefined) messages.push(message)
        }
        return messages
    }

    private async toRow(folder: string, validity: string, message: FetchMessageObject): Promise<ImapMessageRow> {
        try {
            const mail = await simpleParser(message.source ?? Buffer.alloc(0))
            return messageToRow(folder, validity, message.uid, mail, message.internalDate)
        } catch (error) {
            this.logger.warn(ImapLogEvent.MessageUnreadable, { reason: describeImapError(error).detail })
            return unreadableRow(folder, validity, message.uid, message.internalDate)
        }
    }
}
