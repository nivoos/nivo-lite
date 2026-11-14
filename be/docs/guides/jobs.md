# Background jobs

Heavy work runs after the request commits. The request writes the business row and a `job_outbox` row in one PostgreSQL transaction,
then a relay publishes the committed job to BullMQ on the deployment's declared Redis. A rolled-back change cannot start work. Owner
decision A for v0.3.6 selects BullMQ for job queues; the event bus stays on pgmq.

## Where things live

| Piece                                                       | Path                                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| Outbox, relay, BullMQ transport, worker registry and status | `be/src/modules/platform/queue`                                          |
| Fenced claims and processor base                            | `be/src/modules/platform/jobs`                                           |
| Typed queue producers, names, payloads and dedupe keys      | `be/src/modules/queues/<queue>`                                          |
| Job processors and steps                                    | `be/src/features/jobs/<job>/{steps,transport/queue}`                     |
| API processor registration                                  | `be/apps/api/src/compose/jobs.ts`                                        |
| Durable queue functions and recurring job schedules         | the queue bullmq contract pgmq drop migration (folded into the baseline) |
| Operator commands                                           | `be/src/features/cli/jobs` and `starci app stack jobs`                   |

## Delivery and recovery

`QueueOutbox.write(tx, queue, payload, { job, dedupeKey })` writes through `job_enqueue`. The relay claims a bounded batch with short
database leases and `SKIP LOCKED`, commits those claims, then calls Redis outside the transaction. The BullMQ ID is the outbox UUID;
repeating publication is idempotent. A failed publication leaves durable work for a later pass.

Before invoking a handler, `job_start` counts a real start and acquires a leased workspace slot. A busy workspace is deferred without
spending a try. A running row whose lease expired can be admitted again; `done` and `failed` are terminal. Heartbeats and settlement
are fenced by a unique admission token, independent of the resettable attempt count, so an old delivery cannot settle its successor.

`JobRunnerService` claims `public.jobs` under a fencing token before running a `FencedProcessor`. An already completed fenced job is
an idempotent no-op. A live foreign claim defers the queue delivery until it can be claimed; it must not complete an unfinished outbox
row. Domain effects and step writes use the claimed token.

Reconciliation checks due nonterminal rows against Redis, with separate leased claims across replicas, fair work across queues and a
next-check time for jobs still waiting, delayed or active. Missing or failed broker copies are republished under the same UUID. One
repair failure is logged and does not stop later rows. A completed broker copy alone is not proof that a handler ran successfully.

Delivery within each queue is unordered: relay replicas, retries and deferrals can reorder work. Jobs that need per-key ordering must
carry a sequence and enforce it under their fence.

Recurring jobs are owned by pg_cron migrations and call `job_enqueue`, with an occurrence dedupe key. They enter the same durable
outbox and BullMQ lifecycle as request-driven jobs. The event bus's pgmq queues remain separate.

## A job is declared (concept `outbox-job`)

`defineJob({ name, queue, ladder, payload, onceKey, next, effects, progress? })` (`platform/jobs/job-definition.ts`) sits beside the
payload in `modules/queues/<queue>/<queue>.jobs.ts`. The producer writes the outbox with `onceKey(payload)` as the dedupe key inside the
caller's transaction; the processor sets `definition` and calls ONE domain method; a job enqueues only the jobs its `next` lists, in
the transaction that finishes it.

## Failure: one judge, two ladders, one dead letter

- `JobRunnerService` is the only place a job failure is judged: `classifyFailure` names the class (`transient`, `input`, `code`,
  `config`; a retry hint counts as transient). No service catches to wait, retry, count tries or swallow.
- Ladders (`platform/jobs/job-ladders.policy.ts`): `background` 4 starts with 5 / 10 / 20 s pauses; `waited` (a person waits) 5 starts
  with 1 / 2 / 4 / 8 min. A transient failure with starts left is failed and handed back with the ladder's pause (`QueueError`
  `RetryAfter`); the broker's `ATTEMPTS` (6) is only a ceiling above every ladder.
- Anything else, a transient failure on the last start, a payload the declaration refuses, or a delivery whose counted start is past
  the ladder (it died every time it ran) is a DEAD LETTER: the job row parks `failed_awaiting_fix`, the processor's `onFailed` writes the
  state its domain row shows (resumable), and ONE `job.parked` card goes to the founder's NIVO room per park episode
  (`JobDeadLettersService`, bound by `job-ops` `JobParkedAlertsService`).
- Resume: the founder's "Chạy lại" (`resumeStoppedWork`) or `cli queues resume --job <id>` opens a new episode; a new build hands back
  every dead letter; the 15-minute `parked-jobs:sweep` hands back only transient dead letters, at most 3 times, without a new card.
  "Đóng" (`closeStoppedWork`) ends a dead letter for good. A resumed job claims the same row, so recorded steps and settled effects stay.
- Shutdown hands an aborted delivery back without spending a start.

## Outside effects (`platform/effects`)

`Effects.once(key, effect, call)`: an `effect_ledger` row is committed as an intent before the act and settled after; key
`<jobId>:<effect>:<part>`. A settled key with a kept result answers without acting; an intent without a result is settled as the
effect declares (`repeatable`, `confirm`, `person`). Large answers are not kept: the domain write that stores them settles the key in
its transaction (`settleIn`).

## Progress (optional)

A job that declares `progress.topic(payload)` gets its committed state changes and its `JobProgress.report(job, done, total, labelKey)`
calls published to `job-progress:<workspaceId>:<root>`; the one door `GET /realtime/job-progress?root=<kind>:<id>` sends the current
state from the rows first, then live frames (Last-Event-ID resumes). Keys only; nobody listening changes nothing.

## Adding a job

1. Declare it with `defineJob` beside its payload guard in `modules/queues/<queue>/`; expose a typed producer that writes the outbox
   with the declaration's once key, in the transaction that commits the business change.
2. Add the processor (`definition` set) and its step under `features/jobs/<job>/`; the step calls one domain method.
3. Make every outside act an `Effects.once` with its declared settle; make every next job an outbox write in the finishing transaction.
4. Write one "killed between steps" spec and one "fails for good -> dead letter -> resume" spec for the chain.
5. Register its queue module in the API composition. Recurring work is a tick of `platform/jobs` (`job-ticks.contracts.ts`).

## Settings and operations

| Variable                       | Default         | Meaning                                                                             |
| ------------------------------ | --------------- | ----------------------------------------------------------------------------------- |
| `QUEUE_ENABLED`                | `true`          | Enables workers and relay; producers continue writing outbox rows when false.       |
| `QUEUE_REDIS_HOST`             | `localhost`     | Declared Redis host.                                                                |
| `QUEUE_REDIS_PORT`             | `6379`          | Redis port.                                                                         |
| `QUEUE_REDIS_DB`               | `0`             | Redis database.                                                                     |
| `QUEUE_REDIS_PREFIX`           | `nivo`          | BullMQ key prefix.                                                                  |
| `QUEUE_REDIS_PASSWORD`         | unset           | Optional Redis credential; configure only when the Redis server requires it.        |
| `QUEUE_CONCURRENCY`            | `4`             | Concurrent deliveries per queue per API, unless a processor asks for another limit. |
| `QUEUE_WORKSPACE_CONCURRENCY`  | `2`             | Slots per workspace across replicas.                                                |
| `QUEUE_RELAY_INTERVAL`         | `500ms`         | Pause after an empty relay pass.                                                    |
| `QUEUE_RELAY_BATCH`            | `50`            | Bounded relay and reconciliation batch size.                                        |
| `QUEUE_RECONCILE_AFTER`        | `15s`           | Initial stale-row check interval.                                                   |
| `QUEUE_VISIBILITY_TIMEOUT`     | `60s`           | Broker lock and workspace lease duration; leases renew every third of it.           |
| `QUEUE_SHUTDOWN_GRACE`         | `30s`           | Time existing deliveries get before shutdown abort.                                 |
| `JOBS_LEASE`, `JOBS_WORKER_ID` | `60s`, `worker` | Fenced claim lease and worker name.                                                 |
| `JOBS_SCHEDULER_ENABLED`       | `true`          | Whether this app fires the recurring ticks (the api does; one-off runs never).      |

Redis must have a finite positive `maxmemory` and explicit `maxmemory-policy noeviction`. The transport validates those settings
before publication or worker startup. Producer connections disable offline buffering and use 5 s connection and command deadlines.
Connection errors go through the application Logger.

Read `job_stats()`, `job_open()` and `job_failed()` through the existing operator commands. PostgreSQL queued age and failure alerts
remain the durable operational signal. Read [the jobs operations runbook](../runbooks/jobs-operations.md) before the pgmq-to-BullMQ
cutover or an operator retry.
