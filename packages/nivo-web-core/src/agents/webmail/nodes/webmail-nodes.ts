import type { TemplateNode } from "@nivo-lite/agent-sdk/template"
import { webmailHearNode } from "./hear.node"
import { webmailSortNode } from "./sort.node"
import { webmailSortedReportNode } from "./sorted-report.node"

/**
 * The steps of the Mailbox agent: hear the person's new mail (a read of their conversation with the mailbox), sort each mail, tell the
 * team and hand the sorted mail on. `webmail.classify` and `webmail.report` are deleted with the old versions that used them (ADDENDUM 2).
 */
export const webmailNodes: ReadonlyArray<TemplateNode> = [webmailHearNode, webmailSortNode, webmailSortedReportNode]
