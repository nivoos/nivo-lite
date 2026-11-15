import { defineAccountDataType, type AccountDataTypeDef } from "@modules/domain/account-data"

/**
 * The names of the credentials a bank-feed connection holds (SePay's API key and webhook key, Casso's API key and secure key, payOS's
 * client id, API key and checksum key), in every spelling the code and the providers' APIs use: no value of a bank-feed type may carry a
 * member of these names.
 */
const BANK_FEED_SECRET_FIELDS: ReadonlyArray<string> = [
    "apiKey",
    "api_key",
    "webhookSecret",
    "webhook_secret",
    "webhookKey",
    "secureKey",
    "secure_key",
    "secureToken",
    "secure_token",
    "checksumKey",
    "checksum_key",
    "credential",
]

/** The longest key of a delivery or a transaction: the longest key a row holds (a longer delivery id arrives hashed). */
const ID_MAX = 400

/** The longest transfer content a row keeps; banks cut theirs far shorter. */
const CONTENT_MAX = 2000

/**
 * The delivery row of the retired two-step road (a door kept a delivery, its job kept the movements): nothing writes it any more, a door and
 * the poll keep the movement itself. Declared only because its partition is in the committed migration text, which cannot name an
 * undeclared type; it goes with the migration that drops the three partitions (needs: TRIGGER-LEAD).
 */
const deliveryOf = (provider: string): AccountDataTypeDef =>
    defineAccountDataType({
        name: `${provider}.delivery`,
        provider,
        version: 1,
        write: "append",
        fields: {
            deliveryId: { type: "text", required: true, maxLength: ID_MAX },
            credits: { type: "json", required: true },
            source: { type: "text", required: false, maxLength: 8 },
        },
        key: ["deliveryId"],
        wakes: false,
        retention: { days: 30 },
        indexes: [],
        secretFields: BANK_FEED_SECRET_FIELDS,
        purpose: "bank.event",
    })

/**
 * One bank movement as the provider reported it, keyed by the provider's own transaction id, kept for good. A door (the webhook) or the poll
 * keeps it once; the new row is admitted (its job marks the account fed and hands the movement to its trigger) and stays pending until that
 * job completes it.
 */
const transactionOf = (provider: string, request?: RequestRefMember): AccountDataTypeDef =>
    defineAccountDataType({
        name: `${provider}.transaction`,
        provider,
        version: request === undefined ? 1 : request.version,
        write: "append",
        fields: {
            transactionId: { type: "text", required: true, maxLength: ID_MAX },
            amount: { type: "integer", required: true },
            direction: { type: "text", required: true, maxLength: 6 },
            content: { type: "text", required: true, maxLength: CONTENT_MAX },
            account: { type: "text", required: false, maxLength: 64 },
            payer: { type: "text", required: false, maxLength: 256 },
            bankRef: { type: "text", required: false, maxLength: ID_MAX },
            at: { type: "timestamp", required: false },
            source: { type: "text", required: true, maxLength: 8 },
            ...(request === undefined ? {} : { requestRef: { type: "text", required: false, maxLength: REQUEST_REF_MAX } }),
        },
        key: ["transactionId"],
        occurredAt: "at",
        wakes: true,
        retention: "keep",
        indexes: [
            { name: "account", on: ["account"] },
            { name: "bank_ref", on: ["bankRef"] },
        ],
        secretFields: BANK_FEED_SECRET_FIELDS,
        purpose: "bank.transaction",
    })

/** The longest payment-request reference a movement keeps (payOS's order code as text is far shorter). */
const REQUEST_REF_MAX = 100

/**
 * The member a feed whose provider names the payment request a movement pays keeps (`requestRef`, owner ruling R111), and the type version
 * it came in with (account-data rule 4: a schema change bumps the version; old rows keep theirs).
 */
interface RequestRefMember {
    readonly version: number
}

/** A delivery of a workspace's SePay feed. */
export const sepayDelivery: AccountDataTypeDef = deliveryOf("sepay")

/** A bank movement SePay reported. */
export const sepayTransaction: AccountDataTypeDef = transactionOf("sepay")

/** A delivery of a workspace's Casso feed (one delivery may hold several movements). */
export const cassoDelivery: AccountDataTypeDef = deliveryOf("casso")

/** A bank movement Casso reported. */
export const cassoTransaction: AccountDataTypeDef = transactionOf("casso")

/** A paid-order delivery of a workspace's payOS gateway. */
export const payosDelivery: AccountDataTypeDef = deliveryOf("payos")

/** A payment payOS reported. */
export const payosTransaction: AccountDataTypeDef = transactionOf("payos", { version: 2 })

/** Every account data type of a bank-feed connection, for the catalog. */
export const BANK_FEED_DATA_TYPES: ReadonlyArray<AccountDataTypeDef> = [
    cassoDelivery,
    cassoTransaction,
    payosDelivery,
    payosTransaction,
    sepayDelivery,
    sepayTransaction,
]
