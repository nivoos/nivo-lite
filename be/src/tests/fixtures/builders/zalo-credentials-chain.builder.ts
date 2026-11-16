import { Test } from "@nestjs/testing"
import { FakeClock, fakeTransaction, mock, mockEntityManager, recordingEventBus, type MockOf, type RecordingEventBus } from "@starci/jest-preset"
import { CHANNELS_OPTIONS } from "@modules/domain/channels/channels.decorators"
import { ZaloCredentialsService } from "@modules/domain/channels"
import { ConnectionSecretsService } from "@modules/domain/connection-secrets"
import { ConnectionSecretReadsService, ConnectionsService } from "@modules/domain/connections"
import type { ConnectionReadyEvent } from "@modules/events/api"
import { ZALO, type ZaloClient } from "@modules/integrations/zalo"
import { CLOCK } from "@modules/platform/clock"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { EVENT_BUS } from "@modules/platform/event-bus"
import { LOGGER, type Logger } from "@modules/platform/logging"
import { effectProviders, keptEffects, recordingOutbox, type KeptEffects, type WrittenJob } from "./provider-connections.builder"
import { configureCredentialDoubles, NOW } from "./zalo-credentials.builder"

/** The real credentials service with the doubles of its ports, the effect ledger, the outbox's writes and a clock a spec moves. */
export interface ZaloHarness {
    /** The service under test. */
    readonly service: ZaloCredentialsService
    /** The sealed-credential port. */
    readonly secrets: MockOf<ConnectionSecretsService>
    /** The credential reads. */
    readonly secretReads: MockOf<ConnectionSecretReadsService>
    /** The connections port. */
    readonly connections: MockOf<ConnectionsService>
    /** The Zalo client. */
    readonly zalo: MockOf<ZaloClient>
    /** The bus the ready events are published on. */
    readonly bus: RecordingEventBus<ConnectionReadyEvent>
    /** The clock the service reads. */
    readonly clock: FakeClock
    /** The effect ledger. */
    readonly ledger: KeptEffects
    /** The jobs the outbox was asked to write. */
    readonly written: ReadonlyArray<WrittenJob>
    /** True when every outbox write went through a transaction. */
    readonly inTransaction: () => boolean
}

/** The real credentials service over doubles for its ports, the effect ledger and a clock a spec moves. */
export const buildZalo = async (): Promise<ZaloHarness> => {
    const secrets = mock<ConnectionSecretsService>()
    const secretReads = mock<ConnectionSecretReadsService>()
    const connections = mock<ConnectionsService>()
    const zalo = mock<ZaloClient>()
    configureCredentialDoubles(secrets, secretReads, connections)
    const tx = fakeTransaction(mockEntityManager())
    const bus = recordingEventBus<ConnectionReadyEvent>()
    const clock = new FakeClock(NOW)
    const ledger = keptEffects()
    const { outbox, written, inTransaction } = recordingOutbox()
    const moduleRef = await Test.createTestingModule({
        providers: [
            ZaloCredentialsService,
            { provide: CLOCK, useValue: clock },
            { provide: CHANNELS_OPTIONS, useValue: { siteUrl: "https://nivo.test" } },
            { provide: ZALO, useValue: zalo },
            { provide: LOGGER, useValue: mock<Logger>() },
            { provide: ConnectionSecretsService, useValue: secrets },
            { provide: ConnectionSecretReadsService, useValue: secretReads },
            { provide: ConnectionsService, useValue: connections },
            { provide: PRIMARY_ENTITY_MANAGER, useValue: tx.em },
            { provide: EVENT_BUS, useValue: bus },
            ...effectProviders(ledger, outbox),
        ],
    }).compile()
    return { service: moduleRef.get(ZaloCredentialsService), secrets, secretReads, connections, zalo, bus, clock, ledger, written, inTransaction }
}
