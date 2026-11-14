import { Inject, Injectable, Optional } from "@nestjs/common"
import { placeOf, targetIncludes } from "@modules/domain/channel-provisioning"
import { eachInOrder } from "@modules/platform/primitives"
import { WorkspaceSeedError, WorkspaceSeedErrorCode } from "./errors/workspace-seed.error"
import { SeedReceiptsService } from "./seed-receipts.service"
import type { SeedStandardCheckout, SeedStandardDriver, SeedStandardRef } from "./seed-standard.port"
import { SEED_DOCUMENT_PATH, readSeedStandardRefs, sealedPathOf, seedDecisionOf } from "./seed-standard.policy"
import type { SetProfile } from "./set-seed.contracts"
import { readSeedDocument } from "./set-seed.policy"
import { SetSeedService } from "./set-seed.service"
import { InjectWorkspaceSeedOptions, SEED_STANDARD_DRIVER } from "./workspace-seed.decorators"
import type { WorkspaceSeedOptions } from "./workspace-seed.options"

/** The last line the stack seed step reads as "nothing changed". */
const UNCHANGED = "unchanged"

/** A standard read at its pin. */
interface Pinned {
    readonly checkout: SeedStandardCheckout
    readonly profile: SetProfile
}

@Injectable()
/**
 * THE SEED STANDARDS of a stack (R98, R101-R104), applied by the stack's BRING-UP only (the seed step runs `cli seed-standard apply` with the
 * stack's declarations on stdin; no person-facing command loads a standard). Each declaration (`nivo/seed-standard@1`: a
 * `<name>-seed-standard` repo, ONE pinned commit, an optional FORCE) is judged against its RECEIPT first: no receipt = the first seed; a
 * receipt = skipped whole ("already seeded at"), a new pin only reported, unless the declaration's force was not yet consumed at this commit
 * (then ONE re-seed that keeps relations, `SetSeedService.apply` with the precedence of R102). The repo is read through the data driver at
 * the pinned commit (its sealed file opened in memory), the document judged (`use: workspace`), and the receipt written after the apply.
 */
export class SeedStandardService {
    constructor(
        @InjectWorkspaceSeedOptions() private readonly options: WorkspaceSeedOptions,
        private readonly applier: SetSeedService,
        private readonly receipts: SeedReceiptsService,
        @Optional() @Inject(SEED_STANDARD_DRIVER) private readonly driver?: SeedStandardDriver,
    ) {}

    /** The bring-up's step: every declared standard in the environment (`dev` = local, `production` = prod); `dry` writes nothing and says what would happen. */
    async apply(input: string, environment: string, dry: boolean): Promise<void> {
        const place = placeOf(environment)
        let changed = false
        await eachInOrder(readSeedStandardRefs(input), async (ref) => {
            const receipt = await this.receipts.find(ref.name, environment)
            const decision = seedDecisionOf(ref, receipt)
            if (decision.act === "skip") {
                this.options.print(`${ref.name}: ${decision.why}: nothing done`)
                return
            }
            const pinned = await this.pinned(ref)
            if (!targetIncludes(pinned.profile.target, place)) {
                this.options.print(`${ref.name}: target is ${pinned.profile.target}: nothing seeded on ${environment}`)
                return
            }
            const reseed = decision.act === "reseed" ? { since: decision.since, kinds: new Set(ref.forceKinds) } : null
            this.options.print(`${ref.name}: ${dry ? "would " : ""}${reseed === null ? "seed" : `re-seed (force at ${ref.commit}, overriding a person's changes of [${ref.forceKinds.join(", ")}])`}`)
            const texts = Object.fromEntries(
                await Promise.all(pinned.profile.documents.map(async (document) => [document.path, (await pinned.checkout.readText(document.path)) ?? ""] as const)),
            )
            const outcome = await this.applier.apply({ profile: pinned.profile, place, dry, bind: true, sealed: await pinned.checkout.sealedOf(sealedPathOf(place)), texts, reseed })
            if (dry || outcome.workspaceId === null) return
            await this.receipts.record({
                name: ref.name,
                environment,
                workspaceId: outcome.workspaceId,
                commit: ref.commit,
                forcedCommit: reseed === null ? (receipt?.forcedCommit ?? null) : ref.commit,
                tally: outcome.tally,
            })
            changed = true
        })
        if (!dry) this.options.print(changed ? "applied" : UNCHANGED)
    }

    /**
     * Prints the door steps of every declared standard for the door script (the workspace's time zone; the node settings only on the first
     * seed, i.e. while no node setting was sent, or when the declaration's force names `node-settings`).
     */
    async doors(input: string, environment: string): Promise<void> {
        await eachInOrder(readSeedStandardRefs(input), async (ref) => {
            const receipt = await this.receipts.find(ref.name, environment)
            const nodeSettings = receipt === null || receipt.forcedCommit === null || ref.forceKinds.includes("node-settings")
            await this.applier.printDoors((await this.pinned(ref)).profile, nodeSettings)
        })
    }

    /**
     * Takes each declared standard's workspace off the LOCAL stack through the owner's soft delete and drops its receipt (so the next
     * bring-up seeds it anew); dry unless `execute`; never in production.
     */
    async reset(input: string, environment: string, execute: boolean): Promise<void> {
        if (placeOf(environment) !== "local") throw new WorkspaceSeedError({ code: WorkspaceSeedErrorCode.InputInvalid, params: { field: "env" } })
        await eachInOrder(readSeedStandardRefs(input), async (ref) => {
            await this.applier.resetProfile((await this.pinned(ref)).profile, execute)
            if (execute) await this.receipts.remove(ref.name, environment)
        })
    }

    /** The standard at its pin, read through the driver; no driver bound is a typed refusal, never a fallback. */
    private async pinned(ref: SeedStandardRef): Promise<Pinned> {
        if (this.driver === undefined) throw new WorkspaceSeedError({ code: WorkspaceSeedErrorCode.DriverMissing, params: { name: ref.name } })
        const checkout = await this.driver.checkout(ref)
        const text = await checkout.readText(SEED_DOCUMENT_PATH)
        if (text === null) throw new WorkspaceSeedError({ code: WorkspaceSeedErrorCode.InputInvalid, params: { field: SEED_DOCUMENT_PATH } })
        this.options.print(`${ref.name}: read at ${ref.commit}`)
        return { checkout, profile: readSeedDocument(text, { name: ref.name, commit: ref.commit }) }
    }
}
