import type { PinnedDocument } from "@modules/domain/openapi-tools"
import type {
    ProviderSandboxKeeps,
    ProviderSandboxOperation,
    ProviderSandboxReadsBack,
} from "@nivo-lite/agent-sdk/installation"

/*
 * THE FIXTURES A PACKAGE SHIPS for the sandbox of an outside system it pins by OpenAPI document (owner ruling R75: the engine knows no
 * system noun: operations, collections and fields are the package's words, data the engine stores and reads back without meaning).
 * The package declares them as the `sandbox` member of its provider template (`defineProviderTemplate`, the SDK owns the shapes, by the
 * operation's one name); the boot reader (`sandboxFixturesOf`) keys them by the document's operation id, and the engine's OpenAPI
 * sandbox answers each call of a sandbox account from them.
 */

/** A write whose answer the system would remember (the SDK's `ProviderSandboxKeeps`). */
export type OpenApiSandboxKeeps = ProviderSandboxKeeps

/** A read that answers a record an earlier write kept (the SDK's `ProviderSandboxReadsBack`). */
export type OpenApiSandboxReadsBack = ProviderSandboxReadsBack

/**
 * How one operation answers on a sandbox account (the SDK's `ProviderSandboxOperation`): the default answer (`OPENAPI-1`), the system's
 * own refusal (`OPENAPI-2`) and failure (`OPENAPI-3`) when the package declares them, state only where a call must change later reads.
 */
export type OpenApiSandboxOperationFixture = ProviderSandboxOperation

/**
 * What the sandbox of one connector (`crm.<id>`) answers from: the document the package pins (read once; null when it cannot be read:
 * then no operation can be answered) and the package's declarations by the document's operation id (the starting records, what an act
 * sets, its own refusal and failure answers).
 */
export interface OpenApiSandboxFixtures {
    readonly connector: string
    readonly document: PinnedDocument | null
    readonly operations: Readonly<Record<string, OpenApiSandboxOperationFixture>>
}
