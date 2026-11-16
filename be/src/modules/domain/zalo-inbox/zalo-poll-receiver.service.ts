import { Injectable } from "@nestjs/common"
import type { PollFailure, PollLimits, PollPage, PollWindow } from "@modules/domain/connection-poll"
import type { ConnectionRecord } from "@modules/domain/connections"
import type { PollCadence, PolledRow, PollReceiver } from "@modules/domain/provider-registry"
import { ZaloInboxPollerService } from "@modules/domain/zalo-provider"
import { ZALO_PROVIDER, zaloEvent } from "./zalo.data-types"
import { ZALO_POLL_CADENCE, polledPageOf } from "./zalo-polled-row.policy"

@Injectable()
/**
 * THE POLL RECEIVER of the Zalo OA (live): reads the OA's chats back through the provider's reader and answers each customer text as the
 * `zalo_oa.event` row the webhook door keeps for it, under the same key. It reads the provider only: no write, no clock; the engine's one
 * poll job writes the rows through the intake and hands each new one to the type's admission.
 */
export class ZaloPollReceiverService implements PollReceiver {
    readonly provider = ZALO_PROVIDER
    readonly dataType: string = zaloEvent.name
    readonly limits: PollLimits
    readonly cadence: PollCadence = ZALO_POLL_CADENCE

    constructor(private readonly reader: ZaloInboxPollerService) {
        this.limits = reader.limits
    }

    /** Reads one page of one OA as event rows. */
    async read(account: ConnectionRecord, window: PollWindow): Promise<PollPage<PolledRow>> {
        return polledPageOf(await this.reader.fetch(account, window))
    }

    /** Classifies a failure of `read`, as the provider's reader reads it. */
    classify(error: unknown): PollFailure {
        return this.reader.classify(error)
    }
}
