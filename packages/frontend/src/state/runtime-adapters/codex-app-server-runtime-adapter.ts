import type {
  CodexJsonRpcRequest,
  CodexJsonRpcTransportFactory,
  CodexPolicyLogEntry,
} from "@openducktor/adapters-codex-app-server";
import { CodexAppServerAdapter } from "@openducktor/adapters-codex-app-server";
import { host } from "../operations/shared/host";
import type { AgentRuntimeAdapter } from "./agent-runtime-adapter";
import { hostRepoRuntimeResolver } from "./host-repo-runtime-resolver";

const createCodexHostTransportFactory = (): CodexJsonRpcTransportFactory => {
  return (runtimeId) => ({
    request: async <Response = unknown>(request: CodexJsonRpcRequest) =>
      host.codexAppServerRequest(runtimeId, request.method, request.params) as Promise<Response>,
  });
};

const logCodexSessionPolicy = (entry: CodexPolicyLogEntry): void => {
  console.info("[OpenDucktor] Codex session policy", entry);
};

export const createCodexAppServerRuntimeAdapter = (): AgentRuntimeAdapter =>
  new CodexAppServerAdapter({
    repoRuntimeResolver: hostRepoRuntimeResolver,
    transportFactory: createCodexHostTransportFactory(),
    logSessionPolicy: logCodexSessionPolicy,
  });
