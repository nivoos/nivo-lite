import { isRecord } from "@modules/platform/primitives"

/** The queue name: the contract between the migration tick and the processors of the refresh-zalo-tokens job (the durable queue name). */
export const ZALO_REFRESH_QUEUE = "zalo_refresh"

/** The jobs of the queue: the tick that finds what is due, and the renewal of one connection it fans out. */
export enum ZaloRefreshJob {
    /** The tick (the name the tick table gives it): finds the connections whose access token ends soon and writes one renewal job for each. */
    Tick = "zalo_refresh",
    /** The renewal of one connection's token pair. */
    Connection = "zalo_refresh.connection",
}

/** The payload of one tick: how far ahead of its end an access token is renewed. */
export interface ZaloRefreshPayload {
    /** Milliseconds: a token that ends within this time is renewed. */
    readonly withinMs: number
}

/** The payload of one connection's renewal: ids and the expiry that made it due. */
export interface ZaloRefreshConnectionPayload {
    /** The workspace of the connection: the queue limits how many jobs of one workspace run at once. */
    readonly workspaceId: string
    /** The Zalo connection whose pair is renewed. */
    readonly connectionId: string
    /** When the access token that made the connection due ends, epoch milliseconds: it names the token, so one expiry is renewed by one job. */
    readonly expiresAt: number
}

/** True when a job payload is the payload of a Zalo refresh tick. */
export const isZaloRefreshPayload = (value: unknown): value is ZaloRefreshPayload =>
    typeof value === "object" && value !== null && "withinMs" in value && typeof value.withinMs === "number"

/** True when a job payload is the payload of one connection's renewal. */
export const isZaloRefreshConnectionPayload = (value: unknown): value is ZaloRefreshConnectionPayload =>
    isRecord(value) &&
    typeof value.workspaceId === "string" &&
    typeof value.connectionId === "string" &&
    typeof value.expiresAt === "number"

/** The once key of a connection's renewal: the connection and the expiry that made it due (a renewed connection has a new expiry, so it is due again later under a new key). */
export const zaloRefreshConnectionKey = (payload: ZaloRefreshConnectionPayload): string =>
    `${ZaloRefreshJob.Connection}:${payload.connectionId}:${String(payload.expiresAt)}`
