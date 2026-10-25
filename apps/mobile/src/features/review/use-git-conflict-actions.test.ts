import "@openducktor/frontend-core/test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import { RuntimeDefinitionsContext } from "@openducktor/frontend-core/app-state/app-state-contexts";
import type { ClientConnection } from "@openducktor/frontend-core/connection/client-connection";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import {
  CONFLICT_ABORT_REFRESH_FAILED_TITLE,
  UNIDENTIFIED_GIT_CONFLICT_ASK_BLOCKED_REASON,
} from "@openducktor/frontend-core/git/conflicts/conflict-copy";
import type { DiffDataState, GitConflict } from "@openducktor/frontend-core/git/contracts";
import { createEmptyScopeState } from "@openducktor/frontend-core/git/model/scope-state";
import type { GitRefresh } from "@openducktor/frontend-core/git/refresh/use-git-refresh";
import { createAgentSessionsStore } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import {
  AgentOperationsContext,
  AgentSessionReadModelStateContext,
  AgentSessionsContext,
  HostRuntimeStatusContext,
} from "@openducktor/frontend-core/sessions/session-contexts";
import { createAgentOperationsFixture } from "@openducktor/frontend-core/test-support/agent-operations-fixture";
import { createFeedbackFake } from "@openducktor/frontend-core/test-support/feedback-fake";
import { createRuntimeDefinitionsContextValue } from "@openducktor/frontend-core/test-support/runtime-hook-harness";
import {
  createDeferred,
  createHostRuntimeStatusContextValue,
  createTaskCardFixture,
  createWorkspaceRecordFixture,
} from "@openducktor/frontend-core/test-support/shared-test-fixtures";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { RemoteConnectionError } from "@openducktor/host-client/remote";
import { act, renderHook } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import type { WorkOwner } from "@/features/work-owner/work-owner-context";
import { useGitConflictActions } from "./use-git-conflict-actions";

const conflict = (overrides: Partial<GitConflict> = {}): GitConflict => ({
  operation: "rebase",
  currentBranch: "feature",
  targetBranch: "origin/main",
  conflictedFiles: ["src/a.ts"],
  output: "CONFLICT (content): Merge conflict in src/a.ts",
  workingDir: "/repo/wt",
  ...overrides,
});

const diffData = (): DiffDataState => ({
  branch: "feature",
  worktreePath: "/repo/wt",
  targetBranch: "origin/main",
  scopeStatesByScope: { uncommitted: createEmptyScopeState(), target: createEmptyScopeState() },
  loadedScopesByScope: { uncommitted: true, target: true },
  commitsAheadBehind: null,
  upstreamAheadBehind: null,
  upstreamStatus: "tracking",
  fileStatuses: [],
  hashVersion: null,
  statusHash: null,
  diffHash: null,
  uncommittedFileCount: 0,
  isLoading: false,
});

const taskOwner = (refresh: GitRefresh): WorkOwner => ({
  ref: { kind: "task", workspaceId: "workspace-1", taskId: "task-1" },
  key: "task-1",
  workspace: createWorkspaceRecordFixture(),
  repoPath: "/repo",
  title: "Fix parser",
  task: createTaskCardFixture({ id: "task-1" }),
  record: null,
  commentOwner: { kind: "task", workspaceId: "workspace-1", taskId: "task-1" },
  recipientLabel: "Builder",
  feedback: { session: null, blockedReason: null, retry: null },
  git: {
    diffData: diffData(),
    contextMode: "worktree",
    workingDirectory: "/repo/wt",
    workingDirectoryUnavailableReason: null,
    workingDirectoryPending: false,
    currentBranch: null,
    targetBranch: "origin/main",
    comparisonChoice: null,
    fileTreeBranchKey: "feature",
    fileTreeTargetBranch: null,
    refresh,
    manualRefresh: { refresh: async () => {}, isRefreshing: false, refreshError: null },
  },
});

const lostResult = () =>
  new RemoteConnectionError({
    code: "outcome_unknown",
    message: "The host did not confirm the command.",
    nextAction: "Check the repository state before you abort again.",
  });

/**
 * Renders the hook with the contexts that it reads. `sessionsRepoPath` is the workspace whose
 * live sessions loaded: another path leaves the Builder sessions of the task unknown.
 */
const render = ({
  connection,
  owner,
  gitConflict,
  sessionsRepoPath = "/repo",
}: {
  connection: ClientConnection;
  owner: WorkOwner;
  gitConflict: GitConflict | null;
  sessionsRepoPath?: string;
}) => {
  const runtimes = createRuntimeDefinitionsContextValue();
  const runtimeStatus = createHostRuntimeStatusContextValue();
  const operations = createAgentOperationsFixture();
  const sessions = createAgentSessionsStore(sessionsRepoPath);
  const readModel = {
    sessionReadModelLoadState: { kind: "ready", workspaceRepoPath: "/repo" },
    workspaceSessionRecordsError: null,
    reloadSessionReadModel: () => {},
    getSessionFault: () => null,
  } as const;
  const wrapper = ({ children }: PropsWithChildren) =>
    createElement(
      ClientConnectionProvider,
      { connection },
      createElement(
        RuntimeDefinitionsContext,
        { value: runtimes },
        createElement(
          HostRuntimeStatusContext,
          { value: runtimeStatus },
          createElement(
            AgentSessionReadModelStateContext,
            { value: readModel },
            createElement(
              AgentOperationsContext,
              { value: operations },
              createElement(AgentSessionsContext, { value: sessions }, children),
            ),
          ),
        ),
      ),
    );
  return renderHook(
    () => useGitConflictActions({ owner, conflict: gitConflict, onOpenSession: () => {} }),
    { wrapper },
  );
};

describe("Git conflict abort", () => {
  test("an abort runs the host command, then reads Git again", async () => {
    const aborts: string[][] = [];
    const refreshes: string[] = [];
    const feedback = createFeedbackFake();
    const connection = createTestClientConnection({
      feedback,
      client: {
        gitAbortConflict: async (repoPath, operation, workingDir) => {
          aborts.push([repoPath, operation, workingDir ?? ""]);
          return { output: "" };
        },
      },
    });
    const view = render({
      connection,
      owner: taskOwner(async (mode) => {
        refreshes.push(mode);
      }),
      gitConflict: conflict(),
    });

    await act(() => view.result.current.abort());

    expect(aborts).toEqual([["/repo", "rebase", "/repo/wt"]]);
    expect(refreshes).toEqual(["soft"]);
    expect(feedback.shownOf("success").map((entry) => entry.message)).toEqual(["Rebase aborted"]);
    expect(view.result.current.notice).toBeNull();
    expect(view.result.current.action).toBeNull();
    view.unmount();
  });

  test("a lost result shows Result unknown, and a second press waits for the first", async () => {
    const pending = createDeferred<{ output: string }>();
    let calls = 0;
    const refreshes: string[] = [];
    const connection = createTestClientConnection({
      client: {
        gitAbortConflict: () => {
          calls += 1;
          return pending.promise;
        },
      },
    });
    const view = render({
      connection,
      owner: taskOwner(async (mode) => {
        refreshes.push(mode);
      }),
      gitConflict: conflict(),
    });

    await act(async () => {
      const first = view.result.current.abort();
      const second = view.result.current.abort();
      pending.reject(lostResult());
      await Promise.all([first, second]);
    });

    expect(calls).toBe(1);
    expect(refreshes).toEqual([]);
    expect(view.result.current.notice).toEqual({
      tone: "warning",
      title: "Result unknown",
      message: "Check the repository state before you abort again.",
    });
    view.unmount();
  });

  test("a failed read after a good abort shows a warning and an error toast", async () => {
    const feedback = createFeedbackFake();
    const connection = createTestClientConnection({
      feedback,
      client: { gitAbortConflict: async () => ({ output: "" }) },
    });
    const view = render({
      connection,
      owner: taskOwner(async () => {
        throw new Error("git status failed");
      }),
      gitConflict: conflict(),
    });

    await act(() => view.result.current.abort());

    expect(view.result.current.notice).toEqual({
      tone: "warning",
      title: CONFLICT_ABORT_REFRESH_FAILED_TITLE,
      message: "git status failed",
    });
    expect(feedback.shownOf("error").map((entry) => entry.message)).toEqual([
      CONFLICT_ABORT_REFRESH_FAILED_TITLE,
    ]);
    view.unmount();
  });
});

describe("Git conflict request", () => {
  test("Ask sends nothing for a conflict that Git does not identify", async () => {
    const connection = createTestClientConnection();
    const view = render({
      connection,
      owner: taskOwner(async () => {}),
      gitConflict: conflict({ operation: null }),
    });
    expect(view.result.current.askBlockedReason).toBe(UNIDENTIFIED_GIT_CONFLICT_ASK_BLOCKED_REASON);

    await act(() => view.result.current.askAgent());

    // The agent operations fixture fails any send, so a send would show another notice.
    expect(view.result.current.notice).toEqual({
      tone: "destructive",
      title: "Cannot contact the Builder",
      message: UNIDENTIFIED_GIT_CONFLICT_ASK_BLOCKED_REASON,
    });
    view.unmount();
  });

  test("Ask waits while the Builder sessions of the task load", async () => {
    const connection = createTestClientConnection();
    const view = render({
      connection,
      owner: taskOwner(async () => {}),
      gitConflict: conflict(),
      sessionsRepoPath: "/other-repo",
    });
    const reason = view.result.current.askBlockedReason;
    expect(reason).toContain("still loading");

    await act(() => view.result.current.askAgent());

    expect(view.result.current.notice).toMatchObject({ tone: "destructive", message: reason });
    view.unmount();
  });
});
