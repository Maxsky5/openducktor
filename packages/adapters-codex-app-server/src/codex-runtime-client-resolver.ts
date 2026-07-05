import {
  type ForkAgentSessionInput,
  type ListAgentModelsInput,
  type ListSessionRuntimeSnapshotsInput,
  type LoadAgentSessionDiffInput,
  type LoadAgentSessionHistoryInput,
  type LoadAgentSessionTodosInput,
  type PolicyBoundSessionRef,
  type ReadSessionRuntimeSnapshotInput,
  type ResumeAgentSessionInput,
  requireRepoRuntimeRef,
  type SearchAgentFilesInput,
  type StartAgentSessionInput,
} from "@openducktor/core";
import { createCodexAppServerClient } from "./app-server-client";
import { resolveCodexRuntimeClientInput } from "./runtime-connection";
import type { CodexAppServerAdapterOptions, CodexAppServerClient } from "./types";

type RuntimeClientInput =
  | ListAgentModelsInput
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

type CodexRepoRuntimeRef = { repoPath: string; runtimeKind: "codex" };

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
    const resolver = this.options.repoRuntimeResolver;
    if (!resolver) {
      throw new Error(
        `Repo runtime resolver is required to ${action} for repo '${input.repoPath}' and runtime 'codex'.`,
      );
    }

    const requestedRuntimeRef = requireRepoRuntimeRef(input, action);
    if (requestedRuntimeRef.runtimeKind !== "codex") {
      throw new Error(`Codex App Server can only ${action} for runtime 'codex'.`);
    }
    const runtimeRef: CodexRepoRuntimeRef = {
      repoPath: requestedRuntimeRef.repoPath,
      runtimeKind: requestedRuntimeRef.runtimeKind,
    };
    const runtime = await resolver.requireRepoRuntime(runtimeRef);

    const { runtimeId } = resolveCodexRuntimeClientInput(
      runtime,
      {
        repoPath: runtimeRef.repoPath,
        runtimeKind: runtimeRef.runtimeKind,
        ...("workingDirectory" in input ? { workingDirectory: input.workingDirectory } : {}),
      },
      action,
    );

    return {
      runtimeId,
      client: this.clientForRuntime(runtimeId),
    };
  }
}
