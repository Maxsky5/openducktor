import type {
  CodexJsonRpcRequest,
  CodexJsonRpcTransportFactory,
  CodexPolicyLogEntry,
} from "@openducktor/adapters-codex-app-server";
import { CodexAppServerAdapter } from "@openducktor/adapters-codex-app-server";
import type { LoadAgentSessionDiffInput } from "@openducktor/core";
import type { HostClient } from "@openducktor/host-client";
import { host } from "../operations/shared/host";
import type { AgentRuntimeAdapter } from "./agent-runtime-adapter";
import { createHostRepoRuntimeResolver } from "./host-repo-runtime-resolver";

type CodexRuntimeAdapterHost = Pick<
  HostClient,
  "agentSessionLiveLoadDiff" | "codexAppServerRequest" | "runtimeRequire"
>;

type CodexRuntimeAdapterDependencies = {
  hostClient?: CodexRuntimeAdapterHost;
};

const createCodexHostTransportFactory = (
  hostClient: CodexRuntimeAdapterHost,
): CodexJsonRpcTransportFactory => {
  return (runtimeId) => ({
    request: (request: CodexJsonRpcRequest) => hostClient.codexAppServerRequest(runtimeId, request),
  });
};

const logCodexSessionPolicy = (entry: CodexPolicyLogEntry): void => {
  console.info("[OpenDucktor] Codex session policy", entry);
};

class CodexHostRuntimeAdapter extends CodexAppServerAdapter {
  constructor(
    options: ConstructorParameters<typeof CodexAppServerAdapter>[0],
    private readonly loadDiff: CodexRuntimeAdapterHost["agentSessionLiveLoadDiff"],
  ) {
    super(options);
  }

  override loadSessionDiff(input: LoadAgentSessionDiffInput) {
    return this.loadDiff(input);
  }
}

export const createCodexAppServerRuntimeAdapter = ({
  hostClient = host,
}: CodexRuntimeAdapterDependencies = {}): AgentRuntimeAdapter =>
  new CodexHostRuntimeAdapter(
    {
      repoRuntimeResolver: createHostRepoRuntimeResolver(hostClient),
      transportFactory: createCodexHostTransportFactory(hostClient),
      logSessionPolicy: logCodexSessionPolicy,
    },
    (input) => hostClient.agentSessionLiveLoadDiff(input),
  );
