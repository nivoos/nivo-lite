import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { EVENT_BUS } from "@modules/platform/event-bus"
import type { EventBus } from "@modules/platform/event-bus"
import { RequeueEventJobsCli } from "./requeue-event.cli"

const build = async () => {
    const bus = mock<EventBus>()
    const moduleRef = await Test.createTestingModule({
        providers: [RequeueEventJobsCli, { provide: EVENT_BUS, useValue: bus }],
    }).compile()
    return { cli: moduleRef.get(RequeueEventJobsCli), bus }
}

describe("RequeueEventJobsCli", () => {
    it.each([
        { sent: true, line: "requeued\n" },
        { sent: false, line: "not a buried event\n" },
    ])("sends the dead letter back to its queue and prints $line", async ({ sent, line }) => {
        const { cli, bus } = await build()
        bus.requeue.mockResolvedValue(sent)
        const write = jest.spyOn(process.stdout, "write").mockImplementation(() => true)

        await cli.run(["q__c", "7"])

        expect(bus.requeue).toHaveBeenCalledWith("q__c", "7")
        expect(write).toHaveBeenCalledWith(line)
        write.mockRestore()
    })
})
