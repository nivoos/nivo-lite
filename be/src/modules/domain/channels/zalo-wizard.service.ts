import { Injectable } from "@nestjs/common"
import { ConnectionSecretsService } from "@modules/domain/connection-secrets"
import { ConnectionsService, type WizardSettlement } from "@modules/domain/connections"
import { ZaloWizardDraftsService } from "@modules/domain/zalo-wizard-drafts"
import { RUN_ZALO_WIZARD_JOB, isZaloWizardPayload, type ZaloWizardPayload } from "@modules/queues/zalo-wizard"
import { ChannelsError, ChannelsErrorCode } from "./errors/channels.error"
import { ZaloCredentialsService } from "./zalo-credentials.service"

/** The zalo_oa provider key of the connections table. */
const PROVIDER = "zalo_oa"

const done = (command: string, extra: Partial<WizardSettlement> = {}): WizardSettlement => ({
    command,
    state: "done",
    url: "",
    code: "",
    oaSecretSaved: false,
    ...extra,
})

const failed = (command: string, code: ChannelsErrorCode): WizardSettlement => ({
    command,
    state: "failed",
    url: "",
    code,
    oaSecretSaved: false,
})

@Injectable()
/**
 * The three steps of the Zalo connection wizard that need the back end: sealing the app keys, sealing the OA Secret Key and building the Zalo
 * permission URL. The keys come from a draft the wizard's database function wrote (never from the queue payload) and the draft is removed once
 * sealed. The result is written on the connection row next to the ticket of the request, where the wizard reads it. A refusal the owner can
 * act on (the connection is not theirs, the keys are missing) is a failed result and the job returns; anything else is thrown for the runner,
 * and at the dead letter the same ticket reads failed. Every step is safe to run again: the permission URL reuses the verifier it stored, the
 * keys are sealed from the draft that is still there or found already sealed, and the result is written to the same ticket.
 */
export class ZaloWizardService {
    constructor(
        private readonly secrets: ConnectionSecretsService,
        private readonly drafts: ZaloWizardDraftsService,
        private readonly connections: ConnectionsService,
        private readonly credentials: ZaloCredentialsService,
    ) {}

    /** Runs one wizard job and writes its result next to its ticket. */
    async run(payload: unknown): Promise<void> {
        const wizard = this.wizardOf(payload)
        await this.connections.settleWizard(wizard.connectionId, wizard.ticket, await this.perform(wizard))
    }

    /** The wizard job went to its dead letter: the ticket reads failed (the owner can ask again), and a resume runs the step again. */
    async stopped(payload: unknown): Promise<void> {
        const wizard = this.wizardOf(payload)
        await this.connections.settleWizard(wizard.connectionId, wizard.ticket, failed(wizard.command, ChannelsErrorCode.WizardStopped))
    }

    private wizardOf(payload: unknown): ZaloWizardPayload {
        if (!isZaloWizardPayload(payload)) {
            throw new ChannelsError({ code: ChannelsErrorCode.PayloadInvalid, params: { job: RUN_ZALO_WIZARD_JOB.name } })
        }
        return payload
    }

    private async perform(payload: ZaloWizardPayload): Promise<WizardSettlement> {
        if (!(await this.ownsConnection(payload))) return failed(payload.command, ChannelsErrorCode.ConnectionNotFound)
        if (payload.command === "begin") return this.begin(payload)
        return payload.command === "app" ? this.sealApp(payload) : this.sealOa(payload)
    }

    private async begin(payload: ZaloWizardPayload): Promise<WizardSettlement> {
        const authorization = await this.credentials.beginAuthorization(payload.workspaceId, payload.connectionId)
        return done(payload.command, { url: authorization.url })
    }

    private async sealApp(payload: ZaloWizardPayload): Promise<WizardSettlement> {
        const { present, appId, appSecret } = await this.drafts.draftOf(payload.connectionId)
        if (!present) return this.alreadySealed(payload)
        if (appId === "" || appSecret === "") return failed(payload.command, ChannelsErrorCode.SecretUnreadable)
        // The OA secret key is copied later, from the Webhook screen; until then every webhook is refused (a blank key never verifies).
        await this.secrets.save(
            payload.connectionId,
            this.secrets.seal(JSON.stringify({ appId, appSecret, oaSecret: "" })),
        )
        await this.drafts.dropDraft(payload.connectionId)
        return done(payload.command)
    }

    private async sealOa(payload: ZaloWizardPayload): Promise<WizardSettlement> {
        const { present, oaSecret } = await this.drafts.draftOf(payload.connectionId)
        if (!present || oaSecret === "") return this.alreadySealed(payload)
        const loaded = await this.credentials.load(payload.connectionId)
        if (loaded.kind !== "ok") return failed(payload.command, ChannelsErrorCode.SecretUnreadable)
        await this.secrets.save(
            payload.connectionId,
            this.secrets.seal(JSON.stringify({ ...loaded.value.secret, oaSecret })),
        )
        await this.drafts.dropDraft(payload.connectionId)
        return done(payload.command, { oaSecretSaved: true })
    }

    /** A redelivered job finds its draft gone: it is done when the credential is readable, failed when it never was written. */
    private async alreadySealed(payload: ZaloWizardPayload): Promise<WizardSettlement> {
        const loaded = await this.credentials.load(payload.connectionId)
        if (loaded.kind !== "ok") return failed(payload.command, ChannelsErrorCode.SecretUnreadable)
        return done(payload.command, { oaSecretSaved: payload.command === "oa" && loaded.value.secret.oaSecret !== "" })
    }

    /** True when the connection is a Zalo connection of the workspace the owner proved. */
    private async ownsConnection(payload: ZaloWizardPayload): Promise<boolean> {
        const intake = await this.connections.intakeOf(payload.connectionId, PROVIDER)
        return intake.kind === "ok" && intake.value.workspaceId === payload.workspaceId
    }
}
