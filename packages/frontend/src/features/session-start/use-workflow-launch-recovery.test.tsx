import { expect, mock, spyOn, test } from "bun:test";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { toast, type Action } from "sonner";
import type { WorkflowLaunchSnapshot } from "@openducktor/contracts";
import {
  configureShellBridge,
  createUnavailableShellBridge,
  getShellBridge,
  type RunEventListener,
} from "@/lib/shell-bridge";
import { ActiveWorkspaceContext, TaskSnapshotContext } from "@/state/app-state-contexts";
import { createTaskCardFixture } from "@/test-utils/shared-test-fixtures";
import { useWorkflowLaunchRecovery } from "./use-workflow-launch-recovery";

test("restores a retry toast after reload and removes its action when acceptance becomes unknown", async () => {
  const originalBridge = getShellBridge();
  const bridge = createUnavailableShellBridge();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let listener: RunEventListener = () => {};
  const unsubscribe = mock(() => {});
  bridge.subscribeRunEvents = mock(async (next) => {
    listener = next;
    return unsubscribe;
  });
  const failed: WorkflowLaunchSnapshot = {
    workspaceId: "workspace",
    repoPath: "/repo",
    taskId: "task",
    launchAttemptId: "retained",
    role: "build",
    phase: "failed",
    acceptance: "rejected",
    ownershipSaved: true,
    recoveryAllowed: true,
    failure: { message: "Exact failure after browser closed", stage: "send", cleanupErrors: [] },
    completedPreStartActions: [],
    session: {
      externalSessionId: "saved",
      runtimeKind: "codex",
      workingDirectory: "/worktree",
      startedAt: "2026-10-04T00:00:00Z",
      status: "idle",
    },
  };
  bridge.client.agentSessionWorkflowLaunchRead = mock(async () => [failed]);
  bridge.client.agentSessionWorkflowLaunchRecover = mock(
    async (): Promise<WorkflowLaunchSnapshot> => ({
      ...failed,
      phase: "completed",
      acceptance: "accepted",
      recoveryAllowed: false,
      failure: undefined,
    }),
  );
  const showError = spyOn(toast, "error").mockImplementation(() => "toast");
  const dismiss = spyOn(toast, "dismiss").mockImplementation(() => "toast");
  configureShellBridge(bridge);
  const task = createTaskCardFixture({ id: "task" });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>
      <ActiveWorkspaceContext
        value={{
          activeWorkspace: {
            workspaceId: "workspace",
            workspaceName: "Workspace",
            repoPath: "/repo",
          },
          setActiveWorkspace: () => {},
        }}
      >
        <TaskSnapshotContext value={{ tasks: [task], isLoadingTasks: false }}>
          {children}
        </TaskSnapshotContext>
      </ActiveWorkspaceContext>
    </QueryClientProvider>
  );
  let unmount: (() => void) | undefined;
  try {
    const view = renderHook(useWorkflowLaunchRecovery, { wrapper });
    unmount = view.unmount;
    await waitFor(() => expect(showError).toHaveBeenCalledTimes(1));
    expect(showError.mock.calls[0]![0]).toContain("task");
    const options = showError.mock.calls[0]![1]!;
    expect(options.description).toBe("Exact failure after browser closed");
    expect(options.action).toEqual(expect.objectContaining({ label: "Retry message" }));
    // SAFETY: The assertion above checks the action shape. The recovery callback takes no event argument.
    const action = options.action as Action & { onClick(): void };
    action.onClick();
    await waitFor(() => expect(dismiss).toHaveBeenCalledWith(options.id));
    expect(bridge.client.agentSessionWorkflowLaunchRecover).toHaveBeenCalledWith({
      workspaceId: "workspace",
      repoPath: "/repo",
      taskId: "task",
      launchAttemptId: "retained",
    });
    act(() =>
      listener({
        type: "workflow_launch_updated",
        snapshot: JSON.stringify({ ...failed, acceptance: "unknown", recoveryAllowed: false }),
      }),
    );
    expect(showError.mock.calls.at(-1)![1]).toEqual(
      expect.objectContaining({
        id: options.id,
        description: expect.stringContaining(
          "Runtime acceptance is unknown. Inspect the saved session before sending another instruction.",
        ),
        action: undefined,
      }),
    );
    expect(showError.mock.calls.at(-1)![1]?.description).toContain(
      "Exact failure after browser closed",
    );
    unmount?.();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  } finally {
    unmount?.();
    queryClient.clear();
    configureShellBridge(originalBridge);
    showError.mockRestore();
    dismiss.mockRestore();
  }
});
