import type {
  AttachAgentSessionInput,
  ForkAgentSessionInput,
  ListAgentModelsInput,
  ListLiveAgentSessionsInput,
  ListSessionPresenceInput,
  LoadAgentSessionDiffInput,
  LoadAgentSessionHistoryInput,
  LoadAgentSessionTodosInput,
  ReadSessionPresenceInput,
  ResumeAgentSessionInput,
  StartAgentSessionInput,
} from "@openducktor/core";
import { createCodexAppServerClient } from "./app-server-client";
import { resolveCodexRuntimeClientInput } from "./runtime-connection";
import type {
  CodexAppServerAdapterOptions,
  CodexAppServerClient,
  CodexRepoRuntimeResolverPort,
} from "./types";

type RuntimeClientInput =
  | ListAgentModelsInput
  | StartAgentSessionInput
  | ResumeAgentSessionInput
  | AttachAgentSessionInput
  | ForkAgentSessionInput
  | ListLiveAgentSessionsInput
  | ListSessionPresenceInput
  | ReadSessionPresenceInput
  | LoadAgentSessionHistoryInput
  | LoadAgentSessionDiffInput
  | LoadAgentSessionTodosInput;

type RuntimeRef = { repoPath: string; runtimeKind: "codex" };

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
    options: { requireLive?: boolean } = {},
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

    const runtimeRef: RuntimeRef = { repoPath: input.repoPath, runtimeKind: "codex" };
    const requestedRuntimeId = "runtimeId" in input ? input.runtimeId : undefined;
    const runtime = requestedRuntimeId
      ? await this.requireRuntimeById(resolver, runtimeRef, requestedRuntimeId)
      : options.requireLive
        ? await resolver.requireRepoRuntime(runtimeRef)
        : await resolver.ensureRepoRuntime(runtimeRef);

    const { runtimeId } = resolveCodexRuntimeClientInput(
      runtime,
      {
        repoPath: input.repoPath,
        runtimeKind: "codex",
        ...("workingDirectory" in input ? { workingDirectory: input.workingDirectory } : {}),
      },
      action,
    );

    return {
      runtimeId,
      client: this.clientForRuntime(runtimeId),
    };
  }

  private async requireRuntimeById(
    resolver: CodexRepoRuntimeResolverPort,
    runtimeRef: RuntimeRef,
    runtimeId: string,
  ) {
    if (resolver.requireRuntimeById) {
      return resolver.requireRuntimeById(runtimeRef, runtimeId);
    }
    const runtime = await resolver.requireRepoRuntime(runtimeRef);
    if (runtime.runtimeId !== runtimeId) {
      throw new Error(
        `No live Codex runtime found for repo '${runtimeRef.repoPath}' with runtime id '${runtimeId}'.`,
      );
    }
    return runtime;
  }
}
