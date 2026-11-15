import { Module } from "@nestjs/common"
import { RecordEventDeliveryService } from "@modules/domain/record-events"
import { ConfigurableModuleClass } from "./deliver-record-event.module-definition"
import { DeliverRecordWriteStep } from "./steps/deliver-record-write.step"

@Module({ providers: [RecordEventDeliveryService, DeliverRecordWriteStep], exports: [DeliverRecordWriteStep] })
/** The application of the record-event job: the delivery of a record write (api only) and its step; the queue transport module imports it. */
export class DeliverRecordEventModule extends ConfigurableModuleClass {}
