import { Field, ObjectType } from "@nestjs/graphql"
import { ModuleBilingualType } from "./module-bilingual.type"

@ObjectType()
/** A document the module's agent works better with, suggested to the shop to add to its knowledge; never a requirement. */
export class ModuleKnowledgeIdeaType {
    /** The stable idea key; the same key from several modules is one suggestion. */
    @Field()
    key!: string

    /** What the document is about, as a short title. */
    @Field(() => ModuleBilingualType)
    topic!: ModuleBilingualType

    /** What to write in it. */
    @Field(() => ModuleBilingualType)
    hint!: ModuleBilingualType

    /** The business types it fits; empty means any. */
    @Field(() => [String])
    businessTypes!: ReadonlyArray<string>

    /** It fits every agent of the module's kind of work: it ranks after the specific ideas. */
    @Field()
    general!: boolean
}
