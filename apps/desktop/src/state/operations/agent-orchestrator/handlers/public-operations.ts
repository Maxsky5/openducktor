import type { AgentModelSelection } from "@openducktor/core";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import type { AgentSessionLoadOptions, AgentSessionState } from "@/types/agent-orchestrator";
import type { ForkAgentSessionActionInput } from "./session-actions";
import type { StartAgentSessionInput } from "./start-session";

type SessionActions = {
  startAgentSession: (input: StartAgentSessionInput) => Promise<string>;
  forkAgentSession: (input: ForkAgentSessionActionInput) => Promise<string>;
  sendAgentMessage: (sessionId: string, content: string) => Promise<void>;
  stopAgentSession: (sessionId: string) => Promise<void>;
  updateAgentSessionModel: (sessionId: string, selection: AgentModelSelection | null) => void;
  replyAgentPermission: (
    sessionId: string,
    requestId: string,
    reply: "once" | "always" | "reject",
    message?: string,
  ) => Promise<void>;
  answerAgentQuestion: (sessionId: string, requestId: string, answers: string[][]) => Promise<void>;
};

type CreatePublicOperationsArgs = {
  sessionsById: Record<string, AgentSessionState>;
  loadAgentSessions: (taskId: string, options?: AgentSessionLoadOptions) => Promise<void>;
  removeAgentSessions: (input: { taskId: string; roles?: AgentSessionState["role"][] }) => void;
  sessionActions: SessionActions;
};

type OrchestratorPublicOperations = {
  sessions: AgentSessionState[];
  loadAgentSessions: (taskId: string, options?: AgentSessionLoadOptions) => Promise<void>;
  removeAgentSessions: (input: { taskId: string; roles?: AgentSessionState["role"][] }) => void;
  startAgentSession: (input: StartAgentSessionInput) => Promise<string>;
  forkAgentSession: (input: ForkAgentSessionActionInput) => Promise<string>;
  sendAgentMessage: (sessionId: string, content: string) => Promise<void>;
  stopAgentSession: (sessionId: string) => Promise<void>;
  updateAgentSessionModel: (sessionId: string, selection: AgentModelSelection | null) => void;
  replyAgentPermission: (
    sessionId: string,
    requestId: string,
    reply: "once" | "always" | "reject",
    message?: string,
  ) => Promise<void>;
  answerAgentQuestion: (sessionId: string, requestId: string, answers: string[][]) => Promise<void>;
};

const sortByStartedAtDesc = (a: AgentSessionState, b: AgentSessionState): number =>
  a.startedAt > b.startedAt ? -1 : a.startedAt < b.startedAt ? 1 : 0;

const withErrorToast = async <T>(title: string, operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    toast.error(title, {
      description: errorMessage(error),
    });
    throw error;
  }
};

export const createOrchestratorPublicOperations = ({
  sessionsById,
  loadAgentSessions,
  removeAgentSessions,
  sessionActions,
}: CreatePublicOperationsArgs): OrchestratorPublicOperations => ({
  sessions: Object.values(sessionsById).sort(sortByStartedAtDesc),
  loadAgentSessions: (taskId: string, options?: AgentSessionLoadOptions): Promise<void> =>
    withErrorToast("Failed to load agent sessions", () => loadAgentSessions(taskId, options)),
  removeAgentSessions,
  startAgentSession: (input: StartAgentSessionInput): Promise<string> =>
    withErrorToast("Failed to start agent session", () => sessionActions.startAgentSession(input)),
  forkAgentSession: (input: ForkAgentSessionActionInput): Promise<string> =>
    withErrorToast("Failed to fork agent session", () => sessionActions.forkAgentSession(input)),
  sendAgentMessage: (sessionId: string, content: string): Promise<void> =>
    withErrorToast("Failed to send message", () =>
      sessionActions.sendAgentMessage(sessionId, content),
    ),
  stopAgentSession: sessionActions.stopAgentSession,
  updateAgentSessionModel: sessionActions.updateAgentSessionModel,
  replyAgentPermission: sessionActions.replyAgentPermission,
  answerAgentQuestion: sessionActions.answerAgentQuestion,
});
