import "reflect-metadata"
import type { DynamicModule, InjectionToken, Type } from "@nestjs/common"
import { OPTIONAL_DEPS_METADATA, OPTIONAL_PROPERTY_DEPS_METADATA, PARAMTYPES_METADATA, PROPERTY_DEPS_METADATA, SELF_DECLARED_DEPS_METADATA } from "@nestjs/common/constants"
import { ApplicationConfig } from "@nestjs/core/application-config"
import { NestContainer } from "@nestjs/core/injector/container"
import type { InstanceWrapper } from "@nestjs/core/injector/instance-wrapper"
import type { Module } from "@nestjs/core/injector/module"
import { GraphInspector } from "@nestjs/core/inspector/graph-inspector"
import { MetadataScanner } from "@nestjs/core/metadata-scanner"
import { DependenciesScanner } from "@nestjs/core/scanner"
import { EnvSource } from "@modules/platform/config"

/**
 * The static check of an app's composition (the same reading as `scripts/di-ring-check.mjs`, over the SOURCE instead of the build): Nest's
 * own scanner registers the module graph of `AppModule.register(options)` (nothing is instantiated, no factory runs, nothing connects),
 * then every provider's injections (constructor types overridden by `@Inject` tokens, `@Inject` properties, `useFactory` inject lists,
 * `useExisting`) are resolved with Nest's lookup rule (the module's own providers, then its imports through re-exports; a global module
 * is bound to every module). An injection nothing provides is what Nest would throw at boot.
 */

/** Values a fake env key cycles through until the app's reader accepts it: placeholders of the right shape, never a credential. */
const FAKE_VALUES: ReadonlyArray<string> = [
    "http://localhost:1",
    "postgres://u:p@127.0.0.1:1/db",
    "1",
    "true",
    "development",
    "dev",
    Buffer.alloc(32, 1).toString("base64"),
    "a".repeat(64),
    "x".repeat(64),
    "localhost",
    "a@b.co",
    "info",
    "3999",
    Buffer.alloc(32, 1).toString("hex"),
    Buffer.alloc(64, 1).toString("base64"),
    "local",
    "test",
    "production",
    "s3",
    "debug",
    "0",
    "false",
    "10",
    "1000",
    "UTC",
    "Asia/Ho_Chi_Minh",
    "vi",
    "a,b",
    "[]",
    "{}",
    "redis://127.0.0.1:1",
    "https://localhost:1/x",
]

/** How many readings the fake environment may take before it gives up. */
const ENV_ROUNDS = 5000

/** What an env reader's refusal may carry: the key it names. */
interface ReaderRefusal {
    readonly params?: Readonly<Record<string, unknown>>
}

/** The parameters of a refusal, when it carries any. */
const paramsOf = (failure: unknown): Readonly<Record<string, unknown>> =>
    typeof failure === "object" && failure !== null ? ((failure as ReaderRefusal).params ?? {}) : {}

/**
 * The options an app's own env reader answers for a FAKE in-memory environment (never `process.env`): every key it touches is declared
 * with the first fake value it accepts, an optional key no fake value satisfies is left undeclared.
 */
export const fakeOptionsOf = <T>(read: (env: EnvSource) => T): T => {
    const env: Record<string, string> = {}
    const tried: Record<string, number> = {}
    const touched = new Set<string>()
    const dropped = new Set<string>()
    for (let round = 0; round < ENV_ROUNDS; round++) {
        const recent: Array<string> = []
        const source = new EnvSource({ ...env })
        const recorder = new Proxy(source, {
            get: (target, property: string | symbol): unknown => {
                const member: unknown = Reflect.get(target, property)
                if (typeof member !== "function") return member
                return (...args: Array<unknown>): unknown => {
                    const keys = Array.isArray(args[0]) ? (args[0] as Array<unknown>) : [args[0]]
                    for (const key of keys) {
                        if (typeof key === "string") {
                            recent.push(key)
                            touched.add(key)
                        }
                    }
                    return (member as (...given: Array<unknown>) => unknown).apply(target, args)
                }
            },
        })
        let options: T | null = null
        let failure: unknown = null
        try {
            options = read(recorder)
        } catch (error) {
            failure = error
        }
        if (options !== null) {
            const next = [...touched].find((key) => env[key] === undefined && !dropped.has(key))
            if (next === undefined) return options
            tried[next] = 0
            env[next] = FAKE_VALUES[0] ?? ""
            continue
        }
        const params = paramsOf(failure)
        const named = Object.values(params).find((value): value is string => typeof value === "string" && touched.has(value))
        const key = typeof params.key === "string" ? params.key : (named ?? recent.at(-1))
        if (key === undefined) throw failure
        const nextValue = (tried[key] ?? -1) + 1
        const value = FAKE_VALUES[nextValue]
        if (value === undefined) {
            if (env[key] === undefined || dropped.has(key)) throw failure
            // No fake value satisfies this optional key: it stays undeclared.
            Reflect.deleteProperty(env, key)
            dropped.add(key)
            continue
        }
        tried[key] = nextValue
        env[key] = value
    }
    throw new Error("app-composition: the env reader never accepted a fake environment")
}

/** One injection of a provider, as Nest resolves it. */
interface Injection {
    readonly token: unknown
    readonly how: string
    readonly optional: boolean
}

/** The token behind a `forwardRef`. */
const unwrap = (raw: unknown): unknown =>
    typeof raw === "object" && raw !== null && "forwardRef" in raw && typeof raw.forwardRef === "function"
        ? (raw.forwardRef as () => unknown)()
        : raw

/** A readable name of a token. */
export const tokenNameOf = (token: unknown): string => {
    if (typeof token === "function") return token.name || "<anonymous class>"
    if (typeof token === "symbol") return token.toString()
    return JSON.stringify(token)
}

/** The injections of one provider wrapper. */
const injectionsOf = (wrapper: InstanceWrapper): ReadonlyArray<Injection> => {
    if (Array.isArray(wrapper.inject)) {
        return wrapper.inject.map((item: unknown, index): Injection => {
            const optionalObject = typeof item === "object" && item !== null && "token" in item && !("forwardRef" in item)
            const raw = optionalObject ? (item as { readonly token: unknown }).token : item
            return {
                token: unwrap(raw),
                how: wrapper.isAlias ? "useExisting" : `useFactory inject[${index}]`,
                optional: optionalObject && (item as { readonly optional?: boolean }).optional === true,
            }
        })
    }
    const type = wrapper.metatype
    if (typeof type !== "function" || (wrapper.inject !== null && wrapper.inject !== undefined)) return []
    const params: Array<unknown> = [...((Reflect.getMetadata(PARAMTYPES_METADATA, type) as Array<unknown> | undefined) ?? [])]
    const declared = (Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, type) as Array<{ index: number; param: unknown }> | undefined) ?? []
    for (const { index, param } of declared) params[index] = param
    const optional = new Set((Reflect.getMetadata(OPTIONAL_DEPS_METADATA, type) as Array<number> | undefined) ?? [])
    const found: Array<Injection> = params.map((raw, index) => ({ token: unwrap(raw), how: `constructor[${index}]`, optional: optional.has(index) }))
    const optionalKeys = new Set((Reflect.getMetadata(OPTIONAL_PROPERTY_DEPS_METADATA, type) as Array<string | symbol> | undefined) ?? [])
    const properties = (Reflect.getMetadata(PROPERTY_DEPS_METADATA, type) as Array<{ key: string | symbol; type: unknown }> | undefined) ?? []
    for (const { key, type: raw } of properties) {
        found.push({ token: unwrap(raw), how: `@Inject property ${String(key)}`, optional: optionalKeys.has(key) })
    }
    return found
}

/** Nest's lookup: the module's own providers, then its imports, descending only through re-exported modules. */
const providedIn = (mod: Module, token: unknown): boolean => {
    if (mod.providers.has(token as InjectionToken)) return true
    const seen = new Set<string>()
    const walk = (at: Module, traversing: boolean): boolean => {
        const children = [...at.imports].filter((child): child is Module => child !== undefined && child !== null)
        const reachable = traversing ? children.filter((child) => at.exports.has(child.metatype)) : children
        return reachable.some((related) => {
            if (seen.has(related.id)) return false
            seen.add(related.id)
            if (related.exports.has(token as InjectionToken) && related.providers.has(token as InjectionToken)) return true
            return walk(related, true)
        })
    }
    return walk(mod, false)
}

/** What the scan of one composition found. */
export interface CompositionScan {
    /** The modules registered, by name. */
    readonly modules: ReadonlyArray<string>
    /** Every provider token of the graph. */
    readonly providers: ReadonlyArray<unknown>
    /** `<module>::<provider> <how>: <token> not provided` for every injection nothing provides. */
    readonly unresolved: ReadonlyArray<string>
}

/** Scans the module graph of a root definition, without instantiating anything. */
export const scanComposition = async (root: DynamicModule | Type): Promise<CompositionScan> => {
    const config = new ApplicationConfig()
    const container = new NestContainer(config)
    const scanner = new DependenciesScanner(container, new MetadataScanner(), new GraphInspector(container), config)
    await scanner.scan(root as Type)
    const modules = [...container.getModules().values()]
    const unresolved: Array<string> = []
    const providers: Array<unknown> = []
    for (const mod of modules) {
        for (const [token, wrapper] of mod.providers) {
            providers.push(token)
            for (const injection of injectionsOf(wrapper)) {
                if (injection.token === undefined || injection.token === Object) {
                    unresolved.push(`${mod.name}::${tokenNameOf(token)} ${injection.how}: no type`)
                    continue
                }
                if (!injection.optional && !providedIn(mod, injection.token)) {
                    unresolved.push(`${mod.name}::${tokenNameOf(token)} ${injection.how}: ${tokenNameOf(injection.token)} not provided`)
                }
            }
        }
    }
    return { modules: modules.map((mod) => mod.name), providers, unresolved }
}
