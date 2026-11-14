/**
 * The trusted prelude: JavaScript text evaluated inside QuickJS BEFORE the stored source. It
 *  - captures the two host functions in its closure and removes them from the global object, so the source can reach the outside only through `tool` and `say`;
 *  - defines `input`, `facts` and the `ctx` object handed to `run`, and the capabilities the run was given (`config.capabilities`): `tool` gives `tool` and
 *    `say` (a node); a run given none (a trigger's `translate`) has no way out. The next phase adds names here (`http`, `hmac` for a provider);
 *  - replaces `Date.now` and an argument-less `new Date()` with the recorded `facts.at`, and `Math.random` with a PRNG seeded from `facts.randomSeed`;
 *  - removes `eval` and every way to compile text (the Function constructors) and freezes `JSON`, `Math` and `Reflect`; the wrapper keeps its
 *    own references to what it uses. Other prototypes stay writable on purpose (freezing breaks ordinary code); every run has a fresh WebAssembly
 *    module, so a polluted prototype never reaches another run;
 *  - defines `__cell_invoke`, which calls the entry function and answers ONE string: `D<json>` done, `E<why>` ended (`ctx.cannot`), `F<detail>` the
 *    output is not acceptable (a promise, a value that is not JSON, or more bytes than the limit).
 * The host reads nothing else from the guest. The prelude is text only: it reads no file and no clock of the host.
 */
export const PRELUDE = String.raw`
(function (global) {
    "use strict";
    const hostCall = global.__host_call;
    const hostSay = global.__host_say;
    delete global.__host_call;
    delete global.__host_say;
    const stringify = JSON.stringify;
    const parse = JSON.parse;
    const defineProperty = Object.defineProperty;
    const freeze = Object.freeze;
    const RealDate = Date;

    function install(configText) {
        const config = parse(configText);
        const facts = config.facts;
        const fixed = RealDate.parse(facts.at);

        class RecordedDate extends RealDate {
            constructor(...args) {
                if (args.length === 0) super(fixed);
                else super(...args);
            }
            static now() { return fixed; }
        }
        defineProperty(global, "Date", { value: RecordedDate, writable: true, configurable: true });

        const mix = (function (text) {
            let h = 1779033703 ^ text.length;
            for (let i = 0; i < text.length; i++) {
                h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
                h = (h << 13) | (h >>> 19);
            }
            return function () {
                h = Math.imul(h ^ (h >>> 16), 2246822507);
                h = Math.imul(h ^ (h >>> 13), 3266489909);
                return (h ^= h >>> 16) >>> 0;
            };
        })(String(facts.randomSeed));
        let a = mix(), b = mix(), c = mix(), d = mix();
        const random = function () {
            a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
            let t = (a + b) | 0;
            a = b ^ (b >>> 9);
            b = (c + (c << 3)) | 0;
            c = (c << 21) | (c >>> 11);
            d = (d + 1) | 0;
            t = (t + d) | 0;
            c = (c + t) | 0;
            return (t >>> 0) / 4294967296;
        };
        defineProperty(Math, "random", { value: random, writable: false, configurable: false });

        let cannotMarker = null;
        let cannotWhy = "";
        const callTool = function (name, args) {
            if (typeof name !== "string") throw new TypeError("tool: the name must be a string");
            const text = stringify(args === undefined ? null : args);
            if (text === undefined) throw new TypeError("tool: the arguments must be JSON");
            return parse(hostCall(name, text));
        };
        const say = function (prompt, data) {
            const text = stringify({ prompt: prompt === undefined ? null : prompt, data: data === undefined ? null : data });
            return parse(hostSay(text));
        };
        const cannot = function (why) {
            cannotWhy = String(why);
            cannotMarker = freeze({ cannot: cannotWhy });
            return cannotMarker;
        };
        const granted = config.capabilities.includes("tool");
        const ctx = freeze(granted ? { tool: callTool, say: say, cannot: cannot, facts: facts } : { cannot: cannot, facts: facts });
        if (granted) {
            defineProperty(global, "tool", { value: callTool, writable: false, configurable: false });
            defineProperty(global, "say", { value: say, writable: false, configurable: false });
        }
        defineProperty(global, "input", { value: config.input, writable: false, configurable: false });
        defineProperty(global, "facts", { value: facts, writable: false, configurable: false });

        delete global.eval;
        const noCompile = function () { throw new EvalError("compiling text is not available"); };
        noCompile.prototype = Function.prototype;
        const samples = [function () {}, async function () {}, function* () {}, async function* () {}];
        for (const sample of samples) {
            defineProperty(Object.getPrototypeOf(sample), "constructor", { value: noCompile, writable: false, configurable: false });
        }
        defineProperty(global, "Function", { value: noCompile, writable: false, configurable: false });

        for (const name of ["JSON", "Math", "Reflect"]) freeze(global[name]);

        const limit = config.outputBytes;
        defineProperty(global, "__cell_invoke", {
            configurable: false,
            writable: false,
            value: function (entry) {
                const fn = global[entry];
                if (typeof fn !== "function") return "Fthe source does not define the function " + entry;
                const result = entry === "run" ? fn(config.input, ctx) : fn(config.input);
                if (cannotMarker !== null && result === cannotMarker) return "E" + cannotWhy;
                if (result !== null && result !== undefined && typeof result.then === "function") {
                    return "Fa source must return its value, not a promise";
                }
                let text;
                try {
                    text = stringify(result === undefined ? null : result);
                } catch (error) {
                    return "Fthe output is not JSON";
                }
                if (text === undefined) return "Fthe output is not JSON";
                if (text.length > limit) return "Fthe output is longer than " + limit + " characters";
                return "D" + text;
            },
        });
    }
    defineProperty(global, "__cell_install", { value: install, configurable: true });
})(globalThis);
`
