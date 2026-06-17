import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import type { AgentRuntimeAdapter } from "./agent-runtime-adapter";
import { hostRepoRuntimeResolver } from "./host-repo-runtime-resolver";

export const createOpenCodeRuntimeAdapter = (): AgentRuntimeAdapter =>
  new OpencodeSdkAdapter({
    repoRuntimeResolver: hostRepoRuntimeResolver,
  });
