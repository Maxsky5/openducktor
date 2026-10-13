export type ResourceData = { kind: "blob"; blob: Blob } | { kind: "url"; src: string };
export type ResourceRead = (signal: AbortSignal) => Promise<ResourceData>;
