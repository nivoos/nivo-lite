import { Field, ID, InputType } from "@nestjs/graphql"
import { IsUUID, MaxLength } from "class-validator"

@InputType()
/** Which conversation to hand back to the agents. The conversation is named by its route (the `routeId` of the chat the workbench reads). */
export class ReleaseConversationInput {
    /** The route of the conversation: the engine's id of the person on the entrance, the `routeId` of the chat. */
    @Field(() => ID)
    @IsUUID("4")
    @MaxLength(36)
    conversationId!: string
}
