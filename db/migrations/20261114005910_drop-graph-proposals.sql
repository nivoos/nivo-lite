-- drop-graph-proposals: forward-only; immutable once on origin/main. WRITTEN, NOT APPLIED by the GRAPH-CLEAN worker: the restart owner
-- applies it WITH the code of the same tree (owner ruling R89: a stored graph is exactly an installed template version; no door edits it).
-- Rule (GRAPH-CLEAN): nothing writes a proposal to change a graph, because no door can confirm one. NODE-SETTINGS deleted the confirm /
-- decline doors; this change deleted every producer and reader: the Brain-conflict half of `AgentGraphWatchService` (the seeding half and
-- its job stay), `AgentGraphContractSetupService` (gaps raised at a setup apply), `AgentGraphProposalsService` (+ the dead `raiseContract`),
-- the agent page's `proposalsJson` / `unheldRulesJson`, the records, store and mapper members, and the source index the Brain comparison
-- alone read (`agent_graph_sources`, written at every publish, read only by the comparison).
--
-- No row a person still has to act on is lost: since R89 no door acts on a proposal (an open row can be neither confirmed nor declined),
-- and what each one was derived from stays (a conflict: the two Brain facts; a gap: the setup text of the context version; a learned or
-- contract patch: nothing left can apply it). Rows on dev, from code reading only (no database was read): conflict rows only where an
-- action-graph node cites a Brain fact that was replaced (no seed writes a citing node: expected 0); gap rows at most one per setup
-- sentence the model read as an approval sum (a few at most); learned / contract rows only from before their producers were deleted.
-- The NOTICE below counts the open ones.

DO $$
DECLARE
    open_rows bigint;
BEGIN
    SELECT count(*) INTO open_rows FROM public.agent_graph_proposals WHERE status = 'open';
    RAISE NOTICE 'drop-graph-proposals: % open graph proposal row(s) dropped (no door can act on them since R89)', open_rows;
END
$$;

DROP TABLE IF EXISTS public.agent_graph_proposals;
DROP TABLE IF EXISTS public.agent_graph_sources;
