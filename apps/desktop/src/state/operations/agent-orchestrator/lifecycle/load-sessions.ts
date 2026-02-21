import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import type { TaskCard } from "@openducktor/contracts";
import { buildAgentSystemPrompt } from "@openducktor/core";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { host } from "../../host";
import {
  fromPersistedSessionRecord,
  historyToChatMessages,
  normalizePersistedSelection,
  toBaseUrl,
} from "../support/utils";

type UpdateSession = (
  sessionId: string,
  updater: (current: AgentSessionState) => AgentSessionState,
  options?: { persist?: boolean },
) => void;

type SessionHistoryAdapter = Pick<OpencodeSdkAdapter, "loadSessionHistory">;

type CreateLoadAgentSessionsArgs = {
  activeRepo: string | null;
  adapter: SessionHistoryAdapter;
  repoEpochRef: MutableRefObject<number>;
  previousRepoRef: MutableRefObject<string | null>;
  sessionsRef: MutableRefObject<Record<string, AgentSessionState>>;
  setSessionsById: Dispatch<SetStateAction<Record<string, AgentSessionState>>>;
  taskRef: MutableRefObject<TaskCard[]>;
  updateSession: UpdateSession;
  loadSessionTodos: (
    sessionId: string,
    baseUrl: string,
    workingDirectory: string,
    externalSessionId: string,
  ) => Promise<void>;
  loadSessionModelCatalog: (
    sessionId: string,
    baseUrl: string,
    workingDirectory: string,
  ) => Promise<void>;
};

export const createLoadAgentSessions = ({
  activeRepo,
  adapter,
  repoEpochRef,
  previousRepoRef,
  sessionsRef,
  setSessionsById,
  taskRef,
  updateSession,
  loadSessionTodos,
  loadSessionModelCatalog,
}: CreateLoadAgentSessionsArgs): ((taskId: string) => Promise<void>) => {
  return async (taskId: string): Promise<void> => {
    if (!activeRepo || taskId.trim().length === 0) {
      return;
    }

    const repoPath = activeRepo;
    const repoEpochAtStart = repoEpochRef.current;
    const isStaleRepoOperation = (): boolean =>
      repoEpochRef.current !== repoEpochAtStart || previousRepoRef.current !== repoPath;
    if (isStaleRepoOperation()) {
      return;
    }

    const persisted = await host.agentSessionsList(repoPath, taskId);
    if (isStaleRepoOperation()) {
      return;
    }
    const existingIds = new Set(Object.keys(sessionsRef.current));
    const recordsToHydrate = persisted.filter((record) => !existingIds.has(record.sessionId));
    setSessionsById((current) => {
      if (isStaleRepoOperation()) {
        return current;
      }
      const next = { ...current };
      for (const record of persisted) {
        if (next[record.sessionId]) {
          continue;
        }
        next[record.sessionId] = fromPersistedSessionRecord(record);
      }
      sessionsRef.current = next;
      return next;
    });

    if (isStaleRepoOperation()) {
      return;
    }

    if (recordsToHydrate.length === 0) {
      const existingSessions = Object.values(sessionsRef.current).filter(
        (entry) => entry.taskId === taskId && !entry.modelCatalog && !entry.isLoadingModelCatalog,
      );
      for (const session of existingSessions) {
        if (!session.baseUrl || !session.workingDirectory) {
          continue;
        }
        void loadSessionTodos(
          session.sessionId,
          session.baseUrl,
          session.workingDirectory,
          session.externalSessionId,
        ).catch(() => undefined);
        void loadSessionModelCatalog(
          session.sessionId,
          session.baseUrl,
          session.workingDirectory,
        ).catch(() => undefined);
      }
      return;
    }

    const requiresWorkspaceRuntime = recordsToHydrate.some(
      (record) => record.role === "spec" || record.role === "planner",
    );
    const workspaceRuntime = requiresWorkspaceRuntime
      ? await host.opencodeRepoRuntimeEnsure(repoPath).catch(() => null)
      : null;
    if (isStaleRepoOperation()) {
      return;
    }

    await Promise.all(
      recordsToHydrate.map(async (record) => {
        if (isStaleRepoOperation()) {
          return;
        }
        const baseUrl =
          (record.role === "spec" || record.role === "planner") && workspaceRuntime
            ? toBaseUrl(workspaceRuntime.port)
            : record.baseUrl;
        const workingDirectory =
          (record.role === "spec" || record.role === "planner") && workspaceRuntime
            ? workspaceRuntime.workingDirectory
            : record.workingDirectory;
        const existingSession = sessionsRef.current[record.sessionId];
        if (existingSession && existingSession.messages.length > 0) {
          if (isStaleRepoOperation()) {
            return;
          }
          updateSession(
            record.sessionId,
            (current) => ({
              ...current,
              baseUrl,
              workingDirectory,
            }),
            { persist: false },
          );
          void loadSessionTodos(
            record.sessionId,
            baseUrl,
            workingDirectory,
            record.externalSessionId,
          ).catch(() => undefined);
          void loadSessionModelCatalog(record.sessionId, baseUrl, workingDirectory).catch(
            () => undefined,
          );
          return;
        }

        const task = taskRef.current.find((entry) => entry.id === record.taskId);
        let preludeMessages: AgentSessionState["messages"] = [
          {
            id: `history:session-start:${record.sessionId}`,
            role: "system",
            content: `Session started (${record.role} - ${record.scenario})`,
            timestamp: record.startedAt,
          },
        ];

        if (task) {
          const docs = await Promise.all([
            host
              .specGet(repoPath, record.taskId)
              .then((doc) => doc.markdown)
              .catch(() => ""),
            host
              .planGet(repoPath, record.taskId)
              .then((doc) => doc.markdown)
              .catch(() => ""),
            host
              .qaGetReport(repoPath, record.taskId)
              .then((doc) => doc.markdown)
              .catch(() => ""),
          ]).catch(() => null);
          if (docs) {
            const [specMarkdown, planMarkdown, qaMarkdown] = docs;
            if (isStaleRepoOperation()) {
              return;
            }
            const systemPrompt = buildAgentSystemPrompt({
              role: record.role,
              scenario: record.scenario,
              task: {
                taskId: task.id,
                title: task.title,
                issueType: task.issueType,
                status: task.status,
                qaRequired: task.aiReviewEnabled,
                description: task.description,
                acceptanceCriteria: task.acceptanceCriteria,
                specMarkdown,
                planMarkdown,
                latestQaReportMarkdown: qaMarkdown,
              },
            });
            preludeMessages = [
              ...preludeMessages,
              {
                id: `history:system-prompt:${record.sessionId}`,
                role: "system",
                content: `System prompt:\n\n${systemPrompt}`,
                timestamp: record.startedAt,
              },
            ];
          }
        }

        try {
          const history = await adapter.loadSessionHistory({
            baseUrl,
            workingDirectory,
            externalSessionId: record.externalSessionId,
            limit: 2000,
          });
          if (isStaleRepoOperation()) {
            return;
          }
          updateSession(
            record.sessionId,
            (current) => ({
              ...current,
              baseUrl,
              workingDirectory,
              messages: [
                ...preludeMessages,
                ...historyToChatMessages(history, {
                  role: record.role,
                  selectedModel: normalizePersistedSelection(record.selectedModel),
                }),
              ],
            }),
            { persist: false },
          );
          void loadSessionTodos(
            record.sessionId,
            baseUrl,
            workingDirectory,
            record.externalSessionId,
          ).catch(() => undefined);
          void loadSessionModelCatalog(record.sessionId, baseUrl, workingDirectory).catch(
            () => undefined,
          );
        } catch {
          if (isStaleRepoOperation()) {
            return;
          }
          void loadSessionTodos(
            record.sessionId,
            baseUrl,
            workingDirectory,
            record.externalSessionId,
          ).catch(() => undefined);
          void loadSessionModelCatalog(record.sessionId, baseUrl, workingDirectory).catch(
            () => undefined,
          );
        }
      }),
    );
  };
};
