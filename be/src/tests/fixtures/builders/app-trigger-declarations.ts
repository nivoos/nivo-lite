import { CLOCK_TICK_TRIGGER, TIMER_DUE_TRIGGER } from "@modules/domain/agent-schedules/engine-time.triggers"
import { WORKFLOW_CALL_TRIGGER } from "@modules/domain/agent-schedules/workflow-call.trigger"
import { BANK_TRANSACTION_TRIGGERS } from "@modules/domain/bank-feed-inbox/bank-transaction.trigger"
import { IMAP_MAIL_TRIGGER } from "@modules/domain/data-hub/imap-mail.trigger"
import { WEBSITE_FORM_TRIGGER } from "@modules/domain/inbox-leads/website-form.trigger"
import { META_TRIGGERS } from "@modules/domain/meta-inbox/meta-message.trigger"
import { triggerDeclarations, type TriggerDeclaration } from "@modules/domain/provider-triggers"
import { TEAM_CHAT_MESSAGE_TRIGGER } from "@modules/domain/team-chat/team-chat-message.trigger"
import { TELEGRAM_TRIGGERS } from "@modules/domain/telegram-inbox/telegram-message.trigger"
import { renderTriggerOf } from "@modules/domain/video-compose/video-render.trigger"
import { ZALO_TRIGGERS } from "@modules/domain/zalo-provider/zalo-message.trigger"

/** The cloud video compose providers: each has its own render trigger (`renderTriggerOf`). */
export const COMPOSE_PROVIDERS: ReadonlyArray<string> = ["shotstack", "creatomate", "json2video"]

/**
 * Every trigger declaration the api app registers at boot, imported from the files that declare them (the providers' modules register the
 * same objects in their `onModuleInit`). A new source adds its line here; the receipt gate checks the registering files against it.
 */
export const APP_TRIGGER_DECLARATIONS: ReadonlyArray<TriggerDeclaration> = [
    ...ZALO_TRIGGERS,
    ...TELEGRAM_TRIGGERS,
    ...META_TRIGGERS,
    ...BANK_TRANSACTION_TRIGGERS,
    IMAP_MAIL_TRIGGER,
    ...COMPOSE_PROVIDERS.map((provider) => renderTriggerOf(provider)),
    WEBSITE_FORM_TRIGGER,
    TEAM_CHAT_MESSAGE_TRIGGER,
    CLOCK_TICK_TRIGGER,
    TIMER_DUE_TRIGGER,
    WORKFLOW_CALL_TRIGGER,
]

/** Registers every declaration of the app, as the booted api has them: for a spec that judges graphs without booting the providers. */
export const registerAppTriggerDeclarations = (): void => {
    triggerDeclarations.register(...APP_TRIGGER_DECLARATIONS)
}
