import { Module } from "@nestjs/common"
import { WebsiteSubmissionDeliveryService } from "@modules/domain/inbox-leads"
import { ConfigurableModuleClass } from "./deliver-website-form.module-definition"
import { DeliverSubmissionStep } from "./steps/deliver-submission.step"

@Module({ providers: [WebsiteSubmissionDeliveryService, DeliverSubmissionStep], exports: [DeliverSubmissionStep] })
/** The application of the website-form job: the delivery of a stored submission (api only) and its step; the queue transport module imports it. */
export class DeliverWebsiteFormModule extends ConfigurableModuleClass {}
