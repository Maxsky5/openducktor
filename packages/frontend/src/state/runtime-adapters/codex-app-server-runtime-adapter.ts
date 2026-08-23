import type {
  CodexJsonRpcRequest,
  CodexJsonRpcTransportFactory,
  CodexPolicyLogEntry,
} from "@openducktor/adapters-codex-app-server";
import { CodexAppServerAdapter } from "@openducktor/adapters-codex-app-server";
import type { LoadAgentSessionDiffInput } from "@openducktor/core";
import { host } from "../operations/shared/host";
import type { AgentRuntimeAdapter } from "./agent-runtime-adapter";
import { hostRepoRuntimeResolver } from "./host-repo-runtime-resolver";

const createCodexHostTransportFactory = (): CodexJsonRpcTransportFactory => {
  return (runtimeId) => ({
    request: (request: CodexJsonRpcRequest) => host.codexAppServerRequest(runtimeId, request),
  });
};

const logCodexSessionPolicy = (entry: CodexPolicyLogEntry): void => {
  console.info("[OpenDucktor] Codex session policy", entry);
};

class CodexHostRuntimeAdapter extends CodexAppServerAdapter {
  override loadSessionDiff(input: LoadAgentSessionDiffInput) {
    return host.agentSessionLiveLoadDiff(input);
  }
}

export const createCodexAppServerRuntimeAdapter = (): AgentRuntimeAdapter =>
  new CodexHostRuntimeAdapter({
    repoRuntimeResolver: hostRepoRuntimeResolver,
    transportFactory: createCodexHostTransportFactory(),
    logSessionPolicy: logCodexSessionPolicy,
  });
