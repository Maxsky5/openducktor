import type {
  AgentCatalogPort,
  AgentRuntimeDefinition,
  AgentSessionHistoryPort,
  AgentWorkspaceInspectionPort,
} from "@openducktor/core";

export type AgentRuntimeAdapter = AgentCatalogPort &
  AgentSessionHistoryPort &
  AgentWorkspaceInspectionPort & {
    getRuntimeDefinition(): AgentRuntimeDefinition;
  };
