-- connection-ready-one-poll-consumer (TRIGGER-LEAD, owner R95 / R96): ONE poll job for every provider. The two per-provider first-poll
-- consumers of `connection_ready` (bank_feed_poll, zalo_inbox_poll) and their per-provider reconcile jobs are replaced by ONE consumer,
-- `connection_poll` (be/src/features/reactors/connection-poll-ready): it makes a ready account hot in the connection poll's schedule, whose
-- tick reads it back through its provider's poll receiver. Queue names follow event-bus.queue.ts.
-- All-or-nothing with the code that has no consumer for the old queues and no processor for the old jobs.

select pgmq.create('connection_ready__connection_poll');
select pgmq.create('connection_ready__connection_poll__dead');
select pgmq.bind_topic('connection_ready', 'connection_ready__connection_poll');

-- A fact still waiting in an old queue is not carried over: the pass at process start makes every scheduled account due, so what its first
-- poll would have read is read by the first ticks after this release.
select pgmq.unbind_topic('connection_ready', 'connection_ready__bank_feed_poll');
select pgmq.drop_queue('connection_ready__bank_feed_poll');
select pgmq.drop_queue('connection_ready__bank_feed_poll__dead');
select pgmq.unbind_topic('connection_ready', 'connection_ready__zalo_inbox_poll');
select pgmq.drop_queue('connection_ready__zalo_inbox_poll');
select pgmq.drop_queue('connection_ready__zalo_inbox_poll__dead');

-- The retired jobs have no processor any more: their open outbox rows and job rows end here (no row of them is business state).
DELETE FROM public.job_outbox WHERE queue IN ('zalo-inbox-poll', 'bank-feed-poll');
DELETE FROM public.jobs WHERE kind IN ('reconcile-zalo-inbox', 'reconcile-bank-feed');
