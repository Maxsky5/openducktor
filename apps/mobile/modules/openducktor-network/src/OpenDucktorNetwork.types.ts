/** The response head. Native code lowercases header names and joins repeated values with ", ". */
export type NativeHttpHead = { status: number; headers: Record<string, string> };

/** The `code` of each native rejection. The `message` holds the platform text. */
export type NativeNetworkErrorCode =
  | "ERR_ODT_NETWORK"
  | "ERR_ODT_TIMEOUT"
  | "ERR_ODT_TLS"
  | "ERR_ODT_LOCAL_NETWORK_DENIED"
  | "ERR_ODT_CANCELED";

export interface OpenDucktorNetworkModule {
  /** Sends the request and resolves when the response head arrives. Redirect responses resolve as they are. */
  start(
    requestId: string,
    method: "GET" | "POST" | "DELETE",
    url: string,
    headers: Record<string, string>,
    body: string | null,
  ): Promise<NativeHttpHead>;
  /** Resolves the next body chunk, or `null` at the end of the body. */
  read(requestId: string): Promise<Uint8Array | null>;
  /** Releases the native request. Pending `start` and `read` calls reject with `ERR_ODT_CANCELED`. */
  cancel(requestId: string): void;
}
