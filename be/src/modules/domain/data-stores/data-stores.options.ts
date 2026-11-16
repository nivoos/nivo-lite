/** Where the protocol of one served store is read from and written to: the operator console of the app that serves it. */
export interface DataStoreConsole {
    /** Opens the input lines (stdin); called only when a verb reads them (an import). */
    readonly lines: () => AsyncIterable<string>
    /** Writes one protocol line to the output. */
    readonly print: (line: string) => void
    /** Sets the exit code of the command that served the store. */
    readonly exit: (code: number) => void
}

/** The options of the data-stores capability. */
export interface DataStoresOptions {
    /** The console `serveStdio` speaks the protocol on; an app that serves no store over the console (the api) declares none. */
    readonly console?: DataStoreConsole
}
