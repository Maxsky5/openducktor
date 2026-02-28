import type { AgentModelCatalog, AgentModelSelection, AgentRole } from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";

const AGENT_STUDIO_CONTEXT_STORAGE_PREFIX = "openducktor:agent-studio:context";
const AGENT_STUDIO_TABS_STORAGE_PREFIX = "openducktor:agent-studio:tabs";
const ISO_TIMESTAMP_PATTERN = /\d{4}-\d{2}-\d{2}T[0-9:.+-]+(?:Z|[+-]\d{2}:\d{2})/;

export const parseTimestamp = (value: string | null | undefined): number | null => {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
};

export const extractCompletionTimestamp = (
  value: string | undefined,
): { raw: string; timestamp: number } | null => {
  if (!value) {
    return null;
  }
  const match = value.match(ISO_TIMESTAMP_PATTERN);
  if (!match?.[0]) {
    return null;
  }
  const timestamp = parseTimestamp(match[0]);
  if (timestamp === null) {
    return null;
  }
  return {
    raw: match[0],
    timestamp,
  };
};

export const toContextStorageKey = (repoPath: string): string =>
  `${AGENT_STUDIO_CONTEXT_STORAGE_PREFIX}:${repoPath}`;

export const toTabsStorageKey = (repoPath: string): string =>
  `${AGENT_STUDIO_TABS_STORAGE_PREFIX}:${repoPath}`;

export const emptyDraftSelections = (): Record<AgentRole, AgentModelSelection | null> => ({
  spec: null,
  planner: null,
  build: null,
  qa: null,
});

export const pickDefaultSelectionForCatalog = (
  catalog: AgentModelCatalog | null,
): AgentModelSelection | null => {
  if (!catalog || catalog.models.length === 0) {
    return null;
  }
  const defaultProvider = Object.entries(catalog.defaultModelsByProvider).find(([, modelId]) =>
    catalog.models.some((entry) => entry.modelId === modelId),
  );
  const selectedModel = defaultProvider
    ? (catalog.models.find(
        (entry) => entry.providerId === defaultProvider[0] && entry.modelId === defaultProvider[1],
      ) ?? catalog.models[0])
    : catalog.models[0];
  if (!selectedModel) {
    return null;
  }

  const primaryAgent = catalog.agents.find((entry) => !entry.hidden && entry.mode === "primary");
  const fallbackAgent = catalog.agents.find((entry) => !entry.hidden && entry.mode !== "subagent");
  const selectedAgent = primaryAgent?.name ?? fallbackAgent?.name ?? undefined;

  return {
    providerId: selectedModel.providerId,
    modelId: selectedModel.modelId,
    ...(selectedModel.variants[0] ? { variant: selectedModel.variants[0] } : {}),
    ...(selectedAgent ? { opencodeAgent: selectedAgent } : {}),
  };
};

export const normalizeSelectionForCatalog = (
  catalog: AgentModelCatalog | null,
  selection: AgentModelSelection | null,
): AgentModelSelection | null => {
  if (!catalog || !selection) {
    return selection;
  }
  const model = catalog.models.find(
    (entry) => entry.providerId === selection.providerId && entry.modelId === selection.modelId,
  );
  if (!model) {
    return null;
  }

  const hasVariant = Boolean(selection.variant && model.variants.includes(selection.variant));
  const hasAgent = Boolean(
    selection.opencodeAgent &&
      catalog.agents.some(
        (agent) =>
          agent.name === selection.opencodeAgent && !agent.hidden && agent.mode !== "subagent",
      ),
  );

  return {
    providerId: model.providerId,
    modelId: model.modelId,
    ...(hasVariant
      ? { variant: selection.variant }
      : model.variants[0]
        ? { variant: model.variants[0] }
        : {}),
    ...(hasAgent ? { opencodeAgent: selection.opencodeAgent } : {}),
  };
};

export const isSameSelection = (
  a: AgentModelSelection | null | undefined,
  b: AgentModelSelection | null | undefined,
): boolean => {
  if (!a && !b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return (
    a.providerId === b.providerId &&
    a.modelId === b.modelId &&
    (a.variant ?? "") === (b.variant ?? "") &&
    (a.opencodeAgent ?? "") === (b.opencodeAgent ?? "")
  );
};

export const resolveAgentStudioTaskId = ({
  taskIdParam,
  selectedSessionById,
}: {
  taskIdParam: string;
  selectedSessionById: AgentSessionState | null;
}): string => {
  return taskIdParam || selectedSessionById?.taskId || "";
};

export const resolveAgentStudioActiveSession = ({
  sessionsForTask,
  sessionParam,
  hasExplicitRoleParam,
  roleFromQuery,
}: {
  sessionsForTask: AgentSessionState[];
  sessionParam: string | null;
  hasExplicitRoleParam: boolean;
  roleFromQuery: AgentRole;
}): AgentSessionState | null => {
  if (sessionParam) {
    return sessionsForTask.find((entry) => entry.sessionId === sessionParam) ?? null;
  }
  if (hasExplicitRoleParam) {
    return sessionsForTask.find((entry) => entry.role === roleFromQuery) ?? null;
  }
  return sessionsForTask[0] ?? null;
};
