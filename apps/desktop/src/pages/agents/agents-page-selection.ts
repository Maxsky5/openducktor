import type { AgentModelCatalog, AgentModelSelection, AgentRole } from "@openducktor/core";
import { DEFAULT_RUNTIME_KIND } from "@/state/agent-runtime-registry";
import type { AgentSessionState } from "@/types/agent-orchestrator";

export {
  toContextStorageKey,
  toRightPanelStorageKey,
  toTabsStorageKey,
} from "./agent-studio-navigation";

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

  const catalogProfiles = catalog.profiles ?? catalog.agents ?? [];
  const primaryAgent = catalogProfiles.find((entry) => !entry.hidden && entry.mode === "primary");
  const fallbackAgent = catalogProfiles.find((entry) => !entry.hidden && entry.mode !== "subagent");
  const selectedAgent =
    primaryAgent?.id ?? primaryAgent?.name ?? fallbackAgent?.id ?? fallbackAgent?.name ?? undefined;

  return {
    runtimeKind: catalog.runtime?.kind ?? DEFAULT_RUNTIME_KIND,
    providerId: selectedModel.providerId,
    modelId: selectedModel.modelId,
    ...(selectedModel.variants[0] ? { variant: selectedModel.variants[0] } : {}),
    ...(selectedAgent ? { profileId: selectedAgent } : {}),
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
  const catalogProfiles = catalog.profiles ?? catalog.agents ?? [];
  const preserveAgentSelection = catalogProfiles.length === 0;
  const hasAgent = Boolean(
    selection.profileId &&
      (preserveAgentSelection ||
        catalogProfiles.some(
          (agent) =>
            (agent.id ?? agent.name) === selection.profileId &&
            !agent.hidden &&
            agent.mode !== "subagent",
        )),
  );

  return {
    runtimeKind: selection.runtimeKind ?? catalog.runtime?.kind ?? DEFAULT_RUNTIME_KIND,
    providerId: model.providerId,
    modelId: model.modelId,
    ...(hasVariant
      ? { variant: selection.variant }
      : model.variants[0]
        ? { variant: model.variants[0] }
        : {}),
    ...(hasAgent ? { profileId: selection.profileId } : {}),
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
    a.runtimeKind === b.runtimeKind &&
    (a.variant ?? "") === (b.variant ?? "") &&
    (a.profileId ?? "") === (b.profileId ?? "")
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

export const resolveAgentStudioBuilderSessionsForTask = ({
  taskId,
  viewActiveSession,
  activeSession,
  selectedSessionById,
  viewSessionsForTask,
  sessionsForTask,
}: {
  taskId: string;
  viewActiveSession: AgentSessionState | null;
  activeSession: AgentSessionState | null;
  selectedSessionById: AgentSessionState | null;
  viewSessionsForTask: AgentSessionState[];
  sessionsForTask: AgentSessionState[];
}): AgentSessionState[] => {
  if (!taskId) {
    return [];
  }

  const seenSessionIds = new Set<string>();
  const candidates = [
    viewActiveSession,
    activeSession,
    selectedSessionById,
    ...viewSessionsForTask,
    ...sessionsForTask,
  ];
  const sessions: AgentSessionState[] = [];

  for (const session of candidates) {
    if (!session || session.role !== "build" || session.taskId !== taskId) {
      continue;
    }
    if (seenSessionIds.has(session.sessionId)) {
      continue;
    }
    seenSessionIds.add(session.sessionId);
    sessions.push(session);
  }

  return sessions;
};

export const resolveAgentStudioBuilderSessionForTask = ({
  taskId,
  viewActiveSession,
  activeSession,
  selectedSessionById,
  viewSessionsForTask,
  sessionsForTask,
}: {
  taskId: string;
  viewActiveSession: AgentSessionState | null;
  activeSession: AgentSessionState | null;
  selectedSessionById: AgentSessionState | null;
  viewSessionsForTask: AgentSessionState[];
  sessionsForTask: AgentSessionState[];
}): AgentSessionState | null => {
  return (
    resolveAgentStudioBuilderSessionsForTask({
      taskId,
      viewActiveSession,
      activeSession,
      selectedSessionById,
      viewSessionsForTask,
      sessionsForTask,
    })[0] ?? null
  );
};
