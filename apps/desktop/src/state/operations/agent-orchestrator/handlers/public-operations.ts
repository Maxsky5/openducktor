import type { AgentModelSelection } from "@openducktor/core";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import type { AgentSessionLoadOptions, AgentSessionState } from "@/types/agent-orchestrator";
import type { StartAgentSessionInput } from "./start-session";
import type { ForkAgentSessionActionInput } from "./session-actions";

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
  sessionActions: SessionActions;
};

export type OrchestratorPublicOperations = {
  sessions: AgentSessionState[];
  loadAgentSessions: (taskId: string, options?: AgentSessionLoadOptions) => Promise<void>;
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

export const createOrchestratorPublicOperations = ({
  sessionsById,
  loadAgentSessions,
  sessionActions,
}: CreatePublicOperationsArgs): OrchestratorPublicOperations => ({
  sessions: Object.values(sessionsById).sort(sortByStartedAtDesc),
  loadAgentSessions: async (taskId: string, options?: AgentSessionLoadOptions): Promise<void> => {
    try {
      await loadAgentSessions(taskId, options);
    } catch (error) {
      toast.error("Failed to load agent sessions", {
        description: errorMessage(error),
      });
      throw error;
    }
  },
  startAgentSession: async (input: StartAgentSessionInput): Promise<string> => {
    try {
      return await sessionActions.startAgentSession(input);
    } catch (error) {
      toast.error("Failed to start agent session", {
        description: errorMessage(error),
      });
      throw error;
    }
  },
  forkAgentSession: async (input: ForkAgentSessionActionInput): Promise<string> => {
    try {
      return await sessionActions.forkAgentSession(input);
    } catch (error) {
      toast.error("Failed to fork agent session", {
        description: errorMessage(error),
      });
      throw error;
    }
  },
  sendAgentMessage: async (sessionId: string, content: string): Promise<void> => {
    try {
      await sessionActions.sendAgentMessage(sessionId, content);
    } catch (error) {
      toast.error("Failed to send message", {
        description: errorMessage(error),
      });
      throw error;
    }
  },
  stopAgentSession: sessionActions.stopAgentSession,
  updateAgentSessionModel: sessionActions.updateAgentSessionModel,
  replyAgentPermission: sessionActions.replyAgentPermission,
  answerAgentQuestion: sessionActions.answerAgentQuestion,
});
