import type { AgentSessionRecord, RuntimeKind } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { useQuery } from "@tanstack/react-query";
import {
  createContext,
  type PropsWithChildren,
  type ReactElement,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  useActiveWorkspace,
  useAgentOperations,
  useAgentSession,
  useTasksState,
} from "@/state/app-state-provider";
import { isTranscriptAgentSession } from "@/state/operations/agent-orchestrator/support/session-purpose";
import { host } from "@/state/operations/host";
import { AgentSessionTranscriptDialog } from "./agent-session-transcript-dialog";

export type OpenAgentSessionTranscriptRequest = {
  taskId: string;
  sessionId: string;
  title?: string;
  description?: string;
  fallbackSession?: {
    role: AgentRole;
    runtimeKind: RuntimeKind;
    workingDirectory: string;
  };
};

type AgentSessionTranscriptDialogContextValue = {
  openSessionTranscript: (request: OpenAgentSessionTranscriptRequest) => void;
  closeSessionTranscript: () => void;
};

const AgentSessionTranscriptDialogContext =
  createContext<AgentSessionTranscriptDialogContextValue | null>(null);

const DEFAULT_TITLE = "Conversation";
const DEFAULT_DESCRIPTION = "Read-only conversation.";

function AgentSessionTranscriptDialogProvider({ children }: PropsWithChildren): ReactElement {
  const activeWorkspace = useActiveWorkspace();
  const { removeAgentSession } = useAgentOperations();
  const { tasks } = useTasksState();
  const [request, setRequest] = useState<OpenAgentSessionTranscriptRequest | null>(null);
  const repoPath = activeWorkspace?.repoPath ?? null;
  const requestedTaskId = request?.taskId?.trim() ?? "";
  const sessionId = request?.sessionId ?? null;
  const activeTranscriptSession = useAgentSession(sessionId);
  const open = request !== null;
  const requestedTask = useMemo(
    () => (requestedTaskId ? (tasks.find((task) => task.id === requestedTaskId) ?? null) : null),
    [requestedTaskId, tasks],
  );
  const locallyResolvedTask = useMemo(() => {
    if (!sessionId) {
      return requestedTask;
    }
    if (
      requestedTask &&
      (requestedTask.agentSessions ?? []).some((record) => record.sessionId === sessionId)
    ) {
      return requestedTask;
    }
    return (
      tasks.find((task) =>
        (task.agentSessions ?? []).some((record) => record.sessionId === sessionId),
      ) ?? null
    );
  }, [requestedTask, sessionId, tasks]);
  const needsAuthoritativeSessionLookup =
    open && repoPath !== null && sessionId !== null && !locallyResolvedTask;
  const requestedTaskCandidateIds = useMemo(
    () => (requestedTaskId ? [requestedTaskId] : []),
    [requestedTaskId],
  );
  const workspaceTaskCandidateIds = useMemo(() => {
    const ids = new Set<string>();
    for (const task of tasks) {
      const taskId = task.id.trim();
      if (taskId.length > 0) {
        ids.add(taskId);
      }
    }
    return Array.from(ids).sort();
  }, [tasks]);

  const { data: requestedTaskSessionRecordsByTaskId, isPending: isRequestedTaskLookupPending } =
    useQuery<Record<string, AgentSessionRecord[]>>({
      queryKey: [
        "agent-session-dialog",
        "requested-task-session-records",
        repoPath,
        sessionId,
        requestedTaskCandidateIds,
      ],
      enabled: needsAuthoritativeSessionLookup && requestedTaskCandidateIds.length > 0,
      queryFn: async (): Promise<Record<string, AgentSessionRecord[]>> => {
        if (!repoPath || !sessionId || requestedTaskCandidateIds.length === 0) {
          throw new Error("Cannot load session records without repository and session context.");
        }
        return host.agentSessionsListBulk(repoPath, requestedTaskCandidateIds);
      },
      staleTime: 0,
      refetchOnWindowFocus: false,
    });
  const requestedTaskHasSession = useMemo(() => {
    if (!sessionId || requestedTaskId.length === 0) {
      return false;
    }
    return (
      requestedTaskSessionRecordsByTaskId?.[requestedTaskId]?.some(
        (record) => record.sessionId === sessionId,
      ) ?? false
    );
  }, [requestedTaskId, requestedTaskSessionRecordsByTaskId, sessionId]);
  const shouldRunWorkspaceLookup =
    needsAuthoritativeSessionLookup &&
    !requestedTaskHasSession &&
    (requestedTaskCandidateIds.length === 0 || !isRequestedTaskLookupPending) &&
    workspaceTaskCandidateIds.length > 0;
  const { data: workspaceSessionRecordsByTaskId, isPending: isWorkspaceLookupPending } = useQuery<
    Record<string, AgentSessionRecord[]>
  >({
    queryKey: [
      "agent-session-dialog",
      "workspace-session-records",
      repoPath,
      sessionId,
      workspaceTaskCandidateIds,
    ],
    enabled: shouldRunWorkspaceLookup,
    queryFn: async (): Promise<Record<string, AgentSessionRecord[]>> => {
      if (!repoPath || !sessionId || workspaceTaskCandidateIds.length === 0) {
        throw new Error("Cannot load session records without repository and session context.");
      }
      return host.agentSessionsListBulk(repoPath, workspaceTaskCandidateIds);
    },
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const resolvedTaskId = useMemo(() => {
    if (!sessionId) {
      return requestedTaskId;
    }

    if (locallyResolvedTask) {
      return locallyResolvedTask.id;
    }

    if (requestedTaskHasSession) {
      return requestedTaskId;
    }

    if (workspaceSessionRecordsByTaskId) {
      for (const [taskId, records] of Object.entries(workspaceSessionRecordsByTaskId)) {
        if (records.some((record) => record.sessionId === sessionId)) {
          return taskId;
        }
      }
    }

    return requestedTaskId;
  }, [
    locallyResolvedTask,
    requestedTaskHasSession,
    requestedTaskId,
    sessionId,
    workspaceSessionRecordsByTaskId,
  ]);
  const persistedRecords = useMemo(() => {
    if (!resolvedTaskId) {
      return undefined;
    }
    if (locallyResolvedTask && locallyResolvedTask.id === resolvedTaskId) {
      return locallyResolvedTask.agentSessions;
    }
    if (requestedTaskHasSession && resolvedTaskId === requestedTaskId) {
      return requestedTaskSessionRecordsByTaskId?.[resolvedTaskId];
    }
    return workspaceSessionRecordsByTaskId?.[resolvedTaskId];
  }, [
    locallyResolvedTask,
    requestedTaskHasSession,
    requestedTaskId,
    requestedTaskSessionRecordsByTaskId,
    resolvedTaskId,
    workspaceSessionRecordsByTaskId,
  ]);
  const isResolvingRequestedSession =
    open &&
    ((requestedTaskCandidateIds.length > 0 &&
      needsAuthoritativeSessionLookup &&
      isRequestedTaskLookupPending) ||
      (shouldRunWorkspaceLookup && isWorkspaceLookupPending));

  const openSessionTranscript = useCallback((nextRequest: OpenAgentSessionTranscriptRequest) => {
    setRequest(nextRequest);
  }, []);

  const closeSessionTranscript = useCallback(() => {
    setRequest(null);
    if (sessionId && isTranscriptAgentSession(activeTranscriptSession)) {
      void removeAgentSession(sessionId);
    }
  }, [activeTranscriptSession, removeAgentSession, sessionId]);

  const contextValue = useMemo(
    () => ({
      openSessionTranscript,
      closeSessionTranscript,
    }),
    [closeSessionTranscript, openSessionTranscript],
  );

  return (
    <AgentSessionTranscriptDialogContext.Provider value={contextValue}>
      {children}
      <AgentSessionTranscriptDialog
        activeWorkspace={activeWorkspace}
        taskId={resolvedTaskId}
        sessionId={sessionId}
        {...(persistedRecords ? { persistedRecords } : {})}
        {...(request?.fallbackSession ? { fallbackSession: request.fallbackSession } : {})}
        isResolvingRequestedSession={isResolvingRequestedSession}
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            closeSessionTranscript();
          }
        }}
        title={request?.title ?? DEFAULT_TITLE}
        description={request?.description ?? DEFAULT_DESCRIPTION}
      />
    </AgentSessionTranscriptDialogContext.Provider>
  );
}

export function AgentSessionTranscriptDialogHost({ children }: PropsWithChildren): ReactElement {
  return <AgentSessionTranscriptDialogProvider>{children}</AgentSessionTranscriptDialogProvider>;
}

export const useOptionalAgentSessionTranscriptDialog =
  (): AgentSessionTranscriptDialogContextValue | null => {
    return useContext(AgentSessionTranscriptDialogContext);
  };

export const useAgentSessionTranscriptDialog = (): AgentSessionTranscriptDialogContextValue => {
  const context = useOptionalAgentSessionTranscriptDialog();
  if (!context) {
    throw new Error(
      "useAgentSessionTranscriptDialog must be used within AgentSessionTranscriptDialogHost.",
    );
  }
  return context;
};
