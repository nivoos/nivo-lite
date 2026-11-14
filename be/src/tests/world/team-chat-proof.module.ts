import { Injectable, Module, type DynamicModule } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { AgentDirectoryService } from "@modules/domain/agents"
import {
    TEAM_CHAT_STORAGE,
    TEAM_CHAT_TAGS,
    TeamChatAccessService,
    TeamChatCardsService,
    TeamChatFilesService,
    TeamChatRoomsService,
    TeamChatStoreService,
    TeamChatViewsService,
    type TeamChatTags,
} from "@modules/domain/team-chat"
import { OBJECT_STORAGE_ERROR_CODES } from "@starci/object-storage"
import type { StorageObjectsPort } from "@modules/integrations/object-storage"

/** What a tag handed to the work core, as the proof records it. */
export interface RecordedTag {
    /** The workspace. */
    readonly workspaceId: string
    /** The tag as the chat handed it over. */
    readonly tag: Parameters<TeamChatTags["handOff"]>[2]
}

@Injectable()
/** The work core of a proof: it records every hand-off and allows the agents it was told to allow. */
export class TeamChatTagRecorder implements TeamChatTags {
    /** The hand-offs in the order they came. */
    readonly handed: Array<RecordedTag> = []
    /** The messages whose route job the chat wrote (one per stored message, in the message's own transaction). */
    readonly routed: Array<Parameters<TeamChatTags["queueRoute"]>[1]> = []
    /** The agents the proof lets a person hand work to. */
    allowed: ReadonlyArray<string> = []

    /** Records the route job of a stored message. */
    queueRoute(_tx: EntityManager, route: Parameters<TeamChatTags["queueRoute"]>[1]): Promise<void> {
        this.routed.push(route)
        return Promise.resolve()
    }

    /** Records the hand-off; true for an allowed agent. */
    handOff(_tx: EntityManager, workspaceId: string, tag: RecordedTag["tag"]): Promise<boolean> {
        this.handed.push({ workspaceId, tag })
        return Promise.resolve(this.allowed.includes(tag.agentId))
    }
}

@Injectable()
/** The private store of a proof: it keeps the sizes of the objects the proof says were uploaded, and what was removed. */
export class TeamChatProofStorage implements Pick<
    StorageObjectsPort,
    "signedUpload" | "sizeOf" | "signedUrls" | "remove"
> {
    /** The size of each uploaded object, by path. */
    readonly sizes: Map<string, number> = new Map<string, number>()
    /** The paths that were removed. */
    readonly removed: Array<string> = []
    /** Whether the store answers. */
    reachable = true

    /** An address for the path; none when the store is down. */
    signedUpload(_bucket: string, path: string): ReturnType<StorageObjectsPort["signedUpload"]> {
        return Promise.resolve(
            this.reachable
                ? { kind: "ok", value: { path, token: "", signedUrl: `https://store.test/put/${path}` } }
                : { kind: "refused", code: OBJECT_STORAGE_ERROR_CODES.Unavailable },
        )
    }

    /** The size the proof gave the object. */
    sizeOf(_bucket: string, path: string): ReturnType<StorageObjectsPort["sizeOf"]> {
        const size = this.sizes.get(path)
        return Promise.resolve(
            size === undefined
                ? { kind: "refused", code: OBJECT_STORAGE_ERROR_CODES.ObjectNotFound }
                : { kind: "ok", value: size },
        )
    }

    /** An address for each object the proof knows. */
    signedUrls(_bucket: string, paths: ReadonlyArray<string>): ReturnType<StorageObjectsPort["signedUrls"]> {
        return Promise.resolve({
            kind: "ok",
            value: paths
                .filter((path) => this.sizes.has(path))
                .map((path) => ({ path, signedUrl: `https://store.test/get/${path}` })),
        })
    }

    /** Removes the objects. */
    remove(_bucket: string, paths: ReadonlyArray<string>): ReturnType<StorageObjectsPort["remove"]> {
        this.removed.push(...paths)
        paths.forEach((path) => this.sizes.delete(path))
        return Promise.resolve({ kind: "ok", value: paths.length })
    }
}

@Module({
    providers: [
        TeamChatRoomsService,
        TeamChatStoreService,
        TeamChatAccessService,
        TeamChatViewsService,
        TeamChatCardsService,
        TeamChatFilesService,
        AgentDirectoryService,
        TeamChatTagRecorder,
        TeamChatProofStorage,
        { provide: TEAM_CHAT_TAGS, useExisting: TeamChatTagRecorder },
        { provide: TEAM_CHAT_STORAGE, useExisting: TeamChatProofStorage },
    ],
    exports: [TeamChatRoomsService, TeamChatTagRecorder, TeamChatProofStorage],
})
/** Runs the team chat over the private PostgreSQL proof database with the capabilities it reads people and agents through. */
export class TeamChatProofModule {
    /** Registers only what the team chat proofs need. */
    static register(): DynamicModule {
        return { module: TeamChatProofModule }
    }
}
