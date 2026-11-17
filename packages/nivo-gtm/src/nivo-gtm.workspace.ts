import type { Workspace } from "@starci/nivoos-sdk"
import { Deals } from "./agents/deals/deals.agent.ts"
import { Leads } from "./agents/leads/leads.agent.ts"
import { Social } from "./agents/social/social.agent.ts"
import { Studio } from "./agents/studio/studio.agent.ts"
import { NIVO_GTM_BRAIN } from "./brain/nivo-gtm.brain.ts"
import { Campaign } from "./objects/campaign.object.ts"
import { Content } from "./objects/content.object.ts"
import { Deal } from "./objects/deal.object.ts"
import { Demo } from "./objects/demo.object.ts"
import { Lead } from "./objects/lead.object.ts"
import { Publication } from "./objects/publication.object.ts"
import { VideoCut } from "./objects/video-cut.object.ts"
import { keyOf } from "./package-key.ts"

/**
 * `nivo-gtm.company`: the NIVO Tăng trưởng workspace, where NIVO sells NIVO with its own agents. A deploy finds or makes it under its derived id (the deployer becomes its owner), creates the seven
 * object types, syncs the brain documents and installs the agents. The accounts are Telegram, SePay and Google (Drive, Sheets): never Zalo, which only NIVO Web uses.
 */
export class NivoGtmWorkspace implements Workspace {
    readonly key = keyOf("company")
    readonly title = { vi: "NIVO Tăng trưởng", en: "NIVO Growth" }
    readonly agents = [Studio, Social, Deals, Leads]
    readonly objects = [Campaign, Content, VideoCut, Publication, Lead, Demo, Deal]
    readonly brain = NIVO_GTM_BRAIN
}
