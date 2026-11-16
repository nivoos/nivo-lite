/** Log events of the Meta inbox: ids and reasons only, never the words of a customer. */
export enum MetaInboxLogEvent {
    /**
     * A queued event's account was removed (or never connected) between the receipt and the delivery: nothing is delivered, the kept raw
     * `meta.event` row stays as the evidence, and the job ends with the typed outcome `account_removed`.
     */
    AccountRemoved = "meta_inbox.account_removed",
    /** A queued event's account is switched off (its connection delivers no events): nothing is delivered and the job ends with the typed outcome `switched_off`. */
    SwitchedOff = "meta_inbox.switched_off",
    /** A queued event was handled: how the job ended (`delivered`, `not_a_message`, `switched_off`, `account_removed`), ids only. */
    Outcome = "meta_inbox.outcome",
}
