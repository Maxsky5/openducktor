import "../../test-support/dom-environment";
import { describe, expect, mock, test } from "bun:test";
import type { RepoConfig } from "@openducktor/contracts";
import { createElement, type PropsWithChildren, type ReactElement, useState } from "react";
import { RuntimeDefinitionsContext } from "../../app-state/app-state-contexts";
import { ClientConnectionProvider } from "../../connection/client-connection-react";
import { GitConflictRequestCancelled } from "../../git/conflicts/conflict-assistance";
import { agentSessionIdentityKey } from "../../lib/agent-session-identity";
import {
  type AgentSessionSummary,
  toAgentSessionSummary,
} from "../../sessions/agent-sessions-store";
import {
  AgentSessionReadModelStateContext,
  HostRuntimeStatusContext,
} from "../../sessions/session-contexts";
import type { SessionStartFlowRequest } from "../../sessions/start/session-start-types";
import { createAgentMessageSendReceipt } from "../../test-support/agent-message-send-fixture";
import { createHookHarness } from "../../test-support/react-hook-harness";
import { createRuntimeDefinitionsContextValue } from "../../test-support/runtime-hook-harness";
import {
  createAgentSessionFixture,
  createDeferred,
  createHostRuntimeStatusContextValue,
  createSettingsSnapshotFixture,
  createTaskCardFixture,
} from "../../test-support/shared-test-fixtures";
import { createTestClientConnection } from "../../test-support/test-client-connection";
import { useTaskGitConflictResolver } from "./use-task-git-conflict-resolver";

const CONFLICT_DIRECTORY = "/repo/worktrees/task-1";

const conflict = {
  operation: "rebase" as const,
  currentBranch: "feature/task-1",
  targetBranch: "origin/main",
  conflictedFiles: ["src/conflict.ts"],
  output: "CONFLICT (content): Merge conflict in src/conflict.ts",
  workingDir: CONFLICT_DIRECTORY,
};

const repoConfig = (workspaceId: string): RepoConfig => ({
  workspaceId,
  workspaceName: workspaceId,
  repoPath: "/repo",
  branchPrefix: "odt/",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: {},
  hooks: { postComplete: [] },
  actions: { items: [], defaultActionId: null },
  promptOverrides: {},
  worktreeCopyPaths: [],
  agentStudioState: { openTaskIds: [] },
  agentDefaults: {},
});

const session = (
  externalSessionId: string,
  taskId: string,
  role: "build" | "planner",
): AgentSessionSummary =>
  toAgentSessionSummary(
    createAgentSessionFixture({
      externalSessionId,
      sessionAssociation: { kind: "workflow", taskId, role },
      runtimeKind: "opencode",
      status: "idle",
      runtimeStatusMessage: null,
      startedAt: "2026-03-18T10:00:00.000Z",
      workingDirectory: CONFLICT_DIRECTORY,
      historyLoadState: "not_requested",
      selectedModel: null,
    }),
  );

const startedBuilder = (externalSessionId: string) => ({
  externalSessionId,
  runtimeKind: "opencode" as const,
  workingDirectory: CONFLICT_DIRECTORY,
  postStartActionError: null,
  postStartMessageReceipt: createAgentMessageSendReceipt({
    externalSessionId,
    runtimeKind: "opencode",
    workingDirectory: CONFLICT_DIRECTORY,
  }),
});

type ResolverProps = Parameters<typeof useTaskGitConflictResolver>[0];

const renderResolver = (
  props: Omit<ResolverProps, "tasks">,
  readRepoConfig: (workspaceId: string) => Promise<RepoConfig>,
) => {
  const connection = createTestClientConnection({
    client: {
      workspaceGetRepoConfig: readRepoConfig,
      workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture(),
    },
  });
  function Providers({ children }: PropsWithChildren): ReactElement {
    const [values] = useState(() => ({
      runtimes: createRuntimeDefinitionsContextValue(),
      status: createHostRuntimeStatusContextValue(),
    }));
    return createElement(
      ClientConnectionProvider,
      { connection },
      createElement(
        RuntimeDefinitionsContext,
        { value: values.runtimes },
        createElement(
          HostRuntimeStatusContext,
          { value: values.status },
          createElement(
            AgentSessionReadModelStateContext,
            {
              value: {
                sessionReadModelLoadState: { kind: "ready", workspaceRepoPath: "/repo" },
                workspaceSessionRecordsError: null,
                reloadSessionReadModel: () => {},
                getSessionFault: () => null,
              },
            },
            children,
          ),
        ),
      ),
    );
  }
  const tasks = [createTaskCardFixture({ id: "task-1", title: "Resolve rebase conflict" })];
  return createHookHarness(useTaskGitConflictResolver, { ...props, tasks }, { wrapper: Providers });
};

describe("useTaskGitConflictResolver", () => {
  test("cancels a request when the workspace changes before its prompt loads", async () => {
    const config = createDeferred<RepoConfig>();
    const startSessionIntent = mock(async (_request: SessionStartFlowRequest) =>
      startedBuilder("build-1"),
    );
    const openBuilderSession = mock(() => {});
    const props = {
      activeWorkspaceId: "workspace-a",
      workspaceRepoPath: "/repo",
      sessions: [],
      startSessionIntent,
      openBuilderSession,
    };
    const harness = renderResolver(props, () => config.promise);
    try {
      await harness.mount();
      const result = harness
        .getLatest()(conflict, "task-1")
        .catch((cause: unknown) => cause);

      await harness.update({
        ...props,
        activeWorkspaceId: "workspace-b",
        tasks: [createTaskCardFixture({ id: "task-1" })],
      });
      config.resolve(repoConfig("workspace-a"));

      expect(await result).toBeInstanceOf(GitConflictRequestCancelled);
      expect(startSessionIntent).not.toHaveBeenCalled();
      expect(openBuilderSession).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("asks a Builder of the task and cancels its launch after a repository change", async () => {
    const builder = session("build-1", "task-1", "build");
    const requests: SessionStartFlowRequest[] = [];
    const startSessionIntent = mock(async (request: SessionStartFlowRequest) => {
      requests.push(request);
      return startedBuilder("build-1");
    });
    const openBuilderSession = mock(() => {});
    const props = {
      activeWorkspaceId: "workspace-a",
      workspaceRepoPath: "/repo",
      sessions: [
        builder,
        session("build-2", "task-2", "build"),
        session("planner-1", "task-1", "planner"),
      ],
      startSessionIntent,
      openBuilderSession,
    };
    const harness = renderResolver(props, async (workspaceId) => repoConfig(workspaceId));
    try {
      await harness.mount();
      const receipt = await harness.getLatest()(conflict, "task-1");

      expect(receipt).not.toBe(false);
      const request = requests[0];
      expect(request).toMatchObject({
        taskId: "task-1",
        role: "build",
        launchActionId: "build_rebase_conflict_resolution",
        postStartAction: "send_message",
        targetWorkingDirectory: CONFLICT_DIRECTORY,
        initialStartMode: "reuse",
      });
      expect(request?.existingSessionOptions?.map((option) => option.value)).toEqual([
        agentSessionIdentityKey(builder),
      ]);
      expect(openBuilderSession).toHaveBeenCalledWith("task-1", {
        externalSessionId: "build-1",
        runtimeKind: "opencode",
        workingDirectory: CONFLICT_DIRECTORY,
      });

      request?.assertBeforeLaunch?.();
      await harness.update({
        ...props,
        workspaceRepoPath: "/other-repo",
        tasks: [createTaskCardFixture({ id: "task-1" })],
      });
      expect(() => request?.assertBeforeLaunch?.()).toThrow(GitConflictRequestCancelled);
    } finally {
      await harness.unmount();
    }
  });
});
