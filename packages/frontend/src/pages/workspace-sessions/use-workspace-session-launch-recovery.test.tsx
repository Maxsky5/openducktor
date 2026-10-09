import { expect, mock, spyOn, test } from "bun:test";
import type { WorkspaceSessionLaunchSnapshot } from "@openducktor/contracts";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { toast, type Action } from "sonner";
import {
  configureShellBridge,
  createUnavailableShellBridge,
  type RunEventListener,
} from "@/lib/shell-bridge";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { useWorkspaceSessionLaunchRecovery } from "./use-workspace-session-launch-recovery";

test("reopen and reconnect show the retained failure and retry only on request", async () => {
  const workspace = { workspaceId: "workspace", repoPath: "/repo", workspaceName: "Workspace" };
  const failed: WorkspaceSessionLaunchSnapshot = {
    workspaceId: workspace.workspaceId,
    repoPath: workspace.repoPath,
    sessionId: "saved",
    launchAttemptId: "attempt",
    phase: "failed",
    acceptance: "rejected",
    ownershipSaved: true,
    recoveryAllowed: true,
    failure: { message: "Exact native rejection", stage: "send", cleanupErrors: [] },
  };
  let retained = failed;
  const read = mock(async () => [retained]);
  const recover = mock(async () => ({
    ...failed,
    phase: "completed" as const,
    failure: undefined,
  }));
  const launch = mock(async () => {
    throw new Error("Unexpected launch");
  });
  let listener: RunEventListener = () => {};
  const stopped = mock(() => {});
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        workspaceSessionLaunchRead: read,
        workspaceSessionLaunchRecover: recover,
        workspaceSessionLaunch: launch,
      },
      bridge: {
        subscribeRunEvents: async (next) => {
          listener = next;
          return stopped;
        },
      },
    }),
  );
  const failure = spyOn(toast, "error").mockImplementation(() => "toast");
  const dismiss = spyOn(toast, "dismiss").mockImplementation(() => "toast");
  const client = new QueryClient();
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const view = renderHook(() => useWorkspaceSessionLaunchRecovery(workspace, "saved", "Chat"), {
    wrapper,
  });
  try {
    await act(async () => {
      await Promise.resolve();
    });
    expect(read).toHaveBeenCalledWith({
      workspaceId: "workspace",
      repoPath: "/repo",
      sessionId: "saved",
    });
    expect(failure).toHaveBeenCalledWith(
      'Could not send to "Chat"',
      expect.objectContaining({
        description: "Exact native rejection",
        action: expect.objectContaining({ label: "Retry message" }),
      }),
    );
    expect(recover).not.toHaveBeenCalled();
    await act(async () => {
      listener({ __openducktorBrowserLive: true, kind: "reconnected", transportEpoch: "next" });
    });
    expect(read).toHaveBeenCalledTimes(2);
    expect(recover).not.toHaveBeenCalled();
    const action = failure.mock.calls[0]?.[1]?.action;
    // SAFETY: The presenter supplies an Action with a callback that takes no arguments.
    const retry = (action as Action).onClick as () => void;
    expect(retry).toEqual(expect.any(Function));
    await act(async () => {
      retry();
    });
    expect(recover).toHaveBeenCalledWith({
      workspaceId: "workspace",
      repoPath: "/repo",
      sessionId: "saved",
      launchAttemptId: "attempt",
    });
    expect(launch).not.toHaveBeenCalled();
    await act(async () => {
      listener({
        type: "workspace_session_launch_updated",
        snapshot: JSON.stringify({ ...failed, acceptance: "unknown", recoveryAllowed: false }),
      });
    });
    expect(failure.mock.calls.at(-1)).toEqual([
      'Could not send to "Chat"',
      expect.objectContaining({
        description:
          "Exact native rejection Inspect the saved session before sending another instruction.",
        action: undefined,
      }),
    ]);
    retained = { ...failed, phase: "canceled", recoveryAllowed: false };
    await act(async () => {
      listener({ type: "workspace_session_launch_updated", snapshot: JSON.stringify(retained) });
    });
    expect(dismiss).toHaveBeenCalledWith(failure.mock.calls[0]?.[1]?.id);
    dismiss.mockClear();
    await act(async () => {
      listener({ __openducktorBrowserLive: true, kind: "reconnected", transportEpoch: "retired" });
    });
    expect(dismiss).toHaveBeenCalledWith(failure.mock.calls[0]?.[1]?.id);
    expect(read).toHaveBeenCalledTimes(3);
    expect(recover).toHaveBeenCalledTimes(1);
  } finally {
    view.unmount();
    expect(stopped).toHaveBeenCalledTimes(1);
    client.clear();
    failure.mockRestore();
    dismiss.mockRestore();
    configureShellBridge(createUnavailableShellBridge());
  }
});
