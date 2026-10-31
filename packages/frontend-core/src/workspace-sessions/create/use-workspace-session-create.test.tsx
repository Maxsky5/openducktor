import "../../test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import {
  type CustomAgentRole,
  type GitBranch,
  repoConfigSchema,
  type WorkspaceSession,
  type WorkspaceSessionCreateInput,
} from "@openducktor/contracts";
import { HostInvokeError, type HostClient } from "@openducktor/host-client";
import { act, renderHook } from "@testing-library/react";
import { createElement, type PropsWithChildren, type ReactElement } from "react";
import type { ClientConnection } from "../../connection/client-connection";
import { ClientConnectionProvider } from "../../connection/client-connection-react";
import { gitQueryKeys } from "../../queries/git";
import { createTestClientConnection } from "../../test-support/test-client-connection";
import { waitForExpectation } from "../../test-support/wait-for-expectation";
import { workspaceSessionRecord } from "../../test-support/workspace-session-fixtures";
import { createStartupLiveSourceFake } from "../../test-support/startup-live-source-fake";
import { createAgentSessionsStore } from "../../sessions/agent-sessions-store";
import { AgentSessionsContext } from "../../sessions/session-contexts";
import {
  NO_CUSTOM_AGENT_ROLE,
  useWorkspaceSessionCreate,
  type WorkspaceSessionCreateModel,
} from "./use-workspace-session-create";

const WORKSPACE = { workspaceId: "workspace-1", repoPath: "/repos/alpha" };
const SELECTION = { runtimeKind: "codex" as const, providerId: "openai", modelId: "gpt-5" };
const MODEL: WorkspaceSessionCreateModel = { selection: SELECTION, selectedModelAvailable: true };
const ROLE: CustomAgentRole = {
  id: "role-1",
  name: "Reviewer",
  systemPrompt: "Review the change.",
};

const DEFAULT_TARGET = { remote: "origin", branch: "main" };

const ignoreCreated = (): void => {};

const renderCreate = (
  client: Partial<HostClient>,
  onCreated: (session: WorkspaceSession) => void = ignoreCreated,
) => {
  const records = new Map<string, WorkspaceSession>();
  const connection: ClientConnection = createTestClientConnection({
    client: {
      customAgentRoleList: async () => [ROLE],
      workspaceGetRepoConfig: async () =>
        repoConfigSchema.parse({
          workspaceId: WORKSPACE.workspaceId,
          workspaceName: "Alpha",
          repoPath: WORKSPACE.repoPath,
          defaultTargetBranch: DEFAULT_TARGET,
        }),
      ...client,
      workspaceSessionCreate: async (input) => {
        if (!client.workspaceSessionCreate) throw new Error("Create is not configured.");
        const result = await client.workspaceSessionCreate(input);
        records.set(result.session.id, result.session);
        return result;
      },
      workspaceSessionStart: async (input) => {
        if (client.workspaceSessionStart) return client.workspaceSessionStart(input);
        const saved = records.get(input.sessionId);
        if (!saved || !input.startup)
          throw new Error("Start needs the saved record and startup context.");
        const session = { ...saved, externalSessionId: `native-${saved.id}` };
        const runtimeSession = {
          runtimeKind: saved.runtimeKind,
          externalSessionId: session.externalSessionId,
          workingDirectory: saved.executionTarget.workingDirectory,
          status: "idle" as const,
          startedAt: "2026-10-26T00:00:00Z",
        };
        return {
          session,
          runtimeSession,
          startupProgress: live.prepared({
            context: input.startup,
            ...WORKSPACE,
            scope: { kind: "workspace", sessionId: session.id },
            ownership: {
              state: "saved",
              target: { kind: "workspace", record: session, runtimeSession },
            },
          }),
        };
      },
    },
  });
  const live = createStartupLiveSourceFake(connection.queryClient);
  const sessions = createAgentSessionsStore(WORKSPACE.repoPath);
  const wrapper = ({ children }: PropsWithChildren): ReactElement =>
    createElement(
      ClientConnectionProvider,
      { connection },
      createElement(AgentSessionsContext, { value: sessions }, children),
    );
  const view = renderHook(
    ({ workspace, model }) => useWorkspaceSessionCreate({ workspace, model, onCreated }),
    { wrapper, initialProps: { workspace: WORKSPACE, model: MODEL } },
  );
  return { view, connection };
};

describe("useWorkspaceSessionCreate", () => {
  test("repairs a saved chat in its origin after current model choices become unavailable", async () => {
    let creates = 0;
    const starts: { workspaceId: string; sessionId: string }[] = [];
    const draft = workspaceSessionRecord("retained", { externalSessionId: null });
    const prepared = { ...draft, externalSessionId: "native-retained" };
    const runtimeSession = {
      runtimeKind: draft.runtimeKind,
      externalSessionId: prepared.externalSessionId,
      workingDirectory: draft.executionTarget.workingDirectory,
      status: "idle" as const,
      startedAt: "2026-10-26T00:00:00Z",
    };
    const opened: WorkspaceSession[] = [];
    const { view, connection } = renderCreate(
      {
        workspaceSessionCreate: async () => {
          creates += 1;
          return { session: draft };
        },
        workspaceSessionStart: async (input) => {
          starts.push({ workspaceId: input.workspaceId, sessionId: input.sessionId });
          if (!input.startup) throw new Error("Missing startup context");
          if (starts.length === 1)
            throw new HostInvokeError("Native preparation failed", {
              kind: "session_startup",
              startupProgress: {
                ...WORKSPACE,
                context: input.startup,
                hostInstanceId: "host",
                revision: 1,
                scope: { kind: "workspace", sessionId: draft.id },
                phase: "failed",
                steps: [],
                ownership: { state: "saved", target: { kind: "workspace", record: draft } },
              },
            });
          return {
            session: prepared,
            runtimeSession,
            startupProgress: live.prepared({
              ...WORKSPACE,
              context: input.startup,
              scope: { kind: "workspace", sessionId: draft.id },
              ownership: {
                state: "saved",
                target: { kind: "workspace", record: prepared, runtimeSession },
              },
            }),
          };
        },
      },
      (record) => {
        opened.push(record);
      },
    );
    const live = createStartupLiveSourceFake(connection.queryClient);
    await waitForExpectation(() => expect(view.result.current.input).not.toBeNull());
    act(() => view.result.current.submit());
    await waitForExpectation(() => expect(view.result.current.create.isError).toBe(true));
    view.rerender({
      workspace: { workspaceId: "workspace-2", repoPath: "/repos/beta" },
      model: { selection: SELECTION, selectedModelAvailable: false },
    });
    expect(view.result.current.input).toBeNull();
    act(() => view.result.current.repairSavedSession());
    await waitForExpectation(() => expect(view.result.current.create.isSuccess).toBe(true));
    expect(creates).toBe(1);
    expect(starts).toEqual([
      { workspaceId: WORKSPACE.workspaceId, sessionId: draft.id },
      { workspaceId: WORKSPACE.workspaceId, sessionId: draft.id },
    ]);
    expect(opened).toEqual([]);
    expect(connection.startupAttempts.getSnapshot()[0]?.status.phase).toBe("ready");
    view.unmount();
    await connection.dispose();
  });

  test("finishes the originating workspace after a scope change without navigating the new scope", async () => {
    const requested = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    const created = workspaceSessionRecord("old-chat", { externalSessionId: null });
    const opened: WorkspaceSession[] = [];
    const { view, connection } = renderCreate(
      {
        workspaceSessionCreate: async () => {
          requested.resolve();
          await finish.promise;
          return { session: created };
        },
      },
      (record) => {
        opened.push(record);
      },
    );
    await waitForExpectation(() => expect(view.result.current.input).not.toBeNull());
    act(() => view.result.current.submit());
    await requested.promise;
    view.rerender({
      workspace: { workspaceId: "workspace-2", repoPath: "/repos/beta" },
      model: MODEL,
    });
    await act(async () => {
      finish.resolve();
    });
    await waitForExpectation(() => expect(view.result.current.create.isSuccess).toBe(true));
    expect(opened).toEqual([]);
    const attempt = connection.startupAttempts.getSnapshot()[0];
    expect(attempt?.origin.workspaceId).toBe(WORKSPACE.workspaceId);
    expect(attempt?.ownership.state).toBe("saved");
    expect(attempt?.status.phase).toBe("ready");
    view.unmount();
    await connection.dispose();
  });

  test("waits for roles, then creates a current checkout chat once with its name and role", async () => {
    const requests: WorkspaceSessionCreateInput[] = [];
    const created = workspaceSessionRecord("chat-1", { externalSessionId: null });
    const createdSessions: WorkspaceSession[] = [];
    let finish: () => void = () => {};
    const { view, connection } = renderCreate(
      {
        workspaceSessionCreate: async (input) => {
          requests.push(input);
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
          return { session: created };
        },
      },
      (session) => createdSessions.push(session),
    );
    expect(view.result.current.input).toBeNull();
    await waitForExpectation(() => expect(view.result.current.roles.isSuccess).toBe(true));
    await waitForExpectation(() =>
      expect(view.result.current.targetBranch).toEqual(DEFAULT_TARGET),
    );
    act(() => {
      view.result.current.setName("Fix login");
      view.result.current.setRoleId(ROLE.id);
    });
    expect(view.result.current.input).toEqual({
      workspaceId: WORKSPACE.workspaceId,
      runtimeKind: "codex",
      selectedModel: SELECTION,
      customAgentRoleId: ROLE.id,
      location: "local_repo_root",
      manualTitle: "Fix login",
      targetBranch: DEFAULT_TARGET,
    });
    act(() => view.result.current.submit());
    await waitForExpectation(() => expect(view.result.current.create.isPending).toBe(true));
    // A pending create ignores another submit.
    act(() => view.result.current.submit());
    await act(async () => finish());
    await waitForExpectation(() =>
      expect(createdSessions).toEqual([{ ...created, externalSessionId: "native-chat-1" }]),
    );
    expect(requests).toHaveLength(1);
    view.unmount();
    await connection.dispose();
  });

  test("sends the picked target, and a worktree location drops a Tracked upstream pick", async () => {
    const { view, connection } = renderCreate({});
    await waitForExpectation(() =>
      expect(view.result.current.targetBranch).toEqual(DEFAULT_TARGET),
    );
    act(() => view.result.current.pickTarget({ branch: "@{upstream}" }));
    await waitForExpectation(() =>
      expect(view.result.current.input?.targetBranch).toEqual({ branch: "@{upstream}" }),
    );
    act(() => view.result.current.selectLocation("local_worktree"));
    expect(view.result.current.targetBranch).toEqual(DEFAULT_TARGET);
    act(() => view.result.current.pickTarget({ remote: "origin", branch: "release" }));
    act(() => view.result.current.selectLocation("local_repo_root"));
    expect(view.result.current.targetBranch).toEqual({ remote: "origin", branch: "release" });
    view.unmount();
    await connection.dispose();
  });

  test("creates one chat for a double tap that comes before the pending state renders", async () => {
    const requests: WorkspaceSessionCreateInput[] = [];
    const created = workspaceSessionRecord("chat-1", { externalSessionId: null });
    const createdSessions: WorkspaceSession[] = [];
    const { view, connection } = renderCreate(
      {
        workspaceSessionCreate: async (input) => {
          requests.push(input);
          return { session: created };
        },
      },
      (session) => createdSessions.push(session),
    );
    await waitForExpectation(() => expect(view.result.current.input).not.toBeNull());
    act(() => {
      view.result.current.submit();
      view.result.current.submit();
      view.result.current.submit();
    });
    await waitForExpectation(() =>
      expect(createdSessions).toEqual([{ ...created, externalSessionId: "native-chat-1" }]),
    );
    expect(requests).toHaveLength(1);
    view.unmount();
    await connection.dispose();
  });

  test("sends no role for None and reads the branches once for the target and worktree", async () => {
    const branchReads: string[] = [];
    const branches: GitBranch[] = [{ name: "main", isCurrent: true, isRemote: false }];
    const { view, connection } = renderCreate({
      gitGetBranches: async (repoPath) => {
        branchReads.push(repoPath);
        return branches;
      },
    });
    await waitForExpectation(() => expect(view.result.current.roles.isSuccess).toBe(true));
    await waitForExpectation(() => expect(view.result.current.branches.isSuccess).toBe(true));
    await waitForExpectation(() => expect(view.result.current.input).not.toBeNull());
    expect(view.result.current.roleId).toBe(NO_CUSTOM_AGENT_ROLE);
    expect(view.result.current.input?.customAgentRoleId).toBeNull();
    act(() => view.result.current.selectLocation("local_worktree"));
    expect(view.result.current.input).toBeNull();
    act(() =>
      view.result.current.changeWorktree({
        mode: "from_branch",
        name: "login",
        branchName: "main",
      }),
    );
    const input = view.result.current.input;
    expect(input?.location === "local_worktree" ? input.worktree : null).toEqual({
      mode: "from_branch",
      name: "login",
      branchName: "main",
    });
    expect(branchReads).toEqual([WORKSPACE.repoPath]);
    view.unmount();
    await connection.dispose();
  });

  test("shows a host worktree validation error and marks the branch list stale", async () => {
    const { view, connection } = renderCreate({
      gitGetBranches: async () => [{ name: "main", isCurrent: true, isRemote: false }],
      workspaceSessionCreate: async () => {
        throw new HostInvokeError("The branch is checked out elsewhere.", {
          kind: "workspace_session_validation",
          field: "worktree.branchName",
        });
      },
    });
    await waitForExpectation(() => expect(view.result.current.roles.isSuccess).toBe(true));
    act(() => {
      view.result.current.selectLocation("local_worktree");
      view.result.current.changeWorktree({ mode: "from_branch", name: "main", branchName: "main" });
    });
    await waitForExpectation(() => expect(view.result.current.input).not.toBeNull());
    act(() => view.result.current.submit());
    await waitForExpectation(() =>
      expect(view.result.current.worktreeError).toEqual({
        field: "worktree.branchName",
        message: "The branch is checked out elsewhere.",
      }),
    );
    // The branch list is marked stale, so the next read shows the current worktrees.
    expect(
      connection.queryClient.getQueryState(gitQueryKeys.branches(WORKSPACE.repoPath))
        ?.isInvalidated,
    ).toBe(true);
    act(() => view.result.current.selectLocation("local_repo_root"));
    expect(view.result.current.worktreeError).toBeNull();
    view.unmount();
    await connection.dispose();
  });
});
