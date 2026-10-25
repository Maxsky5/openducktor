import "../test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import type { GitCheck, PathCheck, TaskStoreCheck } from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type PropsWithChildren, type ReactElement } from "react";
import { ClientConnectionProvider } from "../connection/client-connection-react";
import { createTaskStoreCheckFixture } from "../test-support/shared-test-fixtures";
import { createTestClientConnection } from "../test-support/test-client-connection";
import type { ActiveWorkspace } from "../types/session-slices";
import { useDiagnosticsChecks } from "./use-diagnostics-checks";

const WORKSPACE: ActiveWorkspace = {
  workspaceId: "repo-a",
  workspaceName: "Repo A",
  repoPath: "/repo-a",
};

const GIT: GitCheck = {
  ok: true,
  executablePath: "/bin/git",
  version: "git version 2.50.1",
  error: null,
};

type HostCalls = { path: boolean[]; git: number; taskStore: string[]; runtime: number };

const setup = (activeWorkspace: ActiveWorkspace | null, client: Partial<HostClient> = {}) => {
  const calls: HostCalls = { path: [], git: 0, taskStore: [], runtime: 0 };
  const connection = createTestClientConnection({
    client: {
      pathCheck: async (force = false): Promise<PathCheck> => {
        calls.path.push(force);
        return { ok: true, error: null };
      },
      gitCheck: async (): Promise<GitCheck> => {
        calls.git += 1;
        return GIT;
      },
      taskStoreCheck: async (repoPath: string): Promise<TaskStoreCheck> => {
        calls.taskStore.push(repoPath);
        return createTaskStoreCheckFixture();
      },
      ...client,
    },
  });
  const wrapper = ({ children }: PropsWithChildren): ReactElement =>
    createElement(ClientConnectionProvider, { connection }, children);
  const refreshHostRuntimeStatus = async (): Promise<void> => {
    calls.runtime += 1;
  };
  return {
    calls,
    render: () => renderChecks(activeWorkspace, refreshHostRuntimeStatus, wrapper),
  };
};

const renderChecks = (
  activeWorkspace: ActiveWorkspace | null,
  refreshHostRuntimeStatus: () => Promise<void>,
  wrapper: (props: PropsWithChildren) => ReactElement,
) =>
  renderHook(() => useDiagnosticsChecks({ activeWorkspace, refreshHostRuntimeStatus }), {
    wrapper,
  });

describe("useDiagnosticsChecks", () => {
  test("reads PATH, Git, and the task store of the workspace from the host", async () => {
    const { calls, render } = setup(WORKSPACE);
    const { result } = render();

    await waitFor(() => {
      expect(result.current.taskStoreCheck.data).not.toBeNull();
    });
    await waitFor(() => {
      expect(result.current.gitCheck.data).toEqual(GIT);
    });
    expect(result.current.pathCheck).toMatchObject({
      data: { ok: true, error: null },
      error: null,
      failureKind: null,
    });
    expect(result.current.pathCheck.observedAt).not.toBeNull();
    expect(result.current.checksRepoPath).toBe("/repo-a");
    expect(calls.path).toEqual([false]);
    expect(calls.taskStore).toEqual(["/repo-a"]);
  });

  test("without a workspace, the task store is not read", async () => {
    const { calls, render } = setup(null);
    const { result } = render();

    await waitFor(() => {
      expect(result.current.gitCheck.data).toEqual(GIT);
    });
    expect(result.current.checksRepoPath).toBeNull();
    expect(result.current.taskStoreCheck).toEqual({
      data: null,
      error: null,
      failureKind: null,
      observedAt: null,
    });
    expect(calls.taskStore).toEqual([]);
  });

  test("a failed read reports its message as an error", async () => {
    const { render } = setup(null, {
      gitCheck: async () => {
        throw new Error("Git did not answer.");
      },
    });
    const { result } = render();

    await waitFor(() => {
      expect(result.current.gitCheck.error).toBe("Git did not answer.");
    });
    expect(result.current.gitCheck).toMatchObject({
      data: null,
      failureKind: "error",
      observedAt: null,
    });
  });

  test("refresh reads the runtime status and every check again", async () => {
    const { calls, render } = setup(WORKSPACE);
    const { result } = render();
    await waitFor(() => {
      expect(result.current.taskStoreCheck.data).not.toBeNull();
    });

    await act(async () => {
      await result.current.refreshChecks();
    });

    expect(calls.runtime).toBe(1);
    expect(calls.path).toEqual([false, true]);
    expect(calls.git).toBe(2);
    expect(calls.taskStore).toEqual(["/repo-a", "/repo-a"]);
    expect(result.current.isRefreshingChecks).toBe(false);
  });
});
