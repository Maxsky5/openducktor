import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import type { HostClient } from "@openducktor/host-client";
import { host } from "../operations/shared/host";
import type { AgentRuntimeAdapter } from "./agent-runtime-adapter";
import { createHostRepoRuntimeResolver } from "./host-repo-runtime-resolver";

type OpenCodeRuntimeAdapterDependencies = {
  hostClient?: Pick<HostClient, "runtimeRequire">;
};

export const createOpenCodeRuntimeAdapter = ({
  hostClient = host,
}: OpenCodeRuntimeAdapterDependencies = {}): AgentRuntimeAdapter =>
  new OpencodeSdkAdapter({
    repoRuntimeResolver: createHostRepoRuntimeResolver(hostClient),
  });
