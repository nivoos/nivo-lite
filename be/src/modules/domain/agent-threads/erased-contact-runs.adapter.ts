import { Inject, Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import type { RunSubject } from "@modules/domain/agent-runs"
import type { ContactRunsPort } from "@modules/domain/contacts/contact-runs.port"
import { CUSTOMER_ROUTE_STORE, type CustomerRouteStore } from "@modules/domain/customer-routes/customer-route-store.port"
import { ROUTES_PAGE_MAX } from "@modules/domain/customer-routes/customer-routes.service"
import { RECORD_SUBJECT_PATH } from "@modules/domain/record-events/record-written.trigger"
import { ErasedSubjectRunsService } from "./erased-subject-runs.service"

/** The subject path of a run keyed on a person (`key:contactId=<id>`). */
const CONTACT_SUBJECT = "contactId"

/** The subject path of a run keyed on a route (`key:routeId=<id>`). */
const ROUTE_SUBJECT = "routeId"

@Injectable()
/**
 * The runs of a contact being deleted, as the contacts see them (`CONTACT_RUNS`, coordinator ruling R37): the subjects of the person
 * (every id of them, and every route they hold) are read while the person is still live, then `ErasedSubjectRunsService.ended` ends
 * the runs parked on any of them in the deletion's own transaction. Generic: subjects are kind + id; nothing here knows a chat.
 */
export class ErasedContactRunsAdapter implements ContactRunsPort {
    constructor(
        private readonly erased: ErasedSubjectRunsService,
        @Inject(CUSTOMER_ROUTE_STORE) private readonly routes: CustomerRouteStore,
    ) {}

    /** Ends the runs parked on the contacts or their routes, in `tx`; answers the runs it ended. */
    async erasing(
        tx: EntityManager,
        workspaceId: string,
        contactIds: ReadonlyArray<string>,
        hidden: ReadonlyArray<{ readonly type: string; readonly id: string }> = [],
    ): Promise<ReadonlyArray<string>> {
        if (contactIds.length === 0) return []
        const routes = await this.routes.ofContacts(workspaceId, contactIds, ROUTES_PAGE_MAX)
        const subjects: ReadonlyArray<RunSubject> = [
            ...contactIds.map((id) => ({ kind: CONTACT_SUBJECT, id })),
            ...routes.map((route) => ({ kind: ROUTE_SUBJECT, id: route.id })),
            // A record the erase hid that is its own subject (a type whose write events are keyed by the record): its runs end too
            // (concept agent-data, "Contact and subject"). A record keyed by another subject leaves that subject untouched.
            ...hidden.map((record) => ({ kind: RECORD_SUBJECT_PATH, id: record.id })),
        ]
        return this.erased.ended(tx, workspaceId, subjects)
    }

    /** Once the deletion committed: the open stops of the runs it ended close with them; answers how many closed. */
    stopsClosed(workspaceId: string, runIds: ReadonlyArray<string>): Promise<number> {
        return this.erased.stopsClosed(workspaceId, runIds)
    }
}
