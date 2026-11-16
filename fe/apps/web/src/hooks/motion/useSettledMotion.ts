"use client"

import { useEffect, useRef, type RefObject } from "react"

/** How long the looping animations of a part (a running step's spinner, a status echo) play after what it shows changed. */
export const MOTION_SETTLE_MS = 4_000

/** The looping animations (infinite iterations) of an element and everything inside it, its pseudo-elements included. */
const loopsOf = (root: Element): ReadonlyArray<Animation> =>
    root.getAnimations({ subtree: true }).filter((one) => one.effect?.getTiming().iterations === Infinity)

/** Stops the loops on their first frame, the resting look: a still spinner, the echo ring on its dot. */
const rest = (root: Element): void => {
    for (const one of loopsOf(root)) {
        if (one.playState === "paused" && one.currentTime === 0) continue
        one.pause()
        one.currentTime = 0
    }
}

/** Lets the loops play again. */
const play = (root: Element): void => {
    for (const one of loopsOf(root)) if (one.playState === "paused") one.play()
}

/**
 * Keeps the looping animations of a part still while nothing changes. Each time `signature` changes they play for
 * {@link MOTION_SETTLE_MS} and then stop on their resting frame; they never play while the tab is hidden or the person asked for reduced
 * motion. An element that appears later (React Flow draws its nodes after it measures them) is stopped as soon as it does, once the
 * moment has passed. A page left open on a run parked for hours therefore runs no animation frame at all.
 *
 * Returns the ref of the element that holds the part.
 */
export const useSettledMotion = <Holder extends Element>(signature: string): RefObject<Holder | null> => {
    const ref = useRef<Holder | null>(null)
    useEffect(() => {
        const root = ref.current
        if (root === null || typeof root.getAnimations !== "function") return undefined
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)")
        let isMoving = false
        let settle: ReturnType<typeof setTimeout> | undefined
        let frame = 0
        const stop = () => {
            isMoving = false
            rest(root)
        }
        const start = () => {
            clearTimeout(settle)
            if (reduced.matches || document.visibilityState === "hidden") {
                stop()
                return
            }
            isMoving = true
            play(root)
            settle = setTimeout(stop, MOTION_SETTLE_MS)
        }
        // A part drawn after the moment (a node measured late, a card opened) starts its own loops: still them on the next frame.
        const observer = new MutationObserver(() => {
            if (isMoving || frame !== 0) return
            frame = requestAnimationFrame(() => {
                frame = 0
                if (!isMoving) rest(root)
            })
        })
        observer.observe(root, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["data-status", "class"],
        })
        const onVisibility = () => {
            if (document.visibilityState === "hidden") {
                clearTimeout(settle)
                stop()
            }
        }
        const onReduced = () => {
            if (reduced.matches) {
                clearTimeout(settle)
                stop()
            }
        }
        document.addEventListener("visibilitychange", onVisibility)
        reduced.addEventListener("change", onReduced)
        start()
        return () => {
            clearTimeout(settle)
            cancelAnimationFrame(frame)
            observer.disconnect()
            document.removeEventListener("visibilitychange", onVisibility)
            reduced.removeEventListener("change", onReduced)
        }
    }, [signature])
    return ref
}
