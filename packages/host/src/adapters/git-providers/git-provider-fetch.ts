/** The fetch that REST provider adapters use. Electron passes `net.fetch`, which uses the OS trust store. */
export type GitProviderFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
