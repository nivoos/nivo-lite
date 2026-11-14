import { polledMessageOf } from "./zalo-polled-message.policy"

const raw = {
    event_name: "user_send_text",
    timestamp: "1762192200000",
    sender: { id: "user-1", display_name: " Lan " },
    message: { msg_id: "m-1", text: "Hello" },
}

describe("polledMessageOf", () => {
    it("reads the message of a row the poll kept: its id, the listing's name, its words and Zalo's time", () => {
        expect(polledMessageOf({ eventId: "m-1", source: "poll", raw })).toEqual({
            messageId: "m-1",
            sender: "Lan",
            text: "Hello",
            sentAt: 1_762_192_200_000,
            raw,
        })
    })

    it("names the sender by the Zalo id when the listing showed no name", () => {
        const nameless = { ...raw, sender: { id: "user-1" } }

        expect(polledMessageOf({ eventId: "m-1", source: "poll", raw: nameless })?.sender).toBe("user-1")
    })

    it("answers null for a row the webhook or an import kept, and for a body without a message id or a time", () => {
        expect(polledMessageOf({ eventId: "m-1", raw })).toBeNull()
        expect(polledMessageOf({ eventId: "m-1", source: "manual_import", raw })).toBeNull()
        expect(polledMessageOf({ eventId: "m-1", source: "poll", raw: { ...raw, message: { text: "x" } } })).toBeNull()
        expect(polledMessageOf({ eventId: "m-1", source: "poll", raw: { ...raw, timestamp: "soon" } })).toBeNull()
        expect(polledMessageOf({ eventId: "m-1", source: "poll", raw: "text" })).toBeNull()
    })
})
