import { mock } from "bun:test";
import type { NotificationOccurrence, NotificationSettings } from "@openducktor/contracts";
import type { NotificationBridge } from "@/lib/shell-bridge";
import { createNotificationRuntime as createProductionNotificationRuntime } from "./notification-runtime";

export const createBridge = (overrides: Partial<NotificationBridge> = {}): NotificationBridge => ({
  getCapability: async () => ({
    platform: "browser",
    supported: true,
    permission: "prompt",
    canGuaranteeSilent: true,
    canOpenSystemSettings: false,
  }),
  requestPermission: async () => ({
    platform: "browser",
    supported: true,
    permission: "granted",
    canGuaranteeSilent: true,
    canOpenSystemSettings: false,
  }),
  openSystemSettings: async () => {},
  isAppFocused: async () => false,
  withExternalDeliveryOwnership: async (_occurrenceId, dispatch) => dispatch(true),
  showOsNotification: async () => ({ status: "shown" }),
  publishOccurrence: async (occurrence, settings) => ({ occurrence, settings }),
  subscribeOccurrences: () => () => {},
  subscribeClicks: () => () => {},
  dispose: () => {},
  ...overrides,
});

export const workflowClosedOccurrence = (suffix: string): NotificationOccurrence => ({
  occurrenceId: `workflow.closed:/repo:task-1:${suffix}`,
  kind: "workflow.closed",
  repoPath: "/repo",
  repositoryLabel: "Repo",
  task: { id: "task-1", title: "Build notifications" },
  status: "Task moved to Closed.",
  navigationTarget: { type: "kanban_task", repoPath: "/repo", taskId: "task-1" },
});

export const createDeliveryAdapters = () => {
  const deliverInApp = mock(async () => {});
  const dismissInApp = mock((_occurrenceId: string) => {});
  const playSound = mock(async () => {});
  return {
    deliverInApp,
    dismissInApp,
    playSound,
    inApp: { dismiss: dismissInApp, deliver: deliverInApp },
    sound: { play: playSound },
  };
};

type RuntimeOptions = Parameters<typeof createProductionNotificationRuntime>[0];
type TestRuntimeOptions = { selectSettings(): Promise<NotificationSettings> } & Omit<
  RuntimeOptions,
  "publishAction" | "subscribeStream" | "inApp" | "sound" | "onCoordinationRecovered"
> &
  Partial<Pick<RuntimeOptions, "inApp" | "sound" | "onCoordinationRecovered">>;

export const createNotificationRuntime = ({ selectSettings, ...options }: TestRuntimeOptions) => {
  const delivery = createDeliveryAdapters();
  return createProductionNotificationRuntime({
    publishAction: async (occurrence) => ({
      occurrence,
      settings: await selectSettings(),
      preferenceRevision: 1,
    }),
    subscribeStream: async () => () => {},
    inApp: delivery.inApp,
    sound: delivery.sound,
    onCoordinationRecovered: () => {},
    ...options,
  });
};
