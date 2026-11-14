import { Injectable } from "@nestjs/common"
import { In, MoreThan, type EntityManager } from "typeorm"
import { InjectClock, type Clock } from "@modules/platform/clock"
import { InjectPrimaryEntityManager, returnedRows, rowShape } from "@modules/platform/database"
import { PaymentOrdersError, PaymentOrdersErrorCode } from "./errors/payment-orders.error"
import type { NewOrder, OpenOrderQuery, OrderLookup, PaymentOrder } from "./payment-orders.contracts"
import { toPaymentOrder } from "./payment-orders.mapper"
import { PaymentOrderEntity } from "./persistence/entities"

/** How many of the newest orders of a workspace are listed. */
const LIST_LIMIT = 50

/** How many ids one membership check reads. */
const IDS_LIMIT = 500

/** The row an insert answers with `RETURNING id`, to the transaction that won the order code. */
const isWrittenId = rowShape({ id: "string" })

/** The expression that gives an order its code: the database draws the next code of the sequence in the insert statement itself. */
const NEXT_ORDER_CODE = (): string => "public.next_payment_order_code()"

@Injectable()
/** The payment orders: the only writer of public.payment_orders. Settlement happens in SQL when the transfer arrives. */
export class PaymentOrdersService {
    constructor(
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
        @InjectClock() private readonly clock: Clock,
    ) {}

    /** The newest payment orders of a workspace; the application proves membership before calling this read. */
    async list(workspaceId: string): Promise<Array<PaymentOrder>> {
        const rows = await this.entityManager.find(PaymentOrderEntity, {
            where: { workspaceId },
            order: { createdAt: "DESC" },
            take: LIST_LIMIT,
        })
        return rows.map((item) => toPaymentOrder(item))
    }

    /** The ids among the given ones that are orders of the workspace. */
    async idsOfWorkspace(workspaceId: string, orderIds: ReadonlyArray<string>): Promise<Array<string>> {
        if (orderIds.length === 0) return []
        const rows = await this.entityManager.find(PaymentOrderEntity, {
            select: { id: true },
            where: { workspaceId, id: In([...new Set(orderIds)]) },
            take: IDS_LIMIT,
        })
        return rows.map((row) => row.id)
    }

    /** One workspace-scoped order; reads a lapsed pending order as expired without writing during a read. */
    async find(workspaceId: string, orderId: string): Promise<OrderLookup> {
        const row = await this.entityManager.findOne(PaymentOrderEntity, { where: { workspaceId, id: orderId } })
        if (row === null) return null
        const order = toPaymentOrder(row)
        return order.status === "pending" && new Date(order.expiresAt).getTime() < this.clock.now().getTime()
            ? { ...order, status: "expired" }
            : order
    }

    /** The newest plan order of a workspace that can still be paid. */
    async findOpenPlan(workspaceId: string): Promise<OrderLookup> {
        const row = await this.entityManager.findOne(PaymentOrderEntity, {
            where: { workspaceId, kind: "plan", status: "pending", expiresAt: MoreThan(this.clock.now()) },
            order: { createdAt: "DESC" },
        })
        return row === null ? null : toPaymentOrder(row)
    }

    /**
     * Writes a pending payment order. The order code is drawn by the database inside this one INSERT (`next_payment_order_code()`: the
     * next value of a sequence spread over the code space, so two orders never draw the same code: there is no collision to retry). An
     * order made for a request is made ONCE: the request id is a unique key, so a second call for the same request (a re-run after a
     * crash) writes nothing and answers the order the first call made.
     */
    async create(order: NewOrder): Promise<PaymentOrder> {
        const inserted = await this.entityManager
            .createQueryBuilder(PaymentOrderEntity, "p")
            .insert()
            .values({
                workspaceId: order.workspaceId,
                createdBy: order.userId,
                planCode: order.planCode,
                amountVnd: order.amountVnd,
                orderCode: NEXT_ORDER_CODE,
                kind: order.kind,
                packCode: order.packCode,
                detail: order.detail,
                requestId: order.requestId ?? null,
            })
            .orIgnore()
            .returning("id")
            .execute()
        const [written] = returnedRows(inserted.raw, isWrittenId)
        const row = await this.writtenOrder(written?.id, order.requestId)
        if (row === null) throw new PaymentOrdersError({ code: PaymentOrdersErrorCode.NotCreated })
        return toPaymentOrder(row)
    }

    /** The order the insert wrote, or, when it wrote nothing, the order the request already made; null when neither exists. */
    private writtenOrder(id: string | undefined, requestId: string | undefined): Promise<PaymentOrderEntity | null> {
        if (id !== undefined) return this.entityManager.findOne(PaymentOrderEntity, { where: { id } })
        if (requestId === undefined) return Promise.resolve(null)
        return this.entityManager.findOne(PaymentOrderEntity, { where: { requestId } })
    }

    /** The pending, unexpired top-up order that already asks for exactly this pack and amount, so a double click shows one QR. */
    findOpenTopup(query: OpenOrderQuery): Promise<OrderLookup> {
        return this.findOpen("topup", query)
    }

    /** The pending, unexpired upgrade order that already asks for exactly this plan and amount. */
    findOpenUpgrade(query: OpenOrderQuery): Promise<OrderLookup> {
        return this.findOpen("upgrade", query)
    }

    /** The pending, unexpired add-on pack order that already asks for exactly these credits and amount. */
    findOpenCreditPack(query: OpenOrderQuery): Promise<OrderLookup> {
        return this.findOpen("credit_pack", query)
    }

    /** The order with this code, read in the given transaction when one is, or null. */
    async findByCode(orderCode: string, manager: EntityManager = this.entityManager): Promise<OrderLookup> {
        const row = await manager.findOne(PaymentOrderEntity, { where: { orderCode: orderCode.toUpperCase() } })
        return row === null ? null : toPaymentOrder(row)
    }

    private async findOpen(
        kind: "topup" | "upgrade" | "credit_pack",
        query: OpenOrderQuery,
    ): Promise<OrderLookup> {
        const open = this.entityManager
            .createQueryBuilder(PaymentOrderEntity, "o")
            .where("o.workspaceId = :workspaceId AND o.kind = :kind AND o.status = 'pending'", {
                workspaceId: query.workspaceId,
                kind,
            })
            .andWhere("o.amountVnd = :amountVnd AND o.expiresAt > :now", {
                amountVnd: query.amountVnd,
                now: this.clock.now(),
            })
        if (kind === "topup") open.andWhere("o.packCode = :target", { target: query.target })
        if (kind === "upgrade") open.andWhere("o.planCode = :target", { target: query.target })
        if (kind === "credit_pack") open.andWhere("o.detail ->> 'credits' = :target", { target: query.target })
        const row = await open.orderBy("o.createdAt", "DESC").limit(1).getOne()
        return row === null ? null : toPaymentOrder(row)
    }
}
