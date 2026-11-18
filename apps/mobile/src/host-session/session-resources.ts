import type { TaskAssetRenderContext } from "@openducktor/contracts";

/** The bytes of a host resource and its response headers, such as `content-type`. */
export type SessionResource = {
  bytes: Uint8Array<ArrayBuffer>;
  headers: Readonly<Record<string, string>>;
};

/** Reads the task images and the attachment previews of one session. */
export type SessionResourceReader = {
  readTaskAsset(context: TaskAssetRenderContext, signal: AbortSignal): Promise<SessionResource>;
  readStagedPreview(path: string, signal: AbortSignal): Promise<SessionResource>;
};
