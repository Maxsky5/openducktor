import { describe, expect, mock, test } from "bun:test";
import type { WorkspaceRecord } from "@openducktor/contracts";
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { host } from "./host";
import { useWorkspaceOperations } from "./use-workspace-operations";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

type HookArgs = Parameters<typeof useWorkspaceOperations>[0];

const createHookHarness = (initialArgs: HookArgs) => {
  let latest: ReturnType<typeof useWorkspaceOperations> | null = null;

  const Harness = ({ args }: { args: HookArgs }) => {
    latest = useWorkspaceOperations(args);
    return null;
  };

  let renderer: TestRenderer.ReactTestRenderer | null = null;

  return {
    mount: async () => {
      await act(async () => {
        renderer = TestRenderer.create(createElement(Harness, { args: initialArgs }));
      });
      await flush();
    },
    run: async (fn: (value: ReturnType<typeof useWorkspaceOperations>) => Promise<void> | void) => {
      if (!latest) {
        throw new Error("Hook not mounted");
      }
      await act(async () => {
        await fn(latest as ReturnType<typeof useWorkspaceOperations>);
      });
      await flush();
    },
    getLatest: () => {
      if (!latest) {
        throw new Error("Hook not mounted");
      }
      return latest;
    },
    unmount: async () => {
      await act(async () => {
        renderer?.unmount();
      });
      renderer = null;
    },
  };
};

const workspace = (path: string, isActive = false): WorkspaceRecord => ({
  path,
  isActive,
  hasConfig: true,
  configuredWorktreeBasePath: null,
});

describe("use-workspace-operations", () => {
  test("refreshWorkspaces updates list and active repo", async () => {
    const setActiveRepo = mock(() => {});
    const workspaceList = mock(
      async (): Promise<WorkspaceRecord[]> => [workspace("/repo-a"), workspace("/repo-b", true)],
    );

    const original = { workspaceList: host.workspaceList };
    host.workspaceList = workspaceList;

    const harness = createHookHarness({
      activeRepo: null,
      setActiveRepo,
      clearTaskData: () => {},
      clearActiveBeadsCheck: () => {},
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.refreshWorkspaces();
      });

      expect(harness.getLatest().workspaces).toHaveLength(2);
      expect(setActiveRepo).toHaveBeenCalledWith("/repo-b");
    } finally {
      await harness.unmount();
      host.workspaceList = original.workspaceList;
    }
  });

  test("addWorkspace trims path then refreshes", async () => {
    const setActiveRepo = mock(() => {});
    const workspaceAdd = mock(async (): Promise<WorkspaceRecord> => workspace("/repo-new"));
    const workspaceList = mock(
      async (): Promise<WorkspaceRecord[]> => [workspace("/repo-new", true)],
    );

    const original = {
      workspaceAdd: host.workspaceAdd,
      workspaceList: host.workspaceList,
    };
    host.workspaceAdd = workspaceAdd;
    host.workspaceList = workspaceList;

    const harness = createHookHarness({
      activeRepo: null,
      setActiveRepo,
      clearTaskData: () => {},
      clearActiveBeadsCheck: () => {},
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.addWorkspace("  /repo-new  ");
      });

      expect(workspaceAdd).toHaveBeenCalledWith("/repo-new");
      expect(workspaceList).toHaveBeenCalled();
    } finally {
      await harness.unmount();
      host.workspaceAdd = original.workspaceAdd;
      host.workspaceList = original.workspaceList;
    }
  });

  test("selectWorkspace clears state and triggers runtime ensure", async () => {
    const setActiveRepo = mock(() => {});
    const clearTaskData = mock(() => {});
    const clearActiveBeadsCheck = mock(() => {});
    const workspaceSelect = mock(async (): Promise<WorkspaceRecord> => workspace("/repo-a", true));
    const runtimeEnsure = mock(async () => ({
      runtimeId: "runtime-1",
      repoPath: "/repo-a",
      taskId: "task-1",
      role: "build",
      workingDirectory: "/tmp/repo-a",
      port: 3030,
      startedAt: "2026-02-22T08:00:00.000Z",
    }));
    const workspaceList = mock(
      async (): Promise<WorkspaceRecord[]> => [workspace("/repo-a", true)],
    );

    const original = {
      workspaceSelect: host.workspaceSelect,
      opencodeRepoRuntimeEnsure: host.opencodeRepoRuntimeEnsure,
      workspaceList: host.workspaceList,
    };
    host.workspaceSelect = workspaceSelect;
    host.opencodeRepoRuntimeEnsure = runtimeEnsure;
    host.workspaceList = workspaceList;

    const harness = createHookHarness({
      activeRepo: null,
      setActiveRepo,
      clearTaskData,
      clearActiveBeadsCheck,
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.selectWorkspace("/repo-a");
      });

      expect(setActiveRepo).toHaveBeenCalledWith("/repo-a");
      expect(clearTaskData).toHaveBeenCalled();
      expect(clearActiveBeadsCheck).toHaveBeenCalled();
      expect(workspaceSelect).toHaveBeenCalledWith("/repo-a");
      expect(runtimeEnsure).toHaveBeenCalledWith("/repo-a");
    } finally {
      await harness.unmount();
      host.workspaceSelect = original.workspaceSelect;
      host.opencodeRepoRuntimeEnsure = original.opencodeRepoRuntimeEnsure;
      host.workspaceList = original.workspaceList;
    }
  });
});
