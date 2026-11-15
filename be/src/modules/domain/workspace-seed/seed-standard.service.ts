import { Inject, Injectable, Optional } from "@nestjs/common"
import { placeOf, targetIncludes } from "@modules/domain/channel-provisioning"
import { eachInOrder } from "@modules/platform/primitives"
import { WorkspaceSeedError, WorkspaceSeedErrorCode } from "./errors/workspace-seed.error"
import { SeedReceiptsService } from "./seed-receipts.service"
import type { SeedDoorsPort, SeedStandardCheckout, SeedStandardDriver, SeedStandardRef } from "./seed-standard.port"
import {
    SEED_DOCUMENT_PATH,
    doorsLineOf,
    readDoorOutcomes,
    readSeedStandardBundles,
    readSeedStandardRefs,
    sealedPathOf,
    seedDecisionOf,
    type SeedDoorOutcome,
    type SeedStandardBundle,
} from "./seed-standard.policy"
import type { SetProfile } from "./set-seed.contracts"
import { readSeedDocument } from "./set-seed.policy"
import { SetSeedService } from "./set-seed.service"
import { InjectWorkspaceSeedOptions, SEED_DOORS, SEED_STANDARD_DRIVER } from "./workspace-seed.decorators"
import type { WorkspaceSeedOptions } from "./workspace-seed.options"

/** The typed code of a door's refusal (a typed error's `code`), never its message's data. */
const codeOf = (cause: unknown): string => {
    const code = typeof cause === "object" && cause !== null && "code" in cause ? (cause as { code: unknown }).code : undefined
    return typeof code === "string" && /^[A-Z][A-Z0-9_]{0,99}$/u.test(code) ? code : "DOOR_REFUSED"
}

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
        @Optional() @Inject(SEED_DOORS) private readonly doorSteps?: SeedDoorsPort,
    ) {}

    /** The bring-up's step: every declared standard in the environment (`dev` = local, `production` = prod); `dry` writes nothing and says what would happen. */
    async apply(input: string, environment: string, dry: boolean): Promise<void> {
        const place = placeOf(environment)
        const bundles = readSeedStandardBundles(input)
        let changed = false
        await eachInOrder(readSeedStandardRefs(input), async (ref) => {
            const receipt = await this.receipts.find(ref.name, environment)
            const decision = seedDecisionOf(ref, receipt)
            if (decision.act === "skip") {
                this.options.print(`${ref.name}: ${decision.why}: nothing done`)
                return
            }
            const pinned = await this.pinned(ref, bundles.get(ref.name))
            if (!targetIncludes(pinned.profile.target, place)) {
                this.options.print(`${ref.name}: target is ${pinned.profile.target}: nothing seeded on ${environment}`)
                return
            }
            const reseed = decision.act === "reseed" ? { since: decision.since, kinds: new Set(ref.forceKinds) } : null
            this.options.print(`${ref.name}: ${dry ? "would " : ""}${reseed === null ? "seed" : `re-seed (force at ${ref.commit}, overriding a person's changes of [${ref.forceKinds.join(", ")}])`}`)
            const texts = Object.fromEntries(
                await Promise.all(pinned.profile.documents.map(async (document) => [document.path, (await pinned.checkout.readText(document.path)) ?? ""] as const)),
            )
            const outcome = await this.applier.apply({
                profile: pinned.profile,
                place,
                dry,
                bind: true,
                sealed: await pinned.checkout.sealedOf(sealedPathOf(place)),
                texts,
                reseed,
                ownerEmail: ref.ownerEmail,
            })
            const nodeSettings = reseed === null || reseed.kinds.has("node-settings")
            if (dry) {
                if (pinned.profile.timeZone !== null) this.options.print(`${ref.name}: would set the time zone ${pinned.profile.timeZone}`)
                if (nodeSettings) this.applier.printNodePlan(pinned.profile, place)
                this.applier.printSwitchPlan(pinned.profile, place)
                return
            }
            if (outcome.workspaceId === null) return
            await this.receipts.record({
                name: ref.name,
                environment,
                workspaceId: outcome.workspaceId,
                commit: ref.commit,
                forcedCommit: reseed === null ? (receipt?.forcedCommit ?? null) : ref.commit,
                tally: outcome.tally,
            })
            const doors = await this.sendDoors(ref.name, pinned.profile, place, outcome.workspaceId, nodeSettings, reseed === null)
            const recorded = await this.receipts.recordDoors(ref.name, environment, doors)
            this.options.print(`${ref.name}: ${recorded ? doorsLineOf(doors) : "no receipt in this environment: door outcomes not recorded"}`)
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
     * Records in each standard's receipt the outcome of its door steps (the door script's report on stdin): a refused setting becomes a FAILED
     * seed step with its typed code, shown by every later bring-up and dry run (never only a log line). A standard with no receipt is named.
     */
    async recordDoors(input: string, environment: string): Promise<void> {
        for (const [name, doors] of readDoorOutcomes(input)) {
            const recorded = await this.receipts.recordDoors(name, environment, doors)
            this.options.print(`${name}: ${recorded ? doorsLineOf(doors) : "no receipt in this environment: door outcomes not recorded"}`)
        }
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

    /**
     * The DOOR STEPS of a seed, sent inside the seed itself through the app's own doors as the workspace's owner (`SEED_DOORS`): the time
     * zone, then each node setting of the place (only on the first seed, or when the force names `node-settings`). Each outcome is done, or
     * FAILED with the door's typed code (the rest goes on); no door bound fails every step with `SEED_DOORS_MISSING`.
     */
    private async sendDoors(
        name: string,
        profile: SetProfile,
        place: ReturnType<typeof placeOf>,
        workspaceId: string,
        nodeSettings: boolean,
        firstSeed: boolean,
    ): Promise<ReadonlyArray<SeedDoorOutcome>> {
        const doors: Array<SeedDoorOutcome> = []
        const ownerId = await this.applier.ownerOfWorkspace(workspaceId)
        const steps = await this.applier.doorStepsOf(profile, place, workspaceId)
        const send = async (step: string, act: (port: SeedDoorsPort, owner: string) => Promise<void>): Promise<void> => {
            if (this.doorSteps === undefined || ownerId === null) doors.push({ step, outcome: "failed", code: "SEED_DOORS_MISSING" })
            else {
                try {
                    await act(this.doorSteps, ownerId)
                    doors.push({ step, outcome: "done", code: null })
                } catch (cause) {
                    doors.push({ step, outcome: "failed", code: codeOf(cause) })
                }
            }
            const last = doors.at(-1)
            this.options.print(`${name}: door ${step}: ${last?.outcome === "done" ? "done" : `FAILED ${String(last?.code)}`}`)
        }
        const zone = steps.timeZone
        if (zone !== null) await send("settings timeZone", (port, owner) => port.setTimeZone(workspaceId, owner, zone))
        if (nodeSettings) {
            await eachInOrder(steps.nodes, (node) => send(`node ${node.workflow}/${node.node}`, (port, owner) => port.setNodeSettings(workspaceId, owner, node)))
        }
        // The trigger switches the standard declares in this place (triggers rule 6: the standard is the owner's declaration), every run: a
        // switch already as declared is kept; one that has fired is left on a re-seed (a switch in use is the person's).
        await eachInOrder(steps.switches, (one) =>
            send(`switch ${one.account}/${one.trigger}`, async (port, owner) => {
                const done = await port.setSwitch(workspaceId, owner, one, firstSeed)
                this.options.print(`${name}: switch ${one.account}/${one.trigger} ${one.enabled ? "on" : "off"}: ${done}`)
            }),
        )
        return doors
    }

    /** The standard at its pin: the bundle the one-shot route materialised for it, else read through the driver; neither is a typed refusal. */
    private async pinned(ref: SeedStandardRef, bundle?: SeedStandardBundle): Promise<Pinned> {
        if (bundle !== undefined) {
            if (bundle.commit !== ref.commit) throw new WorkspaceSeedError({ code: WorkspaceSeedErrorCode.PinUnverified, params: { name: ref.name } })
            return this.read(ref, { readText: (path) => Promise.resolve(bundle.files[path] ?? null), sealedOf: () => Promise.resolve(bundle.sealed) })
        }
        if (this.driver === undefined) throw new WorkspaceSeedError({ code: WorkspaceSeedErrorCode.DriverMissing, params: { name: ref.name } })
        return this.read(ref, await this.driver.checkout(ref))
    }

    private async read(ref: SeedStandardRef, checkout: SeedStandardCheckout): Promise<Pinned> {
        const text = await checkout.readText(SEED_DOCUMENT_PATH)
        if (text === null) throw new WorkspaceSeedError({ code: WorkspaceSeedErrorCode.InputInvalid, params: { field: SEED_DOCUMENT_PATH } })
        this.options.print(`${ref.name}: read at ${ref.commit}`)
        return { checkout, profile: readSeedDocument(text, { name: ref.name, commit: ref.commit }) }
    }
}
