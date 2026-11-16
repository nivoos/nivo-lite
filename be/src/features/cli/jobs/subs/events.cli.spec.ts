import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { EVENT_BUS } from "@modules/platform/event-bus"
import type { EventBus } from "@modules/platform/event-bus"
import { EventsJobsCli } from "./events.cli"

const build = async () => {
    const bus = mock<EventBus>()
    const moduleRef = await Test.createTestingModule({
        providers: [EventsJobsCli, { provide: EVENT_BUS, useValue: bus }],
    }).compile()
    return { cli: moduleRef.get(EventsJobsCli), bus }
}

describe("EventsJobsCli", () => {
    it("prints one line per buried event of the queue: id, reason, deliveries, event id", async () => {
        const { cli, bus } = await build()
        bus.deadLetters.mockResolvedValue([
            { id: "7", reason: "input", readCount: 1, message: { eventId: "event-1" } },
            { id: "8", reason: "malformed", readCount: 1, message: "raw" },
        ])
        const write = jest.spyOn(process.stdout, "write").mockImplementation(() => true)

        await cli.run(["q__c", "5"])

        expect(bus.deadLetters).toHaveBeenCalledWith("q__c", 5)
        expect(write.mock.calls.map(([line]) => line)).toEqual(["7 input 1 event-1\n", "8 malformed 1 -\n"])
        write.mockRestore()
    })

    it("reads twenty when no limit is named, and says so when nothing is buried", async () => {
        const { cli, bus } = await build()
        bus.deadLetters.mockResolvedValue([])
        const write = jest.spyOn(process.stdout, "write").mockImplementation(() => true)

        await cli.run(["q__c"])

        expect(bus.deadLetters).toHaveBeenCalledWith("q__c", 20)
        expect(write).toHaveBeenCalledWith("no buried events\n")
        write.mockRestore()
    })

    it("propagates a failure of the bus", async () => {
        const { cli, bus } = await build()
        const failure = new Error("no such consumer queue")
        bus.deadLetters.mockRejectedValue(failure)

        await expect(cli.run(["nope"])).rejects.toBe(failure)
    })
})
