import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { ClientFactory } from "./types";

export const nowIso = (): string => new Date().toISOString();

export const buildDefaultFactory = (): ClientFactory => {
  return (input) =>
    createOpencodeClient({
      baseUrl: input.baseUrl,
      directory: input.workingDirectory,
    });
};
