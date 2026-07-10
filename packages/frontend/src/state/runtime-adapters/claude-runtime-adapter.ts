import { CLAUDE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentRuntimeDefinition } from "@openducktor/core";
import type { HostClient } from "@openducktor/host-client";
import { host } from "../operations/shared/host";
import type { AgentRuntimeAdapter } from "./agent-runtime-adapter";

type ClaudeRuntimeAdapterDependencies = {
  hostClient?: HostClient;
};

export const createClaudeRuntimeAdapter = ({
  hostClient = host,
}: ClaudeRuntimeAdapterDependencies = {}): AgentRuntimeAdapter => ({
  getRuntimeDefinition(): AgentRuntimeDefinition {
    return CLAUDE_RUNTIME_DESCRIPTOR;
  },
  listAvailableModels: (input) => hostClient.claudeRuntimeListModels(input),
  listAvailableSlashCommands: (input) => hostClient.claudeRuntimeListSlashCommands(input),
  listAvailableSkills: (input) => hostClient.claudeRuntimeListSkills(input),
  listAvailableSubagents: (input) => hostClient.claudeRuntimeListSubagents(input),
  searchFiles: (input) => hostClient.claudeRuntimeSearchFiles(input),
  loadSessionHistory: (input) => hostClient.claudeRuntimeLoadSessionHistory(input),
  loadSessionTodos: (input) => hostClient.claudeRuntimeLoadSessionTodos(input),
  loadSessionDiff: (input) => hostClient.claudeRuntimeLoadSessionDiff(input),
  loadFileStatus: (input) => hostClient.claudeRuntimeFileStatus(input),
});
