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
    },
  });
  const wrapper = ({ children }: PropsWithChildren): ReactElement =>
    createElement(ClientConnectionProvider, { connection }, children);
  const view = renderHook(
    () => useWorkspaceSessionCreate({ workspace: WORKSPACE, model: MODEL, onCreated }),
    { wrapper },
  );
  return { view, connection };
};

describe("useWorkspaceSessionCreate", () => {
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
    await waitForExpectation(() => expect(createdSessions).toEqual([created]));
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
    await waitForExpectation(() => expect(createdSessions).toEqual([created]));
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
