"use client"

import { useEffect, useRef, useState } from "react"
import { nv } from "./shared"

type Mode = "auto" | "ask"

/** One "Do it / Ask first" switch of the automation section; `demo` flips it once when it scrolls into view, to show it moves. */
export const ModeSwitch = (props: {
    readonly label: string
    readonly initial: Mode
    readonly autoLabel: string
    readonly askLabel: string
    readonly demo?: boolean
}) => {
    const [mode, setMode] = useState<Mode>(props.initial)
    const root = useRef<HTMLSpanElement>(null)
    useEffect(() => {
        if (props.demo !== true || root.current === null) return
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
        const timers: number[] = []
        const observer = new IntersectionObserver(
            (entries) => {
                if (!entries.some((entry) => entry.isIntersecting)) return
                observer.disconnect()
                timers.push(window.setTimeout(() => setMode("ask"), 900))
                timers.push(window.setTimeout(() => setMode("auto"), 2400))
            },
            { threshold: 0.6 },
        )
        observer.observe(root.current)
        return () => {
            observer.disconnect()
            for (const id of timers) window.clearTimeout(id)
        }
    }, [props.demo])
    return (
        <span className={nv("seg")} data-v={mode} role="radiogroup" aria-label={props.label} ref={root}>
            {(["auto", "ask"] as const).map((value) => (
                <button
                    key={value}
                    type="button"
                    data-v={value}
                    role="radio"
                    aria-checked={mode === value}
                    onClick={() => setMode(value)}
                >
                    {value === "auto" ? props.autoLabel : props.askLabel}
                </button>
            ))}
        </span>
    )
}
