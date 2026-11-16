"use client"

import { useState } from "react"
import { DEFAULT_UPLOAD_AREA, type InstanceOption } from "@/modules/documents"
import type { AddPreset, BatchOptionFields, BatchOptions } from "@/hooks/knowledgeAddTypes"

/** The module value of the "For" select: a type, or one instance of a type. */
const INSTANCE_PREFIX = "inst:"

/** The topic, tags and agent chosen once for everything the drawer adds. */
export const useBatchOptions = (preset: AddPreset | null, instances: ReadonlyArray<InstanceOption>): BatchOptions => {
    const [options, setOptions] = useState<BatchOptionFields>({
        topic: preset?.topic ?? "",
        tags: preset?.tags ?? "",
        module: "all",
        instanceId: null,
        visibility: DEFAULT_UPLOAD_AREA,
    })
    const pickModule = (value: string | null) => {
        const instance = instances.find((one) => `${INSTANCE_PREFIX}${one.id}` === value)
        const module = value === null || value === "" ? "all" : value
        setOptions((now) =>
            instance === undefined
                ? { ...now, module, instanceId: null }
                : { ...now, module: instance.moduleKey, instanceId: instance.id },
        )
    }
    return {
        ...options,
        moduleValue: options.instanceId === null ? options.module : `${INSTANCE_PREFIX}${options.instanceId}`,
        setTopic: (topic) => setOptions((now) => ({ ...now, topic: topic.slice(0, 80) })),
        setTags: (tags) => setOptions((now) => ({ ...now, tags })),
        pickModule,
        pickVisibility: (value) => setOptions((now) => ({ ...now, visibility: value === "public" ? "public" : "internal" })),
        meta: () => ({
            visibility: options.visibility,
            topic: options.topic.trim() === "" ? null : options.topic.trim(),
            tags: options.tags
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean),
            module: options.module === "all" ? null : options.module,
            installationId: options.instanceId,
        }),
    }
}
