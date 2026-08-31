import { describe, expect, mock, test } from "bun:test";
import type { RepoPromptOverrides } from "@openducktor/contracts";
import {
  createAgentSessionCollection,
  getAgentSession,
  replaceAgentSession,
} from "@/state/agent-session-collection";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { UpdateSession } from "../events/session-event-types";
import { createTaskCardFixture } from "../test-utils";
import {
  createLoadAgentSessionHistory,
  loadSessionHistoryIntoStore,
} from "./session-history-loader";
import { createWorkflowSessionHistoryPromptPolicy } from "./workflow-session-history-policy";

const sessionTarget = {
  externalSessionId: "external-1",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
} satisfies AgentSessionIdentity;

const createSession = (): AgentSessionState =>
  createAgentSessionFixture({
    externalSessionId: sessionTarget.externalSessionId,
    sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
    runtimeKind: "opencode",
    status: "running",
    startedAt: "2026-06-12T08:00:00.000Z",
    workingDirectory: sessionTarget.workingDirectory,
    historyLoadState: "not_requested",
  });

const createHistoryLoadHarness = (initialSession: AgentSessionState) => {
  let sessionCollection = createAgentSessionCollection([initialSession]);
  const updateSession: UpdateSession = (identity, updater) => {
    const current = getAgentSession(sessionCollection, identity);
    if (!current) {
      return null;
    }
    const nextSession = updater(current);
    sessionCollection = replaceAgentSession(sessionCollection, nextSession);
    return nextSession;
  };

  return {
    readSessionSnapshot: (identity: AgentSessionIdentity) =>
      getAgentSession(sessionCollection, identity),
    updateSession,
    get session() {
      const session = getAgentSession(sessionCollection, initialSession);
      if (!session) {
        throw new Error(`Expected session '${initialSession.externalSessionId}' to exist.`);
      }
      return session;
    },
  };
};

const createPromptPolicy = (
  loadRepoPromptOverrides = async (): Promise<RepoPromptOverrides> => ({}),
) =>
  createWorkflowSessionHistoryPromptPolicy({
    workspaceRepoPath: "/repo",
    workspaceId: "workspace-1",
    taskRef: { current: [] },
    loadRepoPromptOverrides,
  });

describe("session history loader scope", () => {
  test("loads repository history from the recorded session repository", async () => {
    const repositorySession: AgentSessionState = {
      ...createSession(),
      repoPath: "/session-repository",
      sessionAssociation: { kind: "repository" },
    };
    const harness = createHistoryLoadHarness(repositorySession);
    let historyRepoPath: string | undefined;
    const loadAgentSessionHistory = createLoadAgentSessionHistory({
      workspaceRepoPath: "/active-workspace",
      adapter: {
        loadSessionHistory: async (input) => {
          historyRepoPath = input.repoPath;
          return [];
        },
      },
      repoEpochRef: { current: 0 },
      currentWorkspaceRepoPathRef: { current: "/active-workspace" },
      readSessionSnapshot: harness.readSessionSnapshot,
      updateSession: harness.updateSession,
      loadSystemPromptContext: createPromptPolicy(),
    });

    await loadAgentSessionHistory(sessionTarget);

    expect(historyRepoPath).toBe("/session-repository");
  });

  test("rejects history loading for an unbound session without repository context", async () => {
    const unboundSession: AgentSessionState = {
      ...createSession(),
      sessionAssociation: { kind: "unbound" },
    };
    const harness = createHistoryLoadHarness(unboundSession);
    const loadRepoPromptOverrides = mock(async (): Promise<RepoPromptOverrides> => ({}));
    const loadSessionHistory = mock(async () => []);
    const loadAgentSessionHistory = createLoadAgentSessionHistory({
      workspaceRepoPath: "/repo",
      adapter: { loadSessionHistory },
      repoEpochRef: { current: 0 },
      currentWorkspaceRepoPathRef: { current: "/repo" },
      readSessionSnapshot: harness.readSessionSnapshot,
      updateSession: harness.updateSession,
      loadSystemPromptContext: createPromptPolicy(loadRepoPromptOverrides),
    });

    await expect(loadAgentSessionHistory(sessionTarget)).rejects.toThrow(
      "Cannot load history for unbound session 'external-1'; repository or workflow context is required.",
    );

    expect(loadRepoPromptOverrides).not.toHaveBeenCalled();
    expect(loadSessionHistory).not.toHaveBeenCalled();
    expect(harness.session.historyLoadState).toBe("not_requested");
  });

  test("rejects workflow history from a repository outside the active workspace", async () => {
    const workflowSession: AgentSessionState = {
      ...createSession(),
      repoPath: "/other-repo",
    };
    const harness = createHistoryLoadHarness(workflowSession);
    const loadRepoPromptOverrides = mock(async (): Promise<RepoPromptOverrides> => ({}));
    const loadSessionHistory = mock(async () => []);
    const loadAgentSessionHistory = createLoadAgentSessionHistory({
      workspaceRepoPath: "/repo",
      adapter: { loadSessionHistory },
      repoEpochRef: { current: 0 },
      currentWorkspaceRepoPathRef: { current: "/repo" },
      readSessionSnapshot: harness.readSessionSnapshot,
      updateSession: harness.updateSession,
      loadSystemPromptContext: createWorkflowSessionHistoryPromptPolicy({
        workspaceRepoPath: "/repo",
        workspaceId: "workspace-1",
        taskRef: { current: [createTaskCardFixture({ id: "task-1" })] },
        loadRepoPromptOverrides,
      }),
    });

    await expect(loadAgentSessionHistory(sessionTarget)).resolves.toBeNull();

    expect(loadRepoPromptOverrides).not.toHaveBeenCalled();
    expect(loadSessionHistory).not.toHaveBeenCalled();
    expect(harness.session.historyLoadState).toBe("failed");
    expect(harness.session.historyLoadFailure?.detail).toBe(
      "Cannot load workflow history for session 'external-1' because its repository '/other-repo' is not active.",
    );
  });

  test("rejects history loading when the session association is missing", async () => {
    const malformedSession = createSession();
    Reflect.deleteProperty(malformedSession, "sessionAssociation");
    const harness = createHistoryLoadHarness(malformedSession);
    const loadSessionHistory = mock(async () => []);

    await expect(
      loadSessionHistoryIntoStore({
        repoPath: "/repo",
        adapter: { loadSessionHistory },
        readSessionSnapshot: harness.readSessionSnapshot,
        updateSession: harness.updateSession,
        identity: sessionTarget,
        isStaleRepoOperation: () => false,
      }),
    ).rejects.toThrow(
      "Cannot load history for session 'external-1' because its association is missing.",
    );
    expect(loadSessionHistory).not.toHaveBeenCalled();
  });

  test("forwards repository scope when loading a live repository session", async () => {
    const repositorySession: AgentSessionState = {
      ...createSession(),
      sessionAssociation: { kind: "repository" },
    };
    const harness = createHistoryLoadHarness(repositorySession);
    const loadRepoPromptOverrides = mock(async (): Promise<RepoPromptOverrides> => ({}));
    let historyInput:
      | Parameters<
          Parameters<typeof loadSessionHistoryIntoStore>[0]["adapter"]["loadSessionHistory"]
        >[0]
      | null = null;

    await loadSessionHistoryIntoStore({
      repoPath: "/repo",
      adapter: {
        loadSessionHistory: async (input) => {
          historyInput = input;
          return [];
        },
      },
      readSessionSnapshot: harness.readSessionSnapshot,
      updateSession: harness.updateSession,
      identity: sessionTarget,
      loadSystemPromptContext: createPromptPolicy(loadRepoPromptOverrides),
      isStaleRepoOperation: () => false,
    });

    expect(historyInput).toMatchObject({
      externalSessionId: "external-1",
      sessionScope: { kind: "repository" },
    });
    expect(loadRepoPromptOverrides).not.toHaveBeenCalled();
  });
});
