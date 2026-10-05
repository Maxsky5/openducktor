import {
  type ForkAgentSessionInput,
  type LoadAgentRuntimeCatalogInput,
  type ListSessionRuntimeSnapshotsInput,
  type LoadAgentSessionDiffInput,
  type LoadAgentSessionHistoryInput,
  type LoadAgentSessionTodosInput,
  type PolicyBoundSessionRef,
  type ReadSessionRuntimeSnapshotInput,
  type ResumeAgentSessionInput,
  requireSessionWorkingDirectory,
  type SearchAgentFilesInput,
  type StartAgentSessionInput,
} from "@openducktor/core";
import { createCodexAppServerClient } from "./app-server-client";
import { resolveCodexRuntimeClientInput } from "./runtime-connection";
import type { CodexAppServerAdapterOptions, CodexAppServerClient } from "./types";

type RuntimeClientInput =
  | LoadAgentRuntimeCatalogInput
  | StartAgentSessionInput
  | ResumeAgentSessionInput
  | PolicyBoundSessionRef
  | ForkAgentSessionInput
  | ListSessionRuntimeSnapshotsInput
  | ReadSessionRuntimeSnapshotInput
  | LoadAgentSessionHistoryInput
  | LoadAgentSessionDiffInput
  | LoadAgentSessionTodosInput
  | SearchAgentFilesInput;

export class CodexRuntimeClientResolver {
  private readonly clientsByRuntimeId = new Map<string, CodexAppServerClient>();

  constructor(private readonly options: CodexAppServerAdapterOptions) {}

  clientForRuntime(runtimeId: string): CodexAppServerClient {
    const existing = this.clientsByRuntimeId.get(runtimeId);
    if (existing) {
      return existing;
    }

    const client = createCodexAppServerClient(this.options.transportFactory(runtimeId));
    this.clientsByRuntimeId.set(runtimeId, client);
    return client;
  }

  async resolve(
    input: RuntimeClientInput,
    action: string,
  ): Promise<{
    runtimeId: string;
    client: CodexAppServerClient;
  }> {
    if ("workingDirectory" in input) {
      requireSessionWorkingDirectory(input.workingDirectory, action);
    }

    const { runtimeId } = resolveCodexRuntimeClientInput(this.options.runtime, input, action);
    return {
      runtimeId,
      client: this.clientForRuntime(runtimeId),
    };
  }
}
