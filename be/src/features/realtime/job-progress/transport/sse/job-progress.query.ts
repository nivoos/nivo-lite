import { IsOptional, Matches } from "class-validator"
import { JOB_PROGRESS_SELECTOR_PATTERNS } from "@modules/platform/jobs"

/**
 * The chains a progress stream follows: one root `<kind>:<id>`, a list of them, or neither (every chain of the workspace). `root` and
 * `roots` add up when both are given (a client that names one chain and a list gets both).
 */
export class JobProgressStreamQuery {
    /** One chain, as its jobs' progress declaration names its root. */
    @IsOptional()
    @Matches(JOB_PROGRESS_SELECTOR_PATTERNS.root)
    root?: string

    /** Up to 50 chain roots, comma separated; the stream carries only the frames of the chains named. */
    @IsOptional()
    @Matches(JOB_PROGRESS_SELECTOR_PATTERNS.roots)
    roots?: string
}
