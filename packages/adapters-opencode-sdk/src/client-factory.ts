import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { ClientFactory } from "./types";

export const nowIso = (): string => new Date().toISOString();

export const buildDefaultFactory = (): ClientFactory => {
  return (input) => {
    const clientInput: Parameters<typeof createOpencodeClient>[0] = {
      baseUrl: input.runtimeEndpoint,
    };
    if (input.workingDirectory) {
      clientInput.directory = input.workingDirectory;
    }
    return createOpencodeClient(clientInput);
  };
};
