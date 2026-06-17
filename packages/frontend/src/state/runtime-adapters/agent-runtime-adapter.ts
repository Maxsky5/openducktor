import type {
  AgentCatalogPort,
  AgentRuntimeDefinition,
  AgentSessionPort,
  AgentWorkspaceInspectionPort,
} from "@openducktor/core";

export type AgentRuntimeAdapter = AgentCatalogPort &
  AgentSessionPort &
  AgentWorkspaceInspectionPort & {
    getRuntimeDefinition(): AgentRuntimeDefinition;
  };
