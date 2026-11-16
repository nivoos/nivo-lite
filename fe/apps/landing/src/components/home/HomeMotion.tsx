"use client"

import { useEffect } from "react"

/**
 * The page's motion, started after the first paint and only with transform / opacity: scroll reveal of `.nv-rv`, the pointer spotlight
 * of `.nv-sheen` cards, the magnetic large primary buttons and the flow rail that fills with the scroll. With prefers-reduced-motion
 * every element stands still in its final state.
 */
export const HomeMotion = () => {
    useEffect(() => {
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        const cleanups: Array<() => void> = []

        const reveal = Array.from(document.querySelectorAll<HTMLElement>(".nv-rv"))
        if (reduce) {
            for (const element of reveal) element.classList.add("nv-in")
        } else {
            const observer = new IntersectionObserver(
                (entries) => {
                    for (const entry of entries) {
                        if (!entry.isIntersecting) continue
                        entry.target.classList.add("nv-in")
                        observer.unobserve(entry.target)
                    }
                },
                { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
            )
            for (const element of reveal) observer.observe(element)
            cleanups.push(() => observer.disconnect())
        }

        for (const card of Array.from(document.querySelectorAll<HTMLElement>(".nv-sheen"))) {
            const move = (event: PointerEvent) => {
                const box = card.getBoundingClientRect()
                card.style.setProperty("--mx", `${event.clientX - box.left}px`)
                card.style.setProperty("--my", `${event.clientY - box.top}px`)
            }
            card.addEventListener("pointermove", move)
            cleanups.push(() => card.removeEventListener("pointermove", move))
        }

        if (!reduce) {
            for (const button of Array.from(document.querySelectorAll<HTMLElement>(".nv-btn.nv-primary.nv-lg"))) {
                const move = (event: PointerEvent) => {
                    const box = button.getBoundingClientRect()
                    const x = (event.clientX - box.left - box.width / 2) * 0.12
                    const y = (event.clientY - box.top - box.height / 2) * 0.2 - 2
                    button.style.transform = `translate(${x}px, ${y}px)`
                }
                const leave = () => {
                    button.style.transform = ""
                }
                button.addEventListener("pointermove", move)
                button.addEventListener("pointerleave", leave)
                cleanups.push(() => {
                    button.removeEventListener("pointermove", move)
                    button.removeEventListener("pointerleave", leave)
                })
            }
        }

        const steps = document.querySelector<HTMLElement>(".nv-steps")
        const rail = steps?.querySelector<HTMLElement>(".nv-rail")
        const fill = steps?.querySelector<HTMLElement>(".nv-rail-fill")
        const dot = steps?.querySelector<HTMLElement>(".nv-rail-dot")
        if (steps && rail && fill && dot) {
            const cards = Array.from(steps.querySelectorAll<HTMLElement>(".nv-step"))
            const draw = (forced?: number) => {
                const box = rail.getBoundingClientRect()
                const progress = forced ?? Math.min(1, Math.max(0, (window.innerHeight * 0.55 - box.top) / box.height))
                fill.style.setProperty("--p", String(progress))
                dot.style.setProperty("--y", `${progress * box.height}px`)
                const reach = box.top + progress * box.height
                for (const card of cards) {
                    const node = card.querySelector(".nv-node")?.getBoundingClientRect()
                    if (node) card.classList.toggle("nv-on", reach >= node.top + node.height / 2 - 2)
                }
            }
            if (reduce) draw(1)
            else {
                let frame = 0
                const onScroll = () => {
                    cancelAnimationFrame(frame)
                    frame = requestAnimationFrame(() => draw())
                }
                window.addEventListener("scroll", onScroll, { passive: true })
                window.addEventListener("resize", onScroll)
                draw()
                cleanups.push(() => {
                    window.removeEventListener("scroll", onScroll)
                    window.removeEventListener("resize", onScroll)
                    cancelAnimationFrame(frame)
                })
            }
        }

        return () => {
            for (const cleanup of cleanups) cleanup()
        }
    }, [])
    return null
}
