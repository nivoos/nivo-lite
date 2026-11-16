import type { ConversationRelease } from "@modules/domain/agent-doors"
import type { ConversationReleaseType } from "./dto/agent-doors.type"

/** Maps what handing a conversation back did to the GraphQL type. */
export const toConversationReleaseType = (release: ConversationRelease): ConversationReleaseType => ({ ...release })
