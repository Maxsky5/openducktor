import { describe, expect, mock, test } from "bun:test";
import {
  createDefaultNotificationSettings,
  type NotificationOsCapability,
} from "@openducktor/contracts";
import type { PropsWithChildren } from "react";
import {
  createBridge,
  workflowClosedOccurrence,
} from "@/features/notifications/notification-runtime.test-support";
import {
  configureShellBridge,
  createUnavailableShellBridge,
  getShellBridge,
  type NotificationBridge,
  type ShellBridge,
} from "@/lib/shell-bridge";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import type { WorkspaceStateContextValue } from "@/types/state-slices";
import { WorkspaceStateContext } from "../app-state-contexts";
import { useNotificationContext } from "../notifications/notification-context";
import { NotificationProvider } from "./notification-provider";

describe("notification permission recovery", () => {
  test.each([
    ["denied", "failed"],
    ["denied", "throw"],
    ["failed", "failed"],
    ["failed", "throw"],
  ] as const)(
    "Test OS clears a denial and keeps real failures: prior %s, test delivery %s",
    async (status, delivery) => {
      const h = createHarness(status);
      try {
        await h.mount();
        const failure = h.hook.getLatest().deliveryFailure;
        h.showOsNotification.mockImplementation(async () => {
          if (delivery === "throw") throw new Error("Test delivery failed.");
          return { status: "failed", message: "Test delivery failed." };
        });
        const settings = createDefaultNotificationSettings();
        settings.volumePercent = 0;
        await h.hook.run(async (context) => {
          if (delivery === "throw") {
            await expect(context.testOs(settings)).rejects.toThrow("Test delivery failed.");
          } else {
            expect(await context.testOs(settings)).toEqual({
              status: "failed",
              message: "Test delivery failed.",
            });
          }
        });
        expect(h.hook.getLatest().deliveryFailure).toBe(status === "denied" ? null : failure);
      } finally {
        await h.close();
      }
    },
  );

  test.each(["denied", "failed"] as const)(
    "granting permission clears only a denial when OS delivery was %s",
    async (status) => {
      const h = createHarness(status);
      try {
        await h.mount();
        const failure = h.hook.getLatest().deliveryFailure;
        await h.hook.run(async (context) => {
          expect((await context.requestPermission()).permission).toBe("granted");
        });
        expect(h.hook.getLatest().deliveryFailure).toBe(status === "denied" ? null : failure);
        expect(h.showOsNotification).toHaveBeenCalledTimes(1);
      } finally {
        await h.close();
      }
    },
  );

  test("a cleared denial does not return after a coordination error recovers", async () => {
    const h = createHarness("denied");
    try {
      await h.mount();
      await h.hook.run(() => h.failStream());
      expect(h.hook.getLatest().deliveryFailure?.channel).toBe("coordination");
      const failure = h.hook.getLatest().deliveryFailure;
      await h.hook.run(async (context) => {
        await context.requestPermission();
      });
      expect(h.hook.getLatest().deliveryFailure).toBe(failure);
      await h.hook.run(() => h.recoverStream());
      expect(h.hook.getLatest().deliveryFailure).toBeNull();
      expect(h.showOsNotification).toHaveBeenCalledTimes(1);
    } finally {
      await h.close();
    }
  });

  test.each(["denied", "prompt", "throw"] as const)(
    "keeps the denial when the permission request returns %s",
    async (permission) => {
      const h = createHarness("denied", permission);
      try {
        await h.mount();
        const failure = h.hook.getLatest().deliveryFailure;
        await h.hook.run(async (context) => {
          if (permission === "throw") {
            await expect(context.requestPermission()).rejects.toThrow("Permission request failed.");
          } else {
            expect((await context.requestPermission()).permission).toBe(permission);
          }
        });
        expect(h.hook.getLatest().deliveryFailure).toBe(failure);
        expect(h.showOsNotification).toHaveBeenCalledTimes(1);
      } finally {
        await h.close();
      }
    },
  );
});

const createHarness = (
  status: "denied" | "failed",
  permission: "granted" | "denied" | "prompt" | "throw" = "granted",
) => {
  const previousBridge = getShellBridge();
  const showOsNotification = mock(async () => ({
    status,
    message: "OS delivery is blocked.",
  }));
  let onOccurrence: Parameters<NotificationBridge["subscribeOccurrences"]>[0] | undefined;
  let onFrame: Parameters<ShellBridge["subscribeNotificationStream"]>[1] | undefined;
  let onStreamFailure: Parameters<ShellBridge["subscribeNotificationStream"]>[2] | undefined;
  configureShellBridge({
    ...createUnavailableShellBridge(),
    notifications: createBridge({
      showOsNotification,
      requestPermission: async (): Promise<NotificationOsCapability> => {
        if (permission === "throw") throw new Error("Permission request failed.");
        return {
          platform: "browser",
          supported: true,
          permission,
          canGuaranteeSilent: true,
          canOpenSystemSettings: false,
        };
      },
      subscribeOccurrences(listener) {
        onOccurrence = listener;
        return () => {};
      },
    }),
    subscribeNotificationStream: async (_input, listener, onFailure) => {
      onFrame = listener;
      onStreamFailure = onFailure;
      return () => {};
    },
  });
  const workspace = createWorkspaceState();
  const wrapper = ({ children }: PropsWithChildren) => (
    <WorkspaceStateContext.Provider value={workspace}>
      <NotificationProvider>{children}</NotificationProvider>
    </WorkspaceStateContext.Provider>
  );
  const hook = createHookHarness(useNotificationContext, undefined, {
    wrapper,
  });
  return {
    hook,
    showOsNotification,
    async mount(): Promise<void> {
      await hook.mount();
      const settings = createDefaultNotificationSettings();
      settings.volumePercent = 0;
      settings.kinds["workflow.closed"].target = "os";
      await hook.run(() => {
        if (!onOccurrence) throw new Error("Notification listener is missing.");
        onOccurrence(workflowClosedOccurrence("blocked"), settings);
      });
      await hook.waitFor((context) => context.deliveryFailure?.osStatus === status, 500);
    },
    failStream(): void {
      if (!onStreamFailure) throw new Error("Notification stream listener is missing.");
      onStreamFailure(new Error("Notification stream failed."));
    },
    recoverStream(): void {
      if (!onFrame) throw new Error("Notification stream listener is missing.");
      onFrame({
        type: "attached",
        reason: "replay",
        cursor: { epoch: "epoch", sequence: 0 },
        health: [],
      });
    },
    async close(): Promise<void> {
      try {
        await hook.unmount();
      } finally {
        configureShellBridge(previousBridge);
      }
    },
  };
};

const unused = async (): Promise<never> => {
  throw new Error("Unexpected workspace operation.");
};

const createWorkspaceState = (): WorkspaceStateContextValue => ({
  isSwitchingWorkspace: false,
  isLoadingBranches: false,
  isSwitchingBranch: false,
  branchSyncDegraded: false,
  workspaces: [],
  closedWorkspaces: [],
  incompleteRemovals: [],
  activeWorkspace: null,
  branches: [],
  activeBranch: null,
  addWorkspace: unused,
  saveWorkspaceModelDefaults: unused,
  selectWorkspace: unused,
  closeWorkspace: unused,
  removeWorkspace: unused,
  reopenWorkspace: unused,
  resolveWorkspacePath: unused,
  reorderWorkspaces: unused,
  refreshBranches: unused,
  switchBranch: unused,
  loadRepoSettings: unused,
  saveRepoSettings: unused,
  loadSettingsSnapshot: unused,
  detectGithubRepository: unused,
  saveGlobalGitConfig: unused,
  saveSettingsSnapshot: unused,
  saveAgentModelFavorites: unused,
});
