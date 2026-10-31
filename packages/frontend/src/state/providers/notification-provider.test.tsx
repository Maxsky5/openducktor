import { describe, expect, mock, spyOn, test } from "bun:test";
import {
  type NotificationOccurrence,
  type NotificationOsCapability,
  type NotificationOsDeliveryRequest,
} from "@openducktor/contracts";
import { waitFor } from "@testing-library/react";
import * as cuelume from "cuelume";
import type { PropsWithChildren } from "react";
import { toast } from "sonner";
import {
  createBridge,
  workflowClosedOccurrence,
} from "@openducktor/frontend-core/notifications/notification-runtime.test-support";
import type { HostConnection } from "@openducktor/frontend-core/connection/host-connection";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { type NotificationBridge } from "@openducktor/frontend-core/platform/notification-bridge";
import { createHookHarness } from "@openducktor/frontend-core/test-support/react-hook-harness";
import {
  createTestClientConnection,
  createTestHostConnection,
} from "@openducktor/frontend-core/test-support/test-client-connection";
import type { WorkspaceStateContextValue } from "@/types/state-slices";
import { WorkspaceStateContext } from "../app-state-contexts";
import { useNotificationContext } from "../notifications/notification-context";
import { NotificationProvider } from "./notification-provider";
import { createBuiltinNotificationSettings } from "@openducktor/workflows";
import { createWorkspaceRecordFixture } from "@/test-utils/shared-test-fixtures";

test("startup feedback suppresses only its in-app Started toast through publication echoes", async () => {
  const settings = createBuiltinNotificationSettings();
  settings.volumePercent = 17;
  settings.osFocus = "always_send";
  settings.soundFocus = "always_play";
  settings.kinds["agent.session_started"] = { enabled: true, target: "both", sound: "chime" };
  const playSound = spyOn(cuelume, "play").mockImplementation(() => {});
  const showOsNotification = mock(async (_request: NotificationOsDeliveryRequest) => ({
    status: "shown" as const,
  }));
  let onFrame: Parameters<HostConnection["subscribeNotificationStream"]>[1] = () => {};
  let onOccurrence: Parameters<NotificationBridge["subscribeOccurrences"]>[0] = () => {};
  let sequence = 0;
  configureShellBridge({
    ...createUnavailableShellBridge(),
    notifications: createBridge({
      showOsNotification,
      subscribeOccurrences: (listener) => {
        onOccurrence = listener;
        return () => {};
      },
      publishOccurrence: async (occurrence, selectedSettings) => {
        onOccurrence(occurrence, selectedSettings);
        return { occurrence, settings: selectedSettings };
      },
    }),
  });
  const connection = createTestClientConnection({
    host: createTestHostConnection({
      subscribeNotificationStream: async (_input, listener) => {
        onFrame = listener;
        return () => {};
      },
      client: {
        notificationPublishAction: async (occurrence: NotificationOccurrence) => {
          const selected = { occurrence, settings, preferenceRevision: 1 };
          onFrame({
            type: "occurrence",
            cursor: { epoch: "epoch", sequence: ++sequence },
            selected,
          });
          return selected;
        },
      },
    }),
  });
  const workspace = createWorkspaceState();
  const record = createWorkspaceRecordFixture();
  workspace.workspaces = [record];
  const wrapper = ({ children }: PropsWithChildren) => (
    <ClientConnectionProvider connection={connection}>
      <WorkspaceStateContext value={workspace}>
        <NotificationProvider>{children}</NotificationProvider>
      </WorkspaceStateContext>
    </ClientConnectionProvider>
  );
  const hook = createHookHarness(useNotificationContext, undefined, { wrapper });
  try {
    await hook.mount();
    for (const inAppFeedbackHandled of [true, false]) {
      const count = showOsNotification.mock.calls.length + 1;
      await hook.run((context) => {
        context.sessionStartNotifications.publishSessionStarted({
          launchAttemptId: crypto.randomUUID(),
          workspaceId: record.workspaceId,
          taskId: "task-1",
          role: "build",
          inAppFeedbackHandled,
          session: {
            externalSessionId: "session-1",
            runtimeKind: "codex",
            workingDirectory: "/repo/worktree",
          },
        });
      });
      await waitFor(() => expect(showOsNotification).toHaveBeenCalledTimes(count), {
        timeout: 500,
      });
      const occurrenceId = showOsNotification.mock.calls[count - 1]?.[0].occurrenceId;
      expect(toast.getHistory().some((entry) => entry.id === occurrenceId)).toBe(
        !inAppFeedbackHandled,
      );
      expect(playSound).toHaveBeenCalledTimes(count);
    }
  } finally {
    for (const [request] of showOsNotification.mock.calls) toast.dismiss(request.occurrenceId);
    await hook.unmount();
    await connection.dispose();
    configureShellBridge(createUnavailableShellBridge());
    playSound.mockRestore();
  }
});

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
        const settings = createBuiltinNotificationSettings();
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
  const showOsNotification = mock(async () => ({
    status,
    message: "OS delivery is blocked.",
  }));
  let onOccurrence: Parameters<NotificationBridge["subscribeOccurrences"]>[0] | undefined;
  let onFrame: Parameters<HostConnection["subscribeNotificationStream"]>[1] | undefined;
  let onStreamFailure: Parameters<HostConnection["subscribeNotificationStream"]>[2] | undefined;
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
  });
  const connection = createTestClientConnection({
    host: createTestHostConnection({
      subscribeNotificationStream: async (_input, listener, onFailure) => {
        onFrame = listener;
        onStreamFailure = onFailure;
        return () => {};
      },
    }),
  });
  const workspace = createWorkspaceState();
  const wrapper = ({ children }: PropsWithChildren) => (
    <ClientConnectionProvider connection={connection}>
      <WorkspaceStateContext.Provider value={workspace}>
        <NotificationProvider>{children}</NotificationProvider>
      </WorkspaceStateContext.Provider>
    </ClientConnectionProvider>
  );
  const hook = createHookHarness(useNotificationContext, undefined, {
    wrapper,
  });
  return {
    hook,
    showOsNotification,
    async mount(): Promise<void> {
      await hook.mount();
      const settings = createBuiltinNotificationSettings();
      settings.volumePercent = 0;
      settings.kinds["workflow.closed"] = { enabled: true, target: "os", sound: "inherit" };
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
        await connection.dispose();
      } finally {
        configureShellBridge(createUnavailableShellBridge());
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
  commitWorkspaceProviderSetup: unused,
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
  previewSettingsSnapshotRuntime: unused,
  saveAgentModelFavorites: unused,
});
