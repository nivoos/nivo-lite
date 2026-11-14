import { Injectable } from "@nestjs/common"
import type { PollFailure, PollLimits, PollPage, PollWindow } from "@modules/domain/connection-poll"
import type { ConnectionRecord } from "@modules/domain/connections"
import type { PollCadence, PolledRow, PollReceiver } from "@modules/domain/provider-registry"
import { ZaloSandboxInboxPollerService } from "@modules/domain/zalo-provider"
import { ZALO_PROVIDER, zaloEvent } from "./zalo.data-types"
import { ZALO_POLL_CADENCE, polledPageOf } from "./zalo-polled-row.policy"

@Injectable()
/**
 * The sandbox twin of the Zalo poll receiver: answers the messages the account's inbound cases made (ZALO-1..3, kept in the sandbox's
 * state) as the same `zalo_oa.event` rows the live receiver makes, so a webhook the sandbox dropped comes back by poll. It never calls Zalo.
 */
export class ZaloSandboxPollReceiverService implements PollReceiver {
    readonly provider = ZALO_PROVIDER
    readonly dataType: string = zaloEvent.name
    readonly limits: PollLimits
    readonly cadence: PollCadence = ZALO_POLL_CADENCE

    constructor(private readonly reader: ZaloSandboxInboxPollerService) {
        this.limits = reader.limits
    }

    /** The account's kept messages of the window as event rows. */
    async read(account: ConnectionRecord, window: PollWindow): Promise<PollPage<PolledRow>> {
        return polledPageOf(await this.reader.fetch(account, window))
    }

    /** A sandbox read has no provider failure: anything thrown is given up on. */
    classify(): PollFailure {
        return this.reader.classify()
    }
}
