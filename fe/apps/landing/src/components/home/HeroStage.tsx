"use client"

import { useFormatter, useTranslations } from "next-intl"
import { useEffect, useRef, useState } from "react"
import { Glyph, Tick, nv } from "./shared"

/** The sample amount of the hero story (dong). */
const AMOUNT = 1_250_000
/** When each step of the story starts (ms from the loop start), and the loop length. */
const PLAN: ReadonlyArray<readonly [number, number]> = [
    [1, 500],
    [2, 1700],
    [3, 3100],
    [4, 6400],
    [5, 7600],
]
const LOOP_MS = 13_500
/** The server paints the approval-card state; the story starts after the first paint has settled. */
const START_AFTER_MS = 1600

/**
 * The console window of the hero, drawn from the real chat room (sample data), playing a 13.5 s story: a Zalo message arrives, the
 * agent drafts, the approval card slides in and "Approve" pulses, it is approved, the money comes in and matches the order.
 * With prefers-reduced-motion it shows the last frame and stays still.
 */
export const HeroStage = () => {
    const t = useTranslations("home.hero")
    const format = useFormatter()
    const [step, setStep] = useState(3)
    const [amount, setAmount] = useState(AMOUNT)
    const timers = useRef<number[]>([])

    useEffect(() => {
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        if (reduce) {
            setStep(5)
            return
        }
        const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms))
        const loop = () => {
            setStep(0)
            for (const [s, at] of PLAN) later(() => setStep(s), at)
            later(loop, LOOP_MS)
        }
        later(loop, START_AFTER_MS)
        return () => {
            for (const id of timers.current) window.clearTimeout(id)
            timers.current = []
        }
    }, [])

    useEffect(() => {
        if (step !== 5) return
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
        const start = performance.now()
        let frame = 0
        const run = (now: number) => {
            const k = Math.min(1, (now - start) / 1100)
            setAmount(AMOUNT * (1 - Math.pow(1 - k, 3)))
            if (k < 1) frame = requestAnimationFrame(run)
        }
        frame = requestAnimationFrame(run)
        return () => cancelAnimationFrame(frame)
    }, [step])

    const stageClass = ["stage", ...[1, 2, 3, 4, 5].filter((k) => k <= step).map((k) => `s${k}`)].join(" ")
    const money = `${format.number(Math.round(amount), { maximumFractionDigits: 0 })} ${t("amountUnit")}`

    return (
        <figure className={nv("stage-wrap")}>
            <div className={nv(stageClass)}>
                <div className={nv("float f1")} aria-hidden="true">
                    <span className={nv("av agent")}>
                        <Glyph name="chat" />
                    </span>
                    <span className={nv("stack")}>
                        <span className={nv("strong")}>{t("floatNewTitle")}</span>
                        <span className={nv("xs muted")}>{t("floatNewText")}</span>
                    </span>
                </div>
                <div className={nv("float f2")} aria-hidden="true">
                    <Tick small />
                    <span className={nv("stack")}>
                        <span className={nv("strong")}>{t("floatPaidTitle")}</span>
                        <span className={nv("xs muted")}>{t("floatPaidText")}</span>
                    </span>
                </div>
                <div className={nv("window")} role="img" aria-label={t("windowLabel")}>
                    <div className={nv("win-bar")} aria-hidden="true">
                        <span className={nv("win-dots")}>
                            <span />
                            <span />
                            <span />
                        </span>
                        <span className={nv("win-title")}>{t("windowTitle")}</span>
                        <span style={{ width: 42 }} />
                    </div>
                    <div className={nv("chatframe")} aria-hidden="true">
                        <div className={nv("chat-head")}>
                            <span className={nv("av agent")}>
                                <Glyph name="cpu" />
                            </span>
                            <div className={nv("stack")} style={{ flex: 1 }}>
                                <span className={nv("strong")}>{t("roomName")}</span>
                                <span className={nv("xs muted")}>{t("roomSub")}</span>
                            </div>
                            <span className={nv("badge success")}>
                                <span className={nv("dot live")} />
                                {t("running")}
                            </span>
                        </div>
                        <div className={nv("thread")}>
                            <div className={nv("msg it it1")}>
                                <span className={nv("av sm agent")}>
                                    <Glyph name="cpu" />
                                </span>
                                <div className={nv("msg-body")}>
                                    <span className={nv("xs muted")}>{t("m1Meta")}</span>
                                    <div className={nv("msg-card")}>
                                        <div className={nv("msg-title")}>
                                            <span className={nv("t")}>{t("m1Title")}</span>
                                            <span className={nv("badge")}>{t("m1Badge")}</span>
                                        </div>
                                        <p className={nv("quote")}>{t("m1Quote")}</p>
                                    </div>
                                </div>
                            </div>
                            <div className={nv("msg it it2")}>
                                <span className={nv("av sm agent")}>
                                    <Glyph name="cpu" />
                                </span>
                                <div className={nv("msg-body")}>
                                    <span className={nv("xs muted")}>{t("m2Meta")}</span>
                                    <span className={nv("typing")}>
                                        <span />
                                        <span />
                                        <span />
                                    </span>
                                </div>
                            </div>
                            <div className={nv("msg it it3")}>
                                <span className={nv("av sm agent")}>
                                    <Glyph name="cpu" />
                                </span>
                                <div className={nv("msg-body")}>
                                    <span className={nv("xs muted")}>{t("m3Meta")}</span>
                                    <div className={nv("msg-card")}>
                                        <div className={nv("msg-title")}>
                                            <span className={nv("t")}>{t("m3Title")}</span>
                                            <span className={nv("chip-swap")}>
                                                <span className={nv("badge accent before")}>{t("m3Ask")}</span>
                                                <span className={nv("badge after")}>{t("m3Answered")}</span>
                                            </span>
                                        </div>
                                        <div className={nv("kv")}>
                                            <div>
                                                <span className={nv("xs muted")}>{t("m3MsgLabel")}</span>
                                                <span>{t("m3Msg")}</span>
                                            </div>
                                            <div>
                                                <span className={nv("xs muted")}>{t("m3FileLabel")}</span>
                                                <span>{t("m3File")}</span>
                                            </div>
                                        </div>
                                        <div className={nv("cluster ask-only")} style={{ gap: 8 }}>
                                            <span className={nv("btn primary sm btn-approve")}>{t("approve")}</span>
                                            <span className={nv("btn outline sm")}>{t("refuse")}</span>
                                        </div>
                                        <div className={nv("done-only cluster")} style={{ gap: 8 }}>
                                            <Glyph name="checkc" extra="s16" />
                                            <span className={nv("sm")}>{t("m3Done")}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className={nv("msg it it5")}>
                                <span className={nv("av sm agent")}>
                                    <Glyph name="banknotes" />
                                </span>
                                <div className={nv("msg-body")}>
                                    <span className={nv("xs muted")}>{t("m5Meta")}</span>
                                    <div className={nv("msg-card")}>
                                        <div className={nv("paid")}>
                                            <Tick />
                                            <div className={nv("stack")}>
                                                <span className={nv("xs muted")}>{t("m5Text")}</span>
                                                <span className={nv("amt")}>{money}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <figcaption className={nv("caption")}>
                <Glyph name="eye" extra="s16" />
                {t("caption")}
            </figcaption>
        </figure>
    )
}
