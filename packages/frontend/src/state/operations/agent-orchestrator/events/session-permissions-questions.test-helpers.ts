import { matchesAgentSessionIdentity } from "@/lib/agent-session-identity";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import {
  buildSession,
  type createSessionsRef,
  createSessionUpdater,
  findSession,
  listenToAgentSessionEvents,
  type SessionEvent,
  type SessionEventAdapter,
  type SessionUpdateFn,
} from "./session-events-test-harness";

export const flushAutoReject = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

export const startTestSessionObserver = async (input: {
  externalSessionId: string;
  sessionsRef: ReturnType<typeof createSessionsRef>;
  replyApproval?: SessionEventAdapter["replyApproval"];
  isSessionObserved?: (session: AgentSessionIdentity) => boolean;
  updateSession?: SessionUpdateFn;
}): Promise<(event: SessionEvent) => void> => {
  const handlers: Array<(event: SessionEvent) => void> = [];
  const adapter: SessionEventAdapter = {
    subscribeEvents: async (_externalSessionId, handler) => {
      handlers.push(handler);
      return () => {};
    },
    replyApproval: input.replyApproval ?? (async () => {}),
  };
  const updateSession = input.updateSession ?? createSessionUpdater(input.sessionsRef);
  const observedSession = findSession(input.sessionsRef, input.externalSessionId);
  const shouldLoadSettingsSnapshot = observedSession?.runtimeKind === "opencode";

  await listenToAgentSessionEvents({
    adapter,
    repoPath: "/tmp/repo",
    externalSessionId: input.externalSessionId,
    sessionsRef: input.sessionsRef,
    updateSession,
    ...(input.isSessionObserved ? { isSessionObserved: input.isSessionObserved } : {}),
    resolveTurnDurationMs: () => undefined,
    clearTurnDuration: () => {},
    refreshTaskData: async () => {},
    ...(shouldLoadSettingsSnapshot
      ? { loadSettingsSnapshot: async () => createSettingsSnapshotFixture() }
      : {}),
  });

  const handleEvent = handlers[0];
  if (!handleEvent) {
    throw new Error("Expected session event handler to be registered");
  }
  return handleEvent;
};

export const opencodeSessionIdentity = (externalSessionId: string) => ({
  externalSessionId,
  runtimeKind: "opencode" as const,
  workingDirectory: "/tmp/repo",
});

export const listensToSessions =
  (...externalSessionIds: string[]) =>
  (session: AgentSessionIdentity): boolean =>
    externalSessionIds.some((externalSessionId) =>
      matchesAgentSessionIdentity(session, opencodeSessionIdentity(externalSessionId)),
    );

export const buildParentSubagentMessage = ({
  correlationKey,
  partId,
  prompt,
  agent = "build",
}: {
  correlationKey: string;
  partId: string;
  prompt: string;
  agent?: string;
}) => ({
  id: `subagent:${correlationKey}`,
  role: "system" as const,
  content: `Subagent (${agent}): ${prompt}`,
  timestamp: "2026-02-22T08:00:01.000Z",
  meta: {
    kind: "subagent" as const,
    partId,
    correlationKey,
    status: "running" as const,
    agent,
    prompt,
  },
});

export const buildParentSessionWithSubagent = (
  input: Parameters<typeof buildParentSubagentMessage>[0],
) =>
  buildSession({
    externalSessionId: "external-parent-session",
    role: "planner",
    messages: [buildParentSubagentMessage(input)],
  });

export type ApprovalRequiredEvent = Extract<SessionEvent, { type: "approval_required" }>;
export type QuestionRequiredEvent = Extract<SessionEvent, { type: "question_required" }>;

export const approvalRequiredEvent = (
  overrides: Pick<ApprovalRequiredEvent, "externalSessionId" | "requestId"> &
    Partial<Omit<ApprovalRequiredEvent, "type" | "externalSessionId" | "requestId">>,
): ApprovalRequiredEvent => {
  const actionName = overrides.action?.name ?? "read";
  return {
    type: "approval_required",
    requestType: "permission_grant",
    title: `Approve permission: ${actionName}`,
    summary: `Approval request for ${actionName}.`,
    affectedPaths: ["src/**"],
    action: { name: actionName },
    mutation: "read_only",
    supportedReplyOutcomes: ["approve_once", "approve_session", "reject"],
    timestamp: "2026-02-22T08:00:05.000Z",
    ...overrides,
  };
};

export const linkedChildApprovalEvent = (
  overrides: Pick<ApprovalRequiredEvent, "externalSessionId" | "requestId"> &
    Partial<Omit<ApprovalRequiredEvent, "type" | "externalSessionId" | "requestId">>,
): ApprovalRequiredEvent =>
  approvalRequiredEvent({
    parentExternalSessionId: "external-parent-session",
    childExternalSessionId: "external-child-session",
    ...overrides,
  });

export const questionRequiredEvent = (
  overrides: Pick<QuestionRequiredEvent, "externalSessionId" | "requestId"> &
    Partial<Omit<QuestionRequiredEvent, "type" | "externalSessionId" | "requestId">>,
): QuestionRequiredEvent => ({
  type: "question_required",
  questions: [
    {
      header: "Scope",
      question: "Pick target",
      options: [{ label: "A", description: "Option A" }],
    },
  ],
  timestamp: "2026-02-22T08:00:05.000Z",
  ...overrides,
});

export const linkedChildQuestionEvent = (
  overrides: Pick<QuestionRequiredEvent, "externalSessionId" | "requestId"> &
    Partial<Omit<QuestionRequiredEvent, "type" | "externalSessionId" | "requestId">>,
): QuestionRequiredEvent =>
  questionRequiredEvent({
    parentExternalSessionId: "external-parent-session",
    childExternalSessionId: "external-child-session",
    ...overrides,
  });
