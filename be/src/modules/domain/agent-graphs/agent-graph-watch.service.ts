import { Injectable } from "@nestjs/common"
import { InstallationRecordsService } from "@modules/domain/module-installations"
import { eachInOrder } from "@modules/platform/primitives"
import { AgentGraphSeedService } from "./agent-graph-seed.service"
import { AgentGraphsService } from "./agent-graphs.service"

/** How many agents one tick seeds. */
const SEED_BATCH = 50
/** How many installations one page of the walk reads, and the most pages one tick walks. */
const PAGE = 200
const PAGES = 10
/** The language a graph is seeded in when nothing says otherwise. */
const SEED_LOCALE = "vi"

/** What one tick did. */
export interface WatchReport {
    /** Agents given their graph. */
    readonly seeded: number
    /** Seeds brought up to the rule they came from. */
    readonly refreshed: number
}

@Injectable()
/**
 * The tick of the graphs, run in code with no model: it gives an agent that has no graph its seed (in batches of 50) and keeps a seed
 * in step with the rule it came from. It proposes nothing: a stored graph is an installed template version (owner ruling R89), so the
 * Brain-conflict comparison that raised graph proposals no door can confirm is deleted (GRAPH-CLEAN).
 */
export class AgentGraphWatchService {
    constructor(
        private readonly installations: InstallationRecordsService,
        private readonly graphs: AgentGraphsService,
        private readonly seed: AgentGraphSeedService,
    ) {}

    /** Runs the two passes. */
    async tick(): Promise<WatchReport> {
        const seeded = await this.seedMissing()
        const refreshed = await this.refreshSeeds()
        return { seeded, refreshed }
    }

    /** Walks the installations and brings each seed up to its rule, at most the batch in one tick. */
    private async refreshSeeds(after = "", page = 0, moved = 0): Promise<number> {
        if (page >= PAGES || moved >= SEED_BATCH) return moved
        const rows = await this.installations.page(after, PAGE)
        const last = rows.at(-1)
        if (last === undefined) return moved
        let made = 0
        await eachInOrder(rows, async (row) => {
            const state = row.agentId === null ? null : await this.graphs.stateOfAgent(row.workspaceId, row.agentId)
            if (
                state !== null &&
                made + moved < SEED_BATCH &&
                (await this.seed.refresh(state, row.moduleKey, SEED_LOCALE))
            )
                made += 1
        })
        return this.refreshSeeds(last.id, page + 1, moved + made)
    }

    /** Seeds one page of the walk, then the next, until the batch is full or the installations are all seen. */
    private async seedMissing(after = "", page = 0, seeded = 0): Promise<number> {
        if (page >= PAGES || seeded >= SEED_BATCH) return seeded
        const rows = await this.installations.page(after, PAGE)
        const last = rows.at(-1)
        if (last === undefined) return seeded
        const withAgent = rows.flatMap((row) =>
            row.agentId === null ? [] : [{ id: row.id, agentId: row.agentId, workspaceId: row.workspaceId }],
        )
        const missing = await this.missingOf(withAgent)
        const wanted = withAgent.filter((entry) => missing.has(entry.agentId)).slice(0, SEED_BATCH - seeded)
        let made = 0
        await eachInOrder(wanted, async (row) => {
            if ((await this.seed.ensureFor(row.id, SEED_LOCALE)) !== null) made += 1
        })
        return this.seedMissing(last.id, page + 1, seeded + made)
    }

    /** The agents of the rows that have no graph yet, asked one workspace at a time. */
    private async missingOf(
        rows: ReadonlyArray<{ readonly agentId: string; readonly workspaceId: string }>,
    ): Promise<ReadonlySet<string>> {
        const missing = new Set<string>()
        const workspaceIds = [...new Set(rows.map((row) => row.workspaceId))]
        await eachInOrder(workspaceIds, async (workspaceId) => {
            const found = await this.graphs.missingGraph(
                workspaceId,
                rows.filter((row) => row.workspaceId === workspaceId).map((row) => row.agentId),
            )
            found.forEach((agentId) => missing.add(agentId))
        })
        return missing
    }
}
