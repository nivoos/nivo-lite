/** Log events of the jobs. */
export enum JobsLogEvent {
    /** A write of a stale worker was refused: a newer worker owns the job and this one stopped with no further effect. */
    FencedOut = "jobs.fenced-out",
    /** A handler asked for its job to run again later; the job was given back with no failure, and the queue defers it. */
    Deferred = "jobs.delivery.deferred",
    /** A delivery failed and the job was marked failed for the queue to retry. */
    DeliveryFailed = "jobs.delivery.failed",
    /** A failed delivery could not even be recorded as failed; the lease will expire and the job will be claimed again. */
    FailureNotRecorded = "jobs.delivery.failure-not-recorded",
    /** The lease of a running job could not be renewed (the database failed, not the fence); the next beat tries again. */
    LeaseNotRenewed = "jobs.lease.not-renewed",
    /** A parked job was handed back to its queue. */
    Resumed = "jobs.resumed",
    /** A parked job was closed for good by a person, with the reason. */
    Closed = "jobs.closed",
    /** A delivery failed in a way its ladder does not try again: the job is parked as a dead letter with one item for a person. */
    DeadLettered = "jobs.dead-lettered",
    /** A dead letter was parked but nothing is bound to tell a person; the operator resumes it (`cli queues resume`). */
    DeadLetterUnbound = "jobs.dead-letter.unbound",
    /** The item of a dead letter could not be raised; the job stays parked and the next sweep or a person finds it. */
    DeadLetterNotRaised = "jobs.dead-letter.not-raised",
    /** A recurring tick failed to put its job on the queue; the next firing tries again and the app keeps running. */
    TickFailed = "jobs.tick.failed",
    /** A progress frame of a job could not be published; the job is untouched and goes on (the stream is a view of its row). */
    ProgressNotPublished = "jobs.progress.not-published",
    /** The progress of a job could not be recorded or told (its topic failed to resolve, or the row write failed); the job goes on. */
    ProgressNotTold = "jobs.progress.not-told",
}
